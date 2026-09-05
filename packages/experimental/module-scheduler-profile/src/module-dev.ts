/** Private Host tools for safely editing and validating one experimental module. */

import { open, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { HostTool, ManagedAgentToolFactory, ModuleDefinition, ModuleTool } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
interface ValidationRuntime {
  sandbox: { confine(argv: readonly string[], policy: { mode: 'read-only' | 'workspace-write'; workspaceRoot: string }): { argv: string[] } }
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
  const info = await stat(module.path).catch(() => undefined)
  if (!info?.isDirectory()) throw new Error('module-not-found')
  const expectedRoot = await realpath(resolve(root, MODULE_ROOT))
  const actualPath = await realpath(module.path)
  if (!inside(expectedRoot, actualPath)) throw new Error('module-path-outside-root')
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

function assertDeveloper(context: { request: { moduleRef: string } }): void {
  if (!['module-developer@1.0.0', 'module-developer@2.0.0'].includes(context.request.moduleRef)) {
    throw new Error('module-dev-caller-forbidden')
  }
}

async function replaceExistingFile(root: string, id: string, file: string, expectedContent: string, content: string): Promise<number> {
  const path = await existingFile(root, id, file)
  const handle = await open(path, 'r+')
  try {
    if (await realpath(path) !== path) throw new Error('file-path-changed')
    if (await handle.readFile('utf8') !== expectedContent) throw new Error('module-file-changed')
    const bytes = Buffer.from(content)
    await handle.truncate(0)
    await handle.write(bytes, 0, bytes.length, 0)
    return bytes.length
  } finally {
    await handle.close()
  }
}

async function validate(root: string, id: string, action: 'test' | 'lint' | 'typecheck', signal: AbortSignal, runtime: ValidationRuntime | undefined): Promise<unknown> {
  const module = await moduleTarget(root, id)
  if (runtime === undefined) return { action, ok: false, code: 'validation-runtime-unavailable', output: '' }
  const argv = action === 'test'
    ? [process.execPath, resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', `packages/experimental/${id}-profile/tests`, '--no-cache', '--configLoader', 'native', '--pool', 'threads', '--maxWorkers', '1']
    : action === 'lint'
      ? [process.execPath, '--import', pathToFileURL(resolve(root, 'node_modules/tsx/dist/loader.mjs')).href, resolve(root, 'scripts/run-oxlint.ts'), `packages/experimental/${id}-profile`]
      : [process.execPath, resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(module.path, 'tsconfig.json'), '--noEmit', '--composite', 'false', '--incremental', 'false']
  try {
    const confined = runtime.sandbox.confine(argv, { mode: 'read-only', workspaceRoot: module.path })
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
    name,
    description,
    parameters,
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: args => execute(args) as Promise<JsonValue>,
  })
}

export function createModuleDevHostTools(root: string, runtime?: ValidationRuntime): ReadonlyMap<string, HostTool> {
  return new Map<string, HostTool>([
    ['module-dev/read', async (args, context) => {
      assertDeveloper(context)
      const input = args as { id: string; file: string }
      return { file: input.file, content: await readFile(await existingFile(root, input.id, input.file), 'utf8') }
    }],
    ['module-dev/write', async (args, context) => {
      assertDeveloper(context)
      const input = args as { id: string; file: string; expectedContent: string; content: string }
      return { file: input.file, bytes: await replaceExistingFile(root, input.id, input.file, input.expectedContent, input.content) }
    }],
    ...(['test', 'lint', 'typecheck'] as const).map((action): [string, HostTool] => [
      `module-dev/${action}`,
      async (args, context) => {
        assertDeveloper(context)
        return validate(root, (args as { id: string }).id, action, context.run.signal, runtime)
      },
    ]),
  ])
}

/** Register the private module-development Host tools. */
export function applyTools(ctx: Context): void {
  const runtime = ctx as Context & ValidationRuntime
  for (const [name, tool] of createModuleDevHostTools(process.cwd(), runtime)) {
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
      const results = [
        original,
        await tools.get('module-dev/write')?.({ ...request, expectedContent: original.content }),
        await tools.get('module-dev/test')?.({ id: request.id }),
        await tools.get('module-dev/lint')?.({ id: request.id }),
        await tools.get('module-dev/typecheck')?.({ id: request.id }),
      ]
      const ok = results.every(result => result !== undefined
        && (typeof result !== 'object' || result === null || !('ok' in result) || result.ok === true))
      return { ok, results }
    },
  }
  const managedDefinition: ModuleDefinition = {
    id: 'module-developer',
    version: '2.0.0',
    displayName: '受管模块开发助手',
    description: '由继承当前模型的受管子代理在受限模块目录中多步修改并验证实验性模块',
    tools: definition.tools,
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
    ctx.moduleScheduler.registry.register(managedDefinition),
    ctx.moduleScheduler.registry.register(definition),
  ]
  ctx.effect(() => () => {
    for (const ref of refs) ctx.moduleScheduler.registry.unregister(ref)
  }, 'module-developer: registration')
}
