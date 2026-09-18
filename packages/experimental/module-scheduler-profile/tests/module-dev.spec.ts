import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { HostToolContext, ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyModule, applyTools, createModuleDevHostTools, resolveModuleDevRoot } from '../src/module-dev.ts'

const roots: string[] = []

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-module-dev-'))
  roots.push(root)
  const module = join(root, 'packages/experimental/example-profile')
  mkdirSync(join(module, 'src'), { recursive: true })
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'scripts/create-module.ts'), '')
  writeFileSync(join(module, 'src/module.ts'), 'before\n')
  return root
}

function hostContext(): HostToolContext {
  return {
    request: { sessionId: 's', taskId: 't', moduleRef: 'module-developer@1.0.0' },
    run: { runId: 'r', sessionId: 's', taskId: 't', moduleRef: 'module-developer@1.0.0', status: 'running', validated: false, signal: new AbortController().signal },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('module developer host tools', () => {
  it('reads and writes only inside the selected profile', async () => {
    const root = workspace()
    const tools = createModuleDevHostTools(root)
    await expect(tools.get('module-dev/read')!({ id: 'example', file: 'src/module.ts' }, hostContext())).resolves.toEqual({ file: 'src/module.ts', content: 'before\n' })
    await expect(tools.get('module-dev/write')!({ id: 'example', file: 'src/module.ts', expectedContent: 'before\n', content: 'after\n' }, hostContext())).resolves.toEqual({ file: 'src/module.ts', bytes: 6 })
    expect(readFileSync(join(root, 'packages/experimental/example-profile/src/module.ts'), 'utf8')).toBe('after\n')
    await expect(tools.get('module-dev/write')!({
      id: 'example', file: 'src/module.ts', expectedContent: 'before\n', content: 'stale\n',
    }, hostContext())).rejects.toThrow('module-file-changed')
    expect(readFileSync(join(root, 'packages/experimental/example-profile/src/module.ts'), 'utf8')).toBe('after\n')
  })

  it('restores changed files from the host snapshot', async () => {
    const root = workspace()
    const tools = createModuleDevHostTools(root)
    const context = hostContext()
    const started = await tools.get('module-dev/changes')!({ id: 'example', action: 'begin' }, context) as { token: string }
    await tools.get('module-dev/write')!({ id: 'example', file: 'src/module.ts', expectedContent: 'before\n', content: 'broken\n' }, context)

    await expect(tools.get('module-dev/changes')!({ id: 'example', action: 'rollback', token: started.token }, context))
      .resolves.toEqual({ changedFiles: ['src/module.ts'] })
    expect(readFileSync(join(root, 'packages/experimental/example-profile/src/module.ts'), 'utf8')).toBe('before\n')
  })

  it('never snapshots or restores sensitive files', async () => {
    const root = workspace()
    const moduleRoot = join(root, 'packages/experimental/example-profile')
    writeFileSync(join(moduleRoot, '.env'), 'secret-before\n')
    const tools = createModuleDevHostTools(root)
    const context = hostContext()
    const started = await tools.get('module-dev/changes')!({ id: 'example', action: 'begin' }, context) as { token: string }
    writeFileSync(join(moduleRoot, '.env'), 'secret-after\n')
    await tools.get('module-dev/write')!({ id: 'example', file: 'src/module.ts', expectedContent: 'before\n', content: 'broken\n' }, context)

    await expect(tools.get('module-dev/changes')!({ id: 'example', action: 'rollback', token: started.token }, context))
      .resolves.toEqual({ changedFiles: ['src/module.ts'] })
    expect(readFileSync(join(moduleRoot, '.env'), 'utf8')).toBe('secret-after\n')
    expect(readFileSync(join(moduleRoot, 'src/module.ts'), 'utf8')).toBe('before\n')
  })

  it('falls back to the linked source checkout when the session workspace is not a checkout', () => {
    const unrelated = mkdtempSync(join(tmpdir(), 'dsh-module-session-'))
    roots.push(unrelated)
    expect(resolveModuleDevRoot(unrelated, '')).toBe(process.cwd())
  })

  it('uses the initiating session workspace instead of the DSH process directory', async () => {
    const root = workspace()
    const registered = new Map<string, (args: unknown, context: HostToolContext) => Promise<unknown>>()
    applyTools({
      sandbox: {}, subprocess: {},
      moduleScheduler: { registerHostTool: (name: string, tool: (args: unknown, context: HostToolContext) => Promise<unknown>) => {
        registered.set(name, tool)
        return () => {}
      } },
      effect: () => undefined,
    } as unknown as Context)
    const context = hostContext()
    context.agent = { session: { header: { cwd: root } } } as NonNullable<HostToolContext['agent']>

    await expect(registered.get('module-dev/read')!({ id: 'example', file: 'src/module.ts' }, context))
      .resolves.toEqual({ file: 'src/module.ts', content: 'before\n' })
  })

  it('prefers DSH_MODULE_DEV_ROOT when set, over the initiating session workspace', async () => {
    const sessionWorkspace = workspace()
    const explicitRoot = workspace()
    const registered = new Map<string, (args: unknown, context: HostToolContext) => Promise<unknown>>()
    applyTools({
      sandbox: {}, subprocess: {},
      moduleScheduler: { registerHostTool: (name: string, tool: (args: unknown, context: HostToolContext) => Promise<unknown>) => {
        registered.set(name, tool)
        return () => {}
      } },
      effect: () => undefined,
    } as unknown as Context)
    vi.stubEnv('DSH_MODULE_DEV_ROOT', explicitRoot)
    try {
      const context = hostContext()
      context.agent = { session: { header: { cwd: sessionWorkspace } } } as NonNullable<HostToolContext['agent']>
      await expect(registered.get('module-dev/read')!({ id: 'example', file: 'src/module.ts' }, context))
        .resolves.toEqual({ file: 'src/module.ts', content: 'before\n' })
      expect(process.env.DSH_MODULE_DEV_ROOT).toBe(explicitRoot)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('rejects a symbolic-link escape from the selected profile', async () => {
    const root = workspace()
    const outside = join(root, 'outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'value.txt'), 'secret')
    symlinkSync(outside, join(root, 'packages/experimental/example-profile/src/link'), 'junction')
    const tools = createModuleDevHostTools(root)

    await expect(tools.get('module-dev/read')!(
      { id: 'example', file: 'src/link/value.txt' }, hostContext(),
    )).rejects.toThrow('file-path-outside-module')
  })

  it('binds managed development tools to the requested module id', async () => {
    const tools = createModuleDevHostTools(workspace())
    const context = hostContext()
    context.request.moduleRef = 'module-developer@2.0.0'
    context.request.input = { id: 'example', task: 'change module' }

    await expect(tools.get('module-dev/read')!({ id: 'other', file: 'src/module.ts' }, context))
      .rejects.toThrow('module-dev-target-mismatch')
    await expect(tools.get('module-dev/read')!({ id: 'example', file: 'src/module.ts' }, context))
      .resolves.toMatchObject({ content: 'before\n' })
  })

  it('rejects a profile-root symbolic-link redirect', async () => {
    const root = workspace()
    const other = join(root, 'packages/experimental/other-profile')
    mkdirSync(join(other, 'src'), { recursive: true })
    writeFileSync(join(other, 'src/module.ts'), 'other\n')
    const redirected = join(root, 'packages/experimental/redirected-profile')
    symlinkSync(other, redirected, 'junction')

    await expect(createModuleDevHostTools(root).get('module-dev/read')!(
      { id: 'redirected', file: 'src/module.ts' }, hostContext(),
    )).rejects.toThrow('module-not-found')
  })

  it('rejects path traversal, sensitive files, and missing modules', async () => {
    const tools = createModuleDevHostTools(workspace())
    await expect(tools.get('module-dev/read')!({ id: '../escape', file: 'src/module.ts' }, hostContext())).rejects.toThrow('invalid-module-id')
    await expect(tools.get('module-dev/write')!({ id: 'example', file: '../outside.ts', expectedContent: '', content: '' }, hostContext())).rejects.toThrow('outside-module')
    await expect(tools.get('module-dev/read')!({ id: 'example', file: '.env' }, hostContext())).rejects.toThrow('sensitive-file-forbidden')
    await expect(tools.get('module-dev/read')!({ id: 'example', file: 'src/.hidden' }, hostContext())).rejects.toThrow('file-path-outside-module')
    await expect(tools.get('module-dev/read')!({ id: 'missing', file: 'src/module.ts' }, hostContext())).rejects.toThrow('module-not-found')
    const other = hostContext()
    other.request.moduleRef = 'other-module@1.0.0'
    await expect(tools.get('module-dev/read')!({ id: 'example', file: 'src/module.ts' }, other)).rejects.toThrow('module-dev-caller-forbidden')
  })

  it('propagates cancellation to a running validation subprocess', async () => {
    const root = workspace()
    const controller = new AbortController()
    const seen: AbortSignal[] = []
    const tools = createModuleDevHostTools(root, {
      sandbox: { confine: argv => ({ argv: [...argv] }) },
      subprocess: {
        spawn: (spec) => {
          seen.push(spec.signal)
          return {
            collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } },
            done: spec.signal.aborted
              ? Promise.resolve({ exitCode: null })
              : new Promise((resolve) => {
                spec.signal.addEventListener('abort', () => { resolve({ exitCode: null }) }, { once: true })
              }),
          }
        },
      },
    })
    const context = hostContext()
    context.run.signal = controller.signal
    const pending = tools.get('module-dev/test')!({ id: 'example' }, context)
    controller.abort('cancelled by test')

    await expect(pending).resolves.toMatchObject({ action: 'test', ok: false, code: null })
    expect(seen).toEqual([controller.signal])
  })

  it('confines fixed validation commands and preserves bounded output', async () => {
    const root = workspace()
    const confined: Array<{ argv: readonly string[]; policy: { mode: string; workspaceRoot: string; sessionId?: string } }> = []
    const spawned: Array<{ argv: readonly string[]; signal: AbortSignal; env?: Record<string, string> }> = []
    const runtime = {
      sandbox: {
        confine: (argv: readonly string[], policy: { mode: 'read-only' | 'workspace-write'; workspaceRoot: string; sessionId?: string }) => {
          confined.push({ argv, policy })
          return { argv: ['sandbox', ...argv] }
        },
      },
      subprocess: {
        spawn: (spec: { argv: readonly string[]; signal: AbortSignal }) => {
          spawned.push(spec)
          return {
            collected: {
              stdout: { readFrom: () => ({ text: 'x'.repeat(5000) }) },
              stderr: { readFrom: () => ({ text: 'tail' }) },
            },
            done: Promise.resolve({ exitCode: 0 }),
          }
        },
      },
    }
    const tools = createModuleDevHostTools(root, runtime)
    const context = hostContext()

    for (const action of ['test', 'lint', 'typecheck'] as const) {
      await expect(tools.get(`module-dev/${action}`)!({ id: 'example' }, context)).resolves.toMatchObject({ action, ok: true, code: 0 })
    }

    expect(confined).toHaveLength(3)
    expect(confined[0]?.policy.mode).toBe('workspace-write')
    expect(confined[0]?.policy.workspaceRoot).not.toBe(join(root, 'packages/experimental/example-profile'))
    expect(confined.slice(1).every(call => call.policy.mode === 'read-only' && call.policy.workspaceRoot === join(root, 'packages/experimental/example-profile'))).toBe(true)
    expect(confined.every(call => call.policy.sessionId === context.request.sessionId)).toBe(true)
    expect(confined[0]?.argv).toEqual(expect.arrayContaining(['--no-cache', '--configLoader', 'native', '--pool', 'threads', '--maxWorkers', '1']))
    expect(confined[1]?.argv[1]).toMatch(/scripts[\\/]run-oxlint\.ts$/u)
    expect(confined[1]?.argv).not.toContain('tsx/esm')
    expect(confined[2]?.argv).toEqual(expect.arrayContaining(['--noEmit', '--composite', 'false', '--incremental', 'false']))
    expect(spawned.every(call => call.argv[0] === 'sandbox' && call.signal === context.run.signal)).toBe(true)
    expect(spawned[0]?.env).toEqual({ MODULE_DEV_RESTRICTED_VALIDATION: '1' })
    expect(spawned.slice(1).every(call => call.env === undefined)).toBe(true)
    expect((await tools.get('module-dev/test')!({ id: 'example' }, context) as { output: string }).output).toHaveLength(4000)
  })

  it('runs scaffold creation and rollback only for the v3 builder', async () => {
    const root = workspace()
    const calls: Array<{ argv: readonly string[]; mode: string; root: string; sessionId: string | undefined }> = []
    const signals: AbortSignal[] = []
    const tools = createModuleDevHostTools(root, {
      sandbox: {
        confine: (argv, policy) => {
          calls.push({ argv, mode: policy.mode, root: policy.workspaceRoot, sessionId: policy.sessionId })
          return { argv: [...argv] }
        },
      },
      subprocess: {
        spawn: (spec) => {
          signals.push(spec.signal)
          return {
            collected: { stdout: { readFrom: () => ({ text: 'ok' }) }, stderr: { readFrom: () => ({ text: '' }) } },
            done: Promise.resolve({ exitCode: 0 }),
          }
        },
      },
    })
    const context = hostContext()
    const controller = new AbortController()
    context.run.signal = controller.signal
    await expect(tools.get('module-dev/create')!({ id: 'fresh', name: '新模块', description: '创建新模块' }, context))
      .rejects.toThrow('module-dev-caller-forbidden')
    context.request.moduleRef = 'module-developer@3.0.0'
    context.request.input = { id: 'fresh' }
    const created = await tools.get('module-dev/create')!({ id: 'fresh', name: '新模块', description: '创建新模块' }, context) as { action: string; ok: boolean; cleanup: () => Promise<unknown> }
    expect(created).toMatchObject({ action: 'create', ok: true })
    await expect(tools.get('module-dev/remove')!({ id: 'fresh' }, context))
      .resolves.toMatchObject({ action: 'remove', ok: true })
    controller.abort('timeout')
    await created.cleanup()
    expect(calls).toHaveLength(3)
    expect(calls.every(call => call.mode === 'workspace-write' && call.root === root && call.sessionId === context.request.sessionId)).toBe(true)
    expect(calls.every(call => /scripts[\\/]create-module\.ts$/u.test(call.argv[1] ?? '') && !call.argv.includes('tsx/esm'))).toBe(true)
    expect(calls[0]?.argv).toEqual(expect.arrayContaining(['--id', 'fresh', '--name', '新模块', '--description', '创建新模块']))
    expect(calls[1]?.argv).toEqual(expect.arrayContaining(['--remove', '--id', 'fresh']))
    expect(calls[2]?.argv).toEqual(expect.arrayContaining(['--remove', '--id', 'fresh']))
    expect(signals.map(signal => signal.aborted)).toEqual([true, true, false])
  })

  it('registers and releases all private Host tools', () => {
    const registrations: string[] = []
    const releases: string[] = []
    const effects: Array<() => void> = []
    applyTools({
      sandbox: {}, subprocess: {},
      moduleScheduler: { registerHostTool: (name: string) => { registrations.push(name); return () => { releases.push(name) } } },
      effect: (setup: () => () => void) => { effects.push(setup()) },
    } as unknown as Context)
    expect(registrations).toEqual([
      'module-dev/create', 'module-dev/remove', 'module-dev/read', 'module-dev/write', 'module-dev/changes',
      'module-dev/test', 'module-dev/lint', 'module-dev/typecheck',
    ])
    for (const dispose of effects) dispose()
    expect(releases).toEqual(registrations)
  })
})

describe('module developer definition', () => {
  it('registers the fixed tool allowlist and releases it', () => {
    const definitions: ModuleDefinition[] = []
    let cleanup: (() => void) | undefined
    const unregister = vi.fn()
    applyModule({
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definitions.push(value); return `${value.id}@${value.version}` }, unregister } },
      effect: (setup: () => () => void) => { cleanup = setup() },
    } as unknown as Context)
    expect(definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'module-developer', version: '1.0.0', displayName: '模块开发助手' }),
      expect.objectContaining({ id: 'module-developer', version: '2.0.0', displayName: '受管模块开发助手', requiresAgent: true }),
      expect.objectContaining({ id: 'module-developer', version: '3.0.0', displayName: '受管模块构建助手', requiresAgent: true }),
    ]))
    const existingTools = ['module-dev/read', 'module-dev/write', 'module-dev/test', 'module-dev/lint', 'module-dev/typecheck']
    expect(definitions.find(value => value.version === '1.0.0')?.tools).toEqual(existingTools)
    expect(definitions.find(value => value.version === '2.0.0')?.tools).toEqual([...existingTools, 'module-dev/changes'])
    expect(definitions.find(value => value.version === '3.0.0')?.tools).toEqual([
      'module-dev/create', 'module-dev/remove', ...existingTools,
    ])
    cleanup!()
    expect(unregister).toHaveBeenCalledWith('module-developer@1.0.0')
    expect(unregister).toHaveBeenCalledWith('module-developer@2.0.0')
    expect(unregister).toHaveBeenCalledWith('module-developer@3.0.0')
  })

  it('runs existing-module development as a freeform Luna task and verifies it in the host', async () => {
    const definitions: ModuleDefinition[] = []
    applyModule({
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definitions.push(value); return `${value.id}@${value.version}` }, unregister: vi.fn() } },
      effect: () => undefined,
    } as unknown as Context)
    const managed = definitions.find(value => value.version === '2.0.0')!
    expect(managed.resourcePolicy.timeoutMs).toBe(300_000)
    const run = vi.fn().mockResolvedValue('implemented with evidence')
    const changes = vi.fn().mockResolvedValueOnce({ token: 'snapshot' }).mockResolvedValueOnce({ changedFiles: ['src/module.ts'] })
    const tools = new Map([
      ['module-dev/changes', changes],
      ['module-dev/test', vi.fn().mockResolvedValue({ action: 'test', ok: true })],
      ['module-dev/lint', vi.fn().mockResolvedValue({ action: 'lint', ok: true })],
      ['module-dev/typecheck', vi.fn().mockResolvedValue({ action: 'typecheck', ok: true })],
    ])

    await expect(managed.execute({
      sessionId: 's', taskId: 't', runId: 'r', signal: new AbortController().signal,
      input: { id: 'module-scheduler', task: '实现自由任务模式' }, tools, agent: { run },
    })).resolves.toEqual({
      ok: true, changedFiles: ['src/module.ts'], attempts: 1, repaired: false, rolledBack: false,
      checks: [{ name: 'test', ok: true }, { name: 'lint', ok: true }, { name: 'typecheck', ok: true }],
      summary: 'implemented with evidence',
    })
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty('modelTier')
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty('outputSchema')
    expect(run.mock.calls[0]?.[0].tools).not.toContain('module-dev/changes')
    expect(changes).toHaveBeenNthCalledWith(1, { id: 'module-scheduler', action: 'begin' })
    expect(changes).toHaveBeenNthCalledWith(2, { id: 'module-scheduler', action: 'end', token: 'snapshot' })
  })

  it('gives the managed agent one repair attempt after host validation fails', async () => {
    const definitions: ModuleDefinition[] = []
    applyModule({
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definitions.push(value); return `${value.id}@${value.version}` }, unregister: vi.fn() } },
      effect: () => undefined,
    } as unknown as Context)
    const managed = definitions.find(value => value.version === '2.0.0')!
    const run = vi.fn().mockResolvedValueOnce('first attempt').mockResolvedValueOnce('repaired')
    const changes = vi.fn().mockResolvedValueOnce({ token: 'snapshot' }).mockResolvedValueOnce({ changedFiles: ['src/module.ts'] })
    const test = vi.fn().mockResolvedValueOnce({ action: 'test', ok: false, output: 'expected after to be before' }).mockResolvedValueOnce({ action: 'test', ok: true })
    const tools = new Map([
      ['module-dev/changes', changes],
      ['module-dev/test', test],
      ['module-dev/lint', vi.fn().mockResolvedValue({ action: 'lint', ok: true })],
      ['module-dev/typecheck', vi.fn().mockResolvedValue({ action: 'typecheck', ok: true })],
    ])

    await expect(managed.execute({
      sessionId: 's', taskId: 't', runId: 'r', signal: new AbortController().signal,
      input: { id: 'module-scheduler', task: '实现并修复功能' }, tools, agent: { run },
    })).resolves.toEqual({
      ok: true, changedFiles: ['src/module.ts'], attempts: 2, repaired: true, rolledBack: false,
      checks: [{ name: 'test', ok: true }, { name: 'lint', ok: true }, { name: 'typecheck', ok: true }],
      summary: 'repaired',
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1]?.[0].task).toContain('expected after to be before')
    expect(changes).toHaveBeenNthCalledWith(2, { id: 'module-scheduler', action: 'end', token: 'snapshot' })
  })

  it('rolls back after the single repair attempt still fails', async () => {
    const definitions: ModuleDefinition[] = []
    applyModule({
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definitions.push(value); return `${value.id}@${value.version}` }, unregister: vi.fn() } },
      effect: () => undefined,
    } as unknown as Context)
    const managed = definitions.find(value => value.version === '2.0.0')!
    const run = vi.fn().mockResolvedValue('still failing')
    const changes = vi.fn().mockResolvedValueOnce({ token: 'snapshot' }).mockResolvedValueOnce({ changedFiles: ['src/module.ts'] })
    const tools = new Map([
      ['module-dev/changes', changes],
      ['module-dev/test', vi.fn().mockResolvedValue({ action: 'test', ok: false, output: 'persistent failure' })],
      ['module-dev/lint', vi.fn().mockResolvedValue({ action: 'lint', ok: true })],
      ['module-dev/typecheck', vi.fn().mockResolvedValue({ action: 'typecheck', ok: true })],
    ])

    await expect(managed.execute({
      sessionId: 's', taskId: 't', runId: 'r', signal: new AbortController().signal,
      input: { id: 'module-scheduler', task: '实现功能' }, tools, agent: { run },
    })).resolves.toEqual({
      ok: false, changedFiles: ['src/module.ts'], attempts: 2, repaired: false, rolledBack: true,
      checks: [{ name: 'test', ok: false }, { name: 'lint', ok: true }, { name: 'typecheck', ok: true }],
      summary: 'still failing',
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(changes).toHaveBeenNthCalledWith(2, { id: 'module-scheduler', action: 'rollback', token: 'snapshot' })
  })

  it('pins new module construction to Luna or Terra and rejects Sol', async () => {
    const definitions: ModuleDefinition[] = []
    applyModule({
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definitions.push(value); return `${value.id}@${value.version}` }, unregister: vi.fn() } },
      effect: () => undefined,
    } as unknown as Context)
    const builder = definitions.find(value => value.version === '3.0.0')!
    const run = vi.fn().mockResolvedValue({ ok: true, changedFiles: [], checks: [], summary: 'done' })
    const create = vi.fn().mockResolvedValue({ ok: true })
    const remove = vi.fn().mockResolvedValue({ ok: true })
    const base = {
      sessionId: 's', taskId: 't', runId: 'r', signal: new AbortController().signal,
      tools: new Map([
        ['module-dev/create', create], ['module-dev/remove', remove],
        ['module-dev/test', vi.fn().mockResolvedValue({ action: 'test', ok: true })],
        ['module-dev/lint', vi.fn().mockResolvedValue({ action: 'lint', ok: true })],
        ['module-dev/typecheck', vi.fn().mockResolvedValue({ action: 'typecheck', ok: true })],
      ]),
      agent: { run },
    }

    await builder.execute({ ...base, input: { id: 'example', name: '示例模块', description: '构建示例模块', task: '实现功能', modelTier: 'luna' } })
    await builder.execute({ ...base, input: { id: 'example', name: '示例模块', description: '构建示例模块', task: '实现功能', modelTier: 'terra' } })
    expect(run.mock.calls.map(([request]) => (request as { modelTier: string }).modelTier)).toEqual(['luna', 'terra'])
    expect(create).toHaveBeenCalledTimes(2)
    expect(remove).not.toHaveBeenCalled()
    await expect(builder.execute({ ...base, input: { id: 'example', name: '示例模块', description: '构建示例模块', task: '实现功能', modelTier: 'luna' }, tools: new Map([
      ['module-dev/create', vi.fn().mockResolvedValue({ ok: false, code: 1, output: 'anchor missing' })],
    ]) })).rejects.toThrow('module-dev-create-failed (1): anchor missing')
    run.mockResolvedValueOnce({ ok: false, changedFiles: [], checks: [], summary: 'failed' })
    await builder.execute({ ...base, input: { id: 'example', name: '示例模块', description: '构建示例模块', task: '实现功能', modelTier: 'luna' } })
    expect(remove).toHaveBeenCalledWith({ id: 'example' })
    await expect(builder.execute({ ...base, input: { id: 'example', name: '示例模块', description: '构建示例模块', task: '实现功能', modelTier: 'sol' } }))
      .rejects.toThrow('module-dev-model-tier-forbidden')
  })

  it('starts one independent scaffold cleanup on abort and reuses it when execution rejects', async () => {
    const definitions: ModuleDefinition[] = []
    applyModule({
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definitions.push(value); return `${value.id}@${value.version}` }, unregister: vi.fn() } },
      effect: () => undefined,
    } as unknown as Context)
    const builder = definitions.find(value => value.version === '3.0.0')!
    const controller = new AbortController()
    const cleanup = vi.fn().mockResolvedValue({ ok: true })
    const remove = vi.fn().mockResolvedValue({ ok: true })
    let rejectRun!: (error: Error) => void
    const run = vi.fn(() => new Promise((_resolve, reject) => { rejectRun = reject }))
    const execution = builder.execute({
      sessionId: 's', taskId: 't', runId: 'r', signal: controller.signal,
      input: { id: 'example', name: '示例模块', description: '构建示例模块', task: '实现功能', modelTier: 'terra' },
      tools: new Map([
        ['module-dev/create', vi.fn().mockResolvedValue({ ok: true, cleanup })],
        ['module-dev/remove', remove],
      ]),
      agent: { run },
    })
    await vi.waitFor(() => { expect(run).toHaveBeenCalledOnce() })
    controller.abort('timeout')
    await vi.waitFor(() => { expect(cleanup).toHaveBeenCalledOnce() })
    rejectRun(new Error('cancelled'))
    await expect(execution).rejects.toThrow('cancelled')
    expect(cleanup).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()
  })

  it('restores the original file when validation throws', async () => {
    const definitions: ModuleDefinition[] = []
    applyModule({
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definitions.push(value); return `${value.id}@${value.version}` }, unregister: vi.fn() } },
      effect: () => undefined,
    } as unknown as Context)
    let content = 'before'
    const tools = new Map([
      ['module-dev/read', vi.fn().mockResolvedValue({ content })],
      ['module-dev/write', vi.fn(async (input: { expectedContent: string; content: string }) => { content = input.content; return { bytes: content.length } })],
      ['module-dev/test', vi.fn().mockRejectedValue(new Error('validation-crashed'))],
      ['module-dev/lint', vi.fn()],
      ['module-dev/typecheck', vi.fn()],
    ])
    await expect(definitions.find(value => value.version === '1.0.0')!.execute({
      sessionId: 's', taskId: 't', runId: 'r', signal: new AbortController().signal,
      input: { id: 'example', file: 'src/module.ts', content: 'after' }, tools,
    })).rejects.toThrow('validation-crashed')
    expect(content).toBe('before')
  })

  it('reports failed validation and restores the original file', async () => {
    const definitions: ModuleDefinition[] = []
    applyModule({
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definitions.push(value); return `${value.id}@${value.version}` }, unregister: vi.fn() } },
      effect: () => undefined,
    } as unknown as Context)
    let content = 'before'
    const write = vi.fn(async (input: { expectedContent: string; content: string }) => {
      if (content !== input.expectedContent) throw new Error('module-file-changed')
      content = input.content
      return { bytes: content.length }
    })
    const tools = new Map([
      ['module-dev/read', vi.fn().mockResolvedValue({ content })],
      ['module-dev/write', write],
      ['module-dev/test', vi.fn().mockResolvedValue({ ok: false })],
      ['module-dev/lint', vi.fn().mockResolvedValue({ ok: true })],
      ['module-dev/typecheck', vi.fn().mockResolvedValue({ ok: true })],
    ])
    const output = await definitions.find(value => value.version === '1.0.0')!.execute({
      sessionId: 's', taskId: 't', runId: 'r', signal: new AbortController().signal,
      input: { id: 'example', file: 'src/module.ts', content: 'after' }, tools,
    })
    expect(output).toMatchObject({ ok: false })
    expect(content).toBe('before')
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ expectedContent: 'after', content: 'before' }))
  })
})
