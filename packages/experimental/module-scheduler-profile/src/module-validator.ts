/** Fixed, read-only subprocess validation for one experimental module. */

import { cp, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { HostTool, ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

const MODULE_ROOT = 'packages/experimental'
const MODULE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u
const DEFAULT_CONFIG = { stepTimeoutMs: 30_000, totalTimeoutMs: 120_000, maxOutputBytes: 16_384, graceMs: 1_000 } as const

type Step = 'test' | 'lint' | 'typecheck'
type Output = { text: string; lossy?: boolean; truncated?: boolean }
type Handle = {
  terminate(): unknown
  collected: { stdout?: { readFrom(offset: number): Output }; stderr?: { readFrom(offset: number): Output } }
  done: Promise<{ exitCode: number | null; signal?: string | null }>
}
type Runtime = {
  sandbox: { confine(argv: readonly string[], policy: { mode: 'read-only'; workspaceRoot: string }): { argv: string[] } }
  subprocess: { spawn(spec: { argv: readonly string[]; cwd: string; stdio: { stdin: 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }; graceMs: number; signal: AbortSignal }): Handle }
}

/** Deployment-owned time and output budgets for the validator. */
export interface ModuleValidatorConfig {
  stepTimeoutMs?: number
  totalTimeoutMs?: number
  maxOutputBytes?: number
  graceMs?: number
  /** Repository root that owns packages/experimental; defaults to the process working directory. */
  root?: string
}
type ResolvedConfig = Required<ModuleValidatorConfig>

/** Resolve defaults and reject unsafe validator budgets before registration. */
export function resolveModuleValidatorConfig(config: ModuleValidatorConfig = {}): ResolvedConfig {
  const resolved = { ...DEFAULT_CONFIG, root: process.cwd(), ...config }
  if (typeof resolved.root !== 'string' || resolved.root === '') throw new Error('validation-config-invalid:root')
  for (const [name, value] of Object.entries(resolved) as Array<[string, number]>) {
    if (name === 'root') continue
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error(`validation-config-invalid:${name}`)
  }
  if (resolved.maxOutputBytes < 2_048) throw new Error('validation-config-invalid:maxOutputBytes')
  return resolved
}

function failure(code: string, message: string, failedStep?: Step, details?: Record<string, unknown>): Record<string, unknown> {
  return { ok: false, moduleName: '模块自动校验器', status: code === 'validation-timeout' ? 'timed_out' : code === 'validation-cancelled' ? 'cancelled' : 'failed', results: [], ...(failedStep === undefined ? {} : { failedStep }), error: { code, message, ...details } }
}
function inside(root: string, path: string): boolean { const child = relative(root, path); return child !== '' && !child.startsWith('..') && !isAbsolute(child) }
function clip(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let end = Math.min(text.length, maxBytes)
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) end -= 1
  return text.slice(0, end)
}
async function stop(handle: Handle | undefined): Promise<void> {
  if (handle === undefined) return
  try { await handle.terminate() } catch { /* A failed cleanup cannot hide the validation result. */ }
}
async function createValidationCopy(root: string, module: string): Promise<{ root: string; module: string }> {
  const tempRoot = await mkdtemp(resolve(root, '.dsh-validator-'))
  try {
    const relativeModule = relative(root, module)
    const copiedModule = resolve(tempRoot, relativeModule)
    await mkdir(resolve(copiedModule, '..'), { recursive: true })
    await cp(module, copiedModule, { recursive: true, dereference: false })
    const baseConfig = resolve(root, 'tsconfig.base.json')
    if (await lstat(baseConfig).then(() => true).catch(() => false)) await cp(baseConfig, resolve(tempRoot, 'tsconfig.base.json'))
    await writeFile(resolve(tempRoot, 'tsconfig.json'), '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022","skipLibCheck":true,"types":["node"]}}\n')
    await writeFile(resolve(tempRoot, 'vitest.validator.config.mjs'), "export default { test: { pool: 'threads', maxWorkers: 1 } }\n")
    return { root: tempRoot, module: copiedModule }
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    throw Object.assign(new Error('validation-copy-failed'), { cause: error })
  }
}

async function modulePath(root: string, id: string): Promise<string> {
  if (!MODULE_ID.test(id)) throw new Error('validation-config-invalid')
  const expected = resolve(root, MODULE_ROOT, `${id}-profile`)
  const info = await lstat(expected).catch(() => undefined)
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('validation-module-not-found')
  const [actual, parent] = await Promise.all([realpath(expected), realpath(resolve(root, MODULE_ROOT))])
  if (actual !== expected || !inside(parent, actual)) throw new Error('validation-path-outside-module')
  return actual
}
async function checkFiles(module: string, files: unknown): Promise<void> {
  if (files === undefined) return
  if (!Array.isArray(files) || files.some(file => typeof file !== 'string')) throw new Error('validation-config-invalid')
  const targetFiles = files.filter((file): file is string => typeof file === 'string')
  for (const file of targetFiles) {
    if (isAbsolute(file) || file.split(/[\\/]/u).some(part => part === '..' || part.startsWith('.'))) {
      throw new Error('validation-path-outside-module')
    }
    const path = await realpath(resolve(module, file)).catch(() => undefined)
    if (!path || !inside(module, path)) throw new Error('validation-module-not-found')
  }
}
function command(root: string, module: string, name: Step): string[] {
  return name === 'test'
    ? [process.execPath, resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', resolve(module, 'tests'), '--config', resolve(module, 'vitest.validator.config.mjs'), '--no-cache', '--configLoader', 'native', '--pool', 'threads', '--maxWorkers', '1']
    : name === 'lint'
      ? [process.execPath, '--import', pathToFileURL(resolve(root, 'node_modules/tsx/dist/loader.mjs')).href, resolve(root, 'scripts/run-oxlint.ts'), module]
      : [process.execPath, resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(module, 'tsconfig.json'), '--noEmit', '--composite', 'false', '--incremental', 'false']
}
async function runStep(
  root: string, module: string, name: Step, parentSignal: AbortSignal, runtime: Runtime, config: ResolvedConfig,
): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const abort = () => { controller.abort(parentSignal.reason) }
  parentSignal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { controller.abort('step-timeout') }, config.stepTimeoutMs)
  let handle: Handle | undefined
  const outputBytes = Math.floor((config.maxOutputBytes - 1_024) / 6)
  try {
    const confined = runtime.sandbox.confine(command(root, module, name), { mode: 'read-only', workspaceRoot: module })
    handle = runtime.subprocess.spawn({
      argv: confined.argv, cwd: module,
      stdio: { stdin: 'ignore', stdout: { maxBytes: outputBytes }, stderr: { maxBytes: outputBytes } },
      graceMs: config.graceMs, signal: controller.signal,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '' }
    const stderr = handle.collected.stderr?.readFrom(0) ?? { text: '' }
    const outputTruncated = stdout.lossy || stdout.truncated || stderr.lossy || stderr.truncated
      || Buffer.byteLength(stdout.text, 'utf8') > outputBytes
      || Buffer.byteLength(stderr.text, 'utf8') > outputBytes
    if (controller.signal.aborted) {
      await stop(handle)
      const cancelled = parentSignal.aborted && parentSignal.reason !== 'total-timeout'
      return { name, ok: false, exitCode: outcome.exitCode, stdout: clip(stdout.text, outputBytes), stderr: clip(stderr.text, outputBytes), error: { code: cancelled ? 'validation-cancelled' : 'validation-timeout', message: cancelled ? `${name} 已取消` : `${name} 执行超时` } }
    }
    if (outputTruncated) {
      return { name, ok: false, exitCode: outcome.exitCode, stdout: clip(stdout.text, outputBytes), stderr: clip(stderr.text, outputBytes), outputTruncated: true, error: { code: 'validation-output-truncated', message: `${name} 输出超过上限` } }
    }
    return { name, ok: outcome.exitCode === 0, exitCode: outcome.exitCode,
      stdout: clip(stdout.text, outputBytes), stderr: clip(stderr.text, outputBytes) }
  } catch (cause) {
    if (controller.signal.aborted) {
      await stop(handle)
      const cancelled = parentSignal.aborted && parentSignal.reason !== 'total-timeout'
      return { name, ok: false, exitCode: null, stdout: '', stderr: '', error: { code: cancelled ? 'validation-cancelled' : 'validation-timeout', message: cancelled ? `${name} 已取消` : `${name} 执行超时` } }
    }
    return { name, ok: false, exitCode: null, stdout: '', stderr: clip(String(cause), outputBytes), error: { code: 'validation-command-start-failed', message: `${name} 启动失败` } }
  } finally {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', abort)
  }
}
function complete(value: Record<string, unknown>, config: ResolvedConfig): JsonValue {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') <= config.maxOutputBytes) return value as JsonValue
  return { ...failure('validation-output-truncated', '完整校验结果超过上限'), results: [] }
}

/** Execute the fixed validator flow and return one bounded structured result. */
export async function validateModule(
  root: string, input: unknown, signal: AbortSignal, runtime?: Runtime, config?: ModuleValidatorConfig,
): Promise<JsonValue> {
  let resolved: ResolvedConfig
  try { resolved = resolveModuleValidatorConfig(config) } catch { return failure('validation-config-invalid', '校验配置无效') as JsonValue }
  const controller = new AbortController()
  const externalAbort = () => { controller.abort(signal.reason) }
  signal.addEventListener('abort', externalAbort, { once: true })
  const totalTimer = setTimeout(() => { controller.abort('total-timeout') }, resolved.totalTimeoutMs)
  try {
    if (typeof input !== 'object' || input === null || typeof (input as { id?: unknown }).id !== 'string') return failure('validation-config-invalid', '校验配置无效') as JsonValue
    const request = input as { id: string; targetFiles?: unknown }
    const module = await modulePath(root, request.id)
    await checkFiles(module, request.targetFiles)
    if (runtime === undefined) return failure('validation-config-invalid', '校验运行时不可用') as JsonValue
    const validationCopy = await createValidationCopy(root, module)
    const results: Record<string, unknown>[] = []
    try {
      for (const name of ['test', 'lint', 'typecheck'] as const) {
        if (controller.signal.aborted) return complete({ ...failure(signal.aborted ? 'validation-cancelled' : 'validation-timeout', signal.aborted ? '整体校验已取消' : '整体校验超时', name), results }, resolved)
        const result = await runStep(root, validationCopy.root, name, controller.signal, runtime, resolved)
        results.push(result)
        if (result.ok !== true) return complete({ ...failure((result.error as { code?: string } | undefined)?.code ?? 'validation-command-failed', `${name} 执行失败`, name, { exitCode: result.exitCode }), results }, resolved)
      }
      return complete({ ok: true, moduleName: '模块自动校验器', status: 'succeeded', results }, resolved)
    } finally {
      await rm(validationCopy.root, { recursive: true, force: true }).catch(() => undefined)
    }
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : 'validation-module-not-found'
    const message = code === 'validation-path-outside-module' ? '路径越出模块目录' : code === 'validation-config-invalid' ? '校验配置无效' : code === 'validation-copy-failed' ? '无法创建校验副本' : '模块不存在'
    return failure(code, message) as JsonValue
  } finally {
    clearTimeout(totalTimer)
    signal.removeEventListener('abort', externalAbort)
  }
}

/** The default registration definition; configured installations use `createModuleValidatorDefinition()`. */
export const moduleValidatorDefinition: ModuleDefinition = createModuleValidatorDefinition()
/** Create the validator module definition with its configured overall deadline. */
export function createModuleValidatorDefinition(config?: ModuleValidatorConfig): ModuleDefinition {
  const resolved = resolveModuleValidatorConfig(config)
  return {
    id: 'module-validator', version: '1.0.0', displayName: '模块自动校验器', description: '使用固定子进程只读校验模块目录', tools: ['module-validator/run'],
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' }, targetFiles: { type: 'array', items: { type: 'string' } } } },
    outputSchema: { type: 'object', required: ['ok', 'moduleName', 'status', 'results'], additionalProperties: true, properties: { ok: { type: 'boolean' }, moduleName: { type: 'string' }, status: { type: 'string' }, results: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
    resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: resolved.totalTimeoutMs + resolved.graceMs },
    execute: async ({ input, tools }) => {
      const tool = tools.get('module-validator/run')
      return tool === undefined ? failure('validation-command-start-failed', '校验工具不可用') : tool(input)
    },
  }
}
/** Create the private Host tool that executes only the fixed validator pipeline. */
export function createModuleValidatorHostTool(root: string, runtime?: Runtime, config?: ModuleValidatorConfig): HostTool {
  return async (args, context) => validateModule(root, args, context.run.signal, runtime, config)
}
/** Register the validator and its private Host tool for this plugin lifetime. */
export function applyModuleValidator(ctx: Context, config?: ModuleValidatorConfig): void {
  const resolved = resolveModuleValidatorConfig(config)
  const root = resolved.root; const runtime = ctx as Context & Runtime
  const dispose = ctx.moduleScheduler.registerHostTool('module-validator/run', createModuleValidatorHostTool(root, runtime, resolved))
  const ref = ctx.moduleScheduler.registry.register(createModuleValidatorDefinition(resolved))
  ctx.effect(() => () => { dispose(); ctx.moduleScheduler.registry.unregister(ref) }, 'module-validator: registration')
}
