/** Private Host tools for safely editing and validating one experimental module. */

import { existsSync } from 'node:fs'
import { lstat, open, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { HostTool, HostToolContext, ManagedAgentToolFactory, ModuleDefinition, ModuleTool } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
interface ValidationRuntime {
  sandbox: { confine(argv: readonly string[], policy: { mode: 'read-only' | 'workspace-write'; workspaceRoot: string; sessionId?: string }): { argv: string[] } }
  subprocess: { spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: { stdin: 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
    graceMs: number
    signal: AbortSignal
  }): {
    collected: { stdout?: { readFrom(offset: number): { text: string } }; stderr?: { readFrom(offset: number): { text: string } } }
    done: Promise<{ exitCode: number | null }>
  } }
}
const MODULE_ROOT = 'packages/experimental'

function isModuleCheckout(root: string): boolean {
  return existsSync(resolve(root, 'scripts/create-module.ts'))
    && existsSync(resolve(root, MODULE_ROOT))
}

function linkedCheckoutRoot(): string | undefined {
  let current = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(resolve(current, 'package.json'))) {
      const root = resolve(current, '../../..')
      return isModuleCheckout(root) ? root : undefined
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

const LINKED_CHECKOUT_ROOT = linkedCheckoutRoot()

/** Resolve an explicit, initiating-session, or source-linked module checkout. */
export function resolveModuleDevRoot(sessionRoot: string | undefined, explicitRoot = process.env.DSH_MODULE_DEV_ROOT): string {
  if (explicitRoot !== undefined && explicitRoot !== '') return explicitRoot
  if (sessionRoot !== undefined && isModuleCheckout(sessionRoot)) return sessionRoot
  if (LINKED_CHECKOUT_ROOT !== undefined) return LINKED_CHECKOUT_ROOT
  if (sessionRoot !== undefined) return sessionRoot
  throw new Error('module-workspace-unavailable')
}

interface ModuleTarget {
  id: string
  path: string
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child !== '' && !child.startsWith('..') && !isAbsolute(child)
}

function target(root: string, id: string): ModuleTarget {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(id)) throw new Error('invalid-module-id')
  return { id, path: resolve(root, MODULE_ROOT, `${id}-profile`) }
}

async function moduleTarget(root: string, id: string): Promise<ModuleTarget> {
  const module = target(root, id)
  const info = await lstat(module.path).catch(() => undefined)
  if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error('module-not-found')
  const expectedPath = resolve(root, MODULE_ROOT, `${id}-profile`)
  const expectedRoot = await realpath(resolve(root, MODULE_ROOT))
  const actualPath = await realpath(module.path)
  if (actualPath !== expectedPath || !inside(expectedRoot, actualPath)) throw new Error('module-path-outside-root')
  return { id, path: actualPath }
}

async function existingFile(root: string, id: string, file: string): Promise<string> {
  if (/(?:^|[\\/])(?:\.env|.*(?:secret|token|credential|key).*)$/iu.test(file)) throw new Error('sensitive-file-forbidden')
  if (isAbsolute(file) || file.split(/[\\/]/u).some(part => part === '..' || part.startsWith('.'))) throw new Error('file-path-outside-module')
  const module = await moduleTarget(root, id)
  const path = await realpath(resolve(module.path, file)).catch(() => undefined)
  if (!path) throw new Error('module-file-not-found')
  if (!inside(module.path, path)) throw new Error('file-path-outside-module')
  return path
}

function assertBuilder(context: { request: { moduleRef: string } }): void {
  if (context.request.moduleRef !== 'module-developer@3.0.0') throw new Error('module-dev-caller-forbidden')
}

function assertDeveloper(args: unknown, context: { request: { moduleRef: string; input?: unknown } }): void {
  if (!['module-developer@1.0.0', 'module-developer@2.0.0', 'module-developer@3.0.0'].includes(context.request.moduleRef)) {
    throw new Error('module-dev-caller-forbidden')
  }
  if (context.request.moduleRef !== 'module-developer@1.0.0') {
    const input = context.request.input
    if (typeof args !== 'object' || args === null || !('id' in args)
      || typeof input !== 'object' || input === null || !('id' in input) || args.id !== input.id) {
      throw new Error('module-dev-target-mismatch')
    }
  }
}

async function replaceExistingFile(root: string, id: string, file: string, expectedContent: string, content: string): Promise<number> {
  const path = await existingFile(root, id, file)
  const handle = await open(path, 'r+')
  try {
    if (await realpath(path) !== path) throw new Error('file-path-changed')
    const [opened, current] = await Promise.all([handle.stat(), lstat(path)])
    if (opened.dev !== current.dev || opened.ino !== current.ino) throw new Error('file-path-changed')
    if (await handle.readFile('utf8') !== expectedContent) throw new Error('module-file-changed')
    const bytes = Buffer.from(content)
    await handle.truncate(0)
    await handle.write(bytes, 0, bytes.length, 0)
    return bytes.length
  } finally {
    await handle.close()
  }
}

async function scaffold(
  root: string,
  input: { id: string; name?: string; description?: string },
  remove: boolean,
  signal: AbortSignal,
  sessionId: string,
  runtime: ValidationRuntime | undefined,
): Promise<unknown> {
  if (runtime === undefined) return { action: remove ? 'remove' : 'create', ok: false, code: 'validation-runtime-unavailable', output: '' }
  // tsx starts esbuild through piped stdio, which the Windows ACL sandbox denies.
  const argv = [process.execPath, resolve(root, 'scripts/create-module.ts')]
  if (remove) argv.push('--remove', '--id', input.id)
  else argv.push('--id', input.id, '--name', input.name ?? '', '--description', input.description ?? '')
  try {
    const confined = runtime.sandbox.confine(argv, { mode: 'workspace-write', workspaceRoot: root, sessionId })
    const handle = runtime.subprocess.spawn({
      argv: confined.argv,
      cwd: root,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4000 }, stderr: { maxBytes: 4000 } },
      graceMs: 1000,
      signal,
    })
    const outcome = await handle.done
    const output = `${handle.collected.stdout?.readFrom(0).text ?? ''}${handle.collected.stderr?.readFrom(0).text ?? ''}`.slice(-4000)
    return { action: remove ? 'remove' : 'create', ok: outcome.exitCode === 0, code: outcome.exitCode, output }
  } catch (error) {
    return { action: remove ? 'remove' : 'create', ok: false, code: 'failed', output: String(error).slice(-4000) }
  }
}

async function validate(root: string, id: string, action: 'test' | 'lint' | 'typecheck', signal: AbortSignal, sessionId: string, runtime: ValidationRuntime | undefined): Promise<unknown> {
  const module = await moduleTarget(root, id)
  if (runtime === undefined) return { action, ok: false, code: 'validation-runtime-unavailable', output: '' }
  const argv = action === 'test'
    ? [process.execPath, resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', `packages/experimental/${id}-profile/tests`, '--no-cache', '--configLoader', 'native', '--pool', 'threads', '--maxWorkers', '1']
    : action === 'lint'
      ? [process.execPath, resolve(root, 'scripts/run-oxlint.ts'), `packages/experimental/${id}-profile`]
      : [process.execPath, resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(module.path, 'tsconfig.json'), '--noEmit', '--composite', 'false', '--incremental', 'false']
  try {
    const confined = runtime.sandbox.confine(argv, { mode: 'read-only', workspaceRoot: module.path, sessionId })
    const handle = runtime.subprocess.spawn({
      argv: confined.argv,
      cwd: root,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4000 }, stderr: { maxBytes: 4000 } },
      graceMs: 1000,
      signal,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    return { action, ok: outcome.exitCode === 0, code: outcome.exitCode, output: `${stdout}${stderr}`.slice(-4000) }
  } catch (error) {
    return { action, ok: false, code: 'failed', output: String(error).slice(-4000) }
  }
}

export const moduleDevToolFactories: ReadonlyMap<string, ManagedAgentToolFactory> = new Map([
  ['module-dev/create', execute => defineModuleTool('module-dev/create', '使用固定脚手架创建新的实验模块。', {
    id: { type: 'string', required: true }, name: { type: 'string', required: true }, description: { type: 'string', required: true },
  }, execute)],
  ['module-dev/remove', execute => defineModuleTool('module-dev/remove', '回滚本次创建且仍符合脚手架身份的实验模块。', {
    id: { type: 'string', required: true },
  }, execute)],
  ['module-dev/read', execute => defineModuleTool('module-dev/read', '读取目标模块中的已有文件。', {
    id: { type: 'string', required: true }, file: { type: 'string', required: true },
  }, execute)],
  ['module-dev/write', execute => defineModuleTool('module-dev/write', '比较后完整替换目标模块中的已有文件。', {
    id: { type: 'string', required: true }, file: { type: 'string', required: true },
    expectedContent: { type: 'string', required: true }, content: { type: 'string', required: true },
  }, execute)],
  ...(['test', 'lint', 'typecheck'] as const).map(action => [
    `module-dev/${action}`,
    (execute: ModuleTool) => defineModuleTool(`module-dev/${action}`, `运行固定的 ${action} 验证。`, {
      id: { type: 'string', required: true },
    }, execute),
  ] as const),
])

function defineModuleTool(name: string, description: string, parameters: Record<string, { type: 'string'; required: true }>, execute: ModuleTool) {
  return defineTool({
    name: name.replaceAll(/[-/]/g, '_'),
    description,
    parameters,
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: args => execute(args) as Promise<JsonValue>,
  })
}

export function createModuleDevHostTools(
  root: string | ((context: HostToolContext) => string),
  runtime?: ValidationRuntime,
): ReadonlyMap<string, HostTool> {
  const rootFor = (context: HostToolContext) => typeof root === 'string' ? root : root(context)
  return new Map<string, HostTool>([
    ['module-dev/create', async (args, context) => {
      assertBuilder(context)
      assertDeveloper(args, context)
      const selectedRoot = rootFor(context)
      const input = args as { id: string; name: string; description: string }
      const result = await scaffold(selectedRoot, input, false, context.run.signal, context.request.sessionId, runtime) as { ok?: unknown }
      if (result.ok !== true) return result
      let cleanup: Promise<unknown> | undefined
      return {
        ...result,
        cleanup: () => cleanup ??= scaffold(
          selectedRoot, { id: input.id }, true, new AbortController().signal, context.request.sessionId, runtime,
        ),
      }
    }],
    ['module-dev/remove', async (args, context) => {
      assertBuilder(context)
      assertDeveloper(args, context)
      return scaffold(rootFor(context), args as { id: string }, true, context.run.signal, context.request.sessionId, runtime)
    }],
    ['module-dev/read', async (args, context) => {
      assertDeveloper(args, context)
      const input = args as { id: string; file: string }
      return { file: input.file, content: await readFile(await existingFile(rootFor(context), input.id, input.file), 'utf8') }
    }],
    ['module-dev/write', async (args, context) => {
      assertDeveloper(args, context)
      const input = args as { id: string; file: string; expectedContent: string; content: string }
      return {
        file: input.file,
        bytes: await replaceExistingFile(rootFor(context), input.id, input.file, input.expectedContent, input.content),
      }
    }],
    ...(['test', 'lint', 'typecheck'] as const).map((action): [string, HostTool] => [
      `module-dev/${action}`,
      async (args, context) => {
        assertDeveloper(args, context)
        return validate(rootFor(context), (args as { id: string }).id, action, context.run.signal, context.request.sessionId, runtime)
      },
    ]),
  ])
}

/** Register the private module-development Host tools. */
export function applyTools(ctx: Context): void {
  const runtime = ctx as Context & ValidationRuntime
  for (const [name, tool] of createModuleDevHostTools((context) => {
    return resolveModuleDevRoot(context.agent?.session.header.cwd)
  }, runtime)) {
    const dispose = ctx.moduleScheduler.registerHostTool(name, tool, moduleDevToolFactories.get(name))
    ctx.effect(() => dispose, `${name}: registration`)
  }
}

/** Register the module-development assistant with its fixed tool allowlist. */
export function applyModule(ctx: Context): void {
  const definition: ModuleDefinition = {
    id: 'module-developer',
    version: '1.0.0',
    displayName: '模块开发助手',
    description: '在受限模块目录中读取、修改并验证一个实验性模块',
    tools: ['module-dev/read', 'module-dev/write', 'module-dev/test', 'module-dev/lint', 'module-dev/typecheck'],
    inputSchema: { type: 'object', required: ['id', 'file', 'content'], additionalProperties: false, properties: { id: { type: 'string' }, file: { type: 'string' }, content: { type: 'string' } } },
    outputSchema: { type: 'object', required: ['ok', 'results'], additionalProperties: false, properties: { ok: { type: 'boolean' }, results: { type: 'array', items: { type: 'object', additionalProperties: true } } } },
    resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 120_000 },
    execute: async ({ input, tools }) => {
      const request = input as { id: string; file: string; content: string }
      const original = await tools.get('module-dev/read')?.({ id: request.id, file: request.file }) as { content?: unknown } | undefined
      if (typeof original?.content !== 'string') throw new Error('module-read-failed')
      const write = tools.get('module-dev/write')
      try {
        const results = [
          original,
          await write?.({ ...request, expectedContent: original.content }),
          await tools.get('module-dev/test')?.({ id: request.id }),
          await tools.get('module-dev/lint')?.({ id: request.id }),
          await tools.get('module-dev/typecheck')?.({ id: request.id }),
        ]
        const ok = results.every(result => result !== undefined
          && (typeof result !== 'object' || result === null || !('ok' in result) || result.ok === true))
        if (!ok) await write?.({ id: request.id, file: request.file, expectedContent: request.content, content: original.content })
        return { ok, results }
      } catch (error) {
        await write?.({ id: request.id, file: request.file, expectedContent: request.content, content: original.content })
        throw error
      }
    },
  }
  const builderDefinition: ModuleDefinition = {
    id: 'module-developer',
    version: '3.0.0',
    displayName: '受管模块构建助手',
    description: '使用固定脚手架创建并验证一个实验性模块',
    tools: ['module-dev/create', 'module-dev/remove', 'module-dev/read', 'module-dev/write', 'module-dev/test', 'module-dev/lint', 'module-dev/typecheck'],
    inputSchema: { type: 'object', required: ['id', 'name', 'description', 'task', 'modelTier'], additionalProperties: false, properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, task: { type: 'string' }, modelTier: { type: 'string' } } },
    outputSchema: { type: 'object', required: ['ok', 'changedFiles', 'checks', 'summary'], additionalProperties: false, properties: { ok: { type: 'boolean' }, changedFiles: { type: 'array', items: { type: 'string' } }, checks: { type: 'array', items: { type: 'object', additionalProperties: true } }, summary: { type: 'string' } } },
    resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 300_000 },
    requiresAgent: true,
    execute: async ({ input, agent, tools, signal }) => {
      if (agent === undefined) throw new Error('module-requires-agent')
      const request = input as { id: string; name: string; description: string; task: string; modelTier: string }
      if (request.modelTier !== 'luna' && request.modelTier !== 'terra') throw new Error('module-dev-model-tier-forbidden')
      const create = tools.get('module-dev/create')
      const remove = tools.get('module-dev/remove')
      const created = await create?.({
        id: request.id, name: request.name, description: request.description,
      }) as { ok?: unknown; cleanup?: () => Promise<unknown> } | undefined
      if (created?.ok !== true) {
        const detail = created !== undefined && 'output' in created && typeof created.output === 'string' ? `: ${created.output}` : ''
        const code = created !== undefined && 'code' in created ? ` (${String(created.code)})` : ''
        throw new Error(`module-dev-create-failed${code}${detail}`)
      }
      let cleanupPromise: Promise<unknown> | undefined
      const cleanup = () => cleanupPromise ??= created.cleanup?.() ?? Promise.resolve(remove?.({ id: request.id }))
      const onAbort = () => { void cleanup().catch(() => undefined) }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const result = await agent.run({
          task: `目标模块 ID：${request.id}\n任务：${request.task}\n脚手架已经创建。只能修改该模块中的已有文件。必须运行 test、lint、typecheck，并通过 structured_output 返回结果。`,
          tools: ['module-dev/read', 'module-dev/write', 'module-dev/test', 'module-dev/lint', 'module-dev/typecheck'],
          outputSchema: builderDefinition.outputSchema,
          maxSteps: 24,
          maxTokensPerStep: 4096,
          modelTier: request.modelTier,
        })
        const draft = typeof result === 'object' && result !== null ? result : {}
        const checks = []
        for (const action of ['test', 'lint', 'typecheck'] as const) {
          checks.push(await tools.get(`module-dev/${action}`)?.({ id: request.id }))
        }
        const ok = 'ok' in draft && draft.ok === true && checks.every(check => typeof check === 'object'
          && check !== null && 'ok' in check && check.ok === true)
        if (!ok) await cleanup()
        return {
          ok,
          changedFiles: 'changedFiles' in draft && Array.isArray(draft.changedFiles) ? draft.changedFiles : [],
          checks,
          summary: 'summary' in draft && typeof draft.summary === 'string' ? draft.summary : '',
        }
      } catch (error) {
        await cleanup().catch(() => undefined)
        throw error
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
    },
  }
  const managedDefinition: ModuleDefinition = {
    id: 'module-developer',
    version: '2.0.0',
    displayName: '受管模块开发助手',
    description: '由继承当前模型的受管子代理在受限模块目录中多步修改并验证实验性模块',
    tools: ['module-dev/read', 'module-dev/write', 'module-dev/test', 'module-dev/lint', 'module-dev/typecheck'],
    inputSchema: {
      type: 'object', required: ['id', 'task'], additionalProperties: false,
      properties: { id: { type: 'string' }, task: { type: 'string' } },
    },
    outputSchema: {
      type: 'object', required: ['ok', 'changedFiles', 'checks', 'summary'], additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        changedFiles: { type: 'array', items: { type: 'string' } },
        checks: { type: 'array', items: {
          type: 'object', required: ['name', 'ok'], additionalProperties: false,
          properties: { name: { type: 'string' }, ok: { type: 'boolean' } },
        } },
        summary: { type: 'string' },
      },
    },
    resourcePolicy: definition.resourcePolicy,
    requiresAgent: true,
    execute: async ({ input, agent }) => {
      if (agent === undefined) throw new Error('module-requires-agent')
      const request = input as { id: string; task: string }
      return agent.run({
        task: `目标模块 ID：${request.id}\n任务：${request.task}\n只能操作该模块中的已有文件。完成前必须运行 test、lint、typecheck，并通过 structured_output 返回结果。`,
        tools: definition.tools,
        outputSchema: managedDefinition.outputSchema,
        maxSteps: 12,
        maxTokensPerStep: 4096,
      })
    },
  }
  const refs = [
    ctx.moduleScheduler.registry.register(builderDefinition),
    ctx.moduleScheduler.registry.register(managedDefinition),
    ctx.moduleScheduler.registry.register(definition),
  ]
  ctx.effect(() => () => {
    for (const ref of refs) ctx.moduleScheduler.registry.unregister(ref)
  }, 'module-developer: registration')
}
