import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { HostToolContext, ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyModule, applyTools, createModuleDevHostTools } from '../src/module-dev.ts'

const roots: string[] = []

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-module-dev-'))
  roots.push(root)
  const module = join(root, 'packages/experimental/example-profile')
  mkdirSync(join(module, 'src'), { recursive: true })
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

  it('confines fixed validation commands and preserves bounded output', async () => {
    const root = workspace()
    const confined: Array<{ argv: readonly string[]; policy: { mode: string; workspaceRoot: string } }> = []
    const spawned: Array<{ argv: readonly string[]; signal: AbortSignal }> = []
    const runtime = {
      sandbox: {
        confine: (argv: readonly string[], policy: { mode: 'read-only' | 'workspace-write'; workspaceRoot: string }) => {
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
    expect(confined.every(call => call.policy.mode === 'read-only' && call.policy.workspaceRoot.endsWith('example-profile'))).toBe(true)
    expect(confined[0]?.argv).toEqual(expect.arrayContaining(['--no-cache', '--configLoader', 'native', '--pool', 'threads', '--maxWorkers', '1']))
    expect(confined[1]?.argv[2]).toMatch(/^file:\/\//u)
    expect(confined[2]?.argv).toEqual(expect.arrayContaining(['--noEmit', '--composite', 'false', '--incremental', 'false']))
    expect(spawned.every(call => call.argv[0] === 'sandbox' && call.signal === context.run.signal)).toBe(true)
    expect((await tools.get('module-dev/test')!({ id: 'example' }, context) as { output: string }).output).toHaveLength(4000)
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
    expect(registrations).toEqual(['module-dev/read', 'module-dev/write', 'module-dev/test', 'module-dev/lint', 'module-dev/typecheck'])
    for (const dispose of effects) dispose()
    expect(releases).toEqual(registrations)
  })
})

describe('module developer definition', () => {
  it('registers the fixed tool allowlist and releases it', () => {
    let definition: ModuleDefinition | undefined
    let cleanup: (() => void) | undefined
    const unregister = vi.fn()
    applyModule({
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definition = value; return 'module-developer@1.0.0' }, unregister } },
      effect: (setup: () => () => void) => { cleanup = setup() },
    } as unknown as Context)
    expect(definition).toMatchObject({
      id: 'module-developer',
      displayName: '模块开发助手',
      tools: ['module-dev/read', 'module-dev/write', 'module-dev/test', 'module-dev/lint', 'module-dev/typecheck'],
    })
    cleanup!()
    expect(unregister).toHaveBeenCalledWith('module-developer@1.0.0')
  })

  it('reports a failed validation instead of claiming success', async () => {
    let definition: ModuleDefinition | undefined
    applyModule({
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definition = value; return 'module-developer@1.0.0' }, unregister: vi.fn() } },
      effect: () => undefined,
    } as unknown as Context)
    const tools = new Map([
      ['module-dev/read', vi.fn().mockResolvedValue({ content: 'before' })],
      ['module-dev/write', vi.fn().mockResolvedValue({ bytes: 5 })],
      ['module-dev/test', vi.fn().mockResolvedValue({ ok: false })],
      ['module-dev/lint', vi.fn().mockResolvedValue({ ok: true })],
      ['module-dev/typecheck', vi.fn().mockResolvedValue({ ok: true })],
    ])
    const output = await definition!.execute({
      sessionId: 's', taskId: 't', runId: 'r', signal: new AbortController().signal,
      input: { id: 'example', file: 'src/module.ts', content: 'after' }, tools,
    })
    expect(output).toMatchObject({ ok: false })
  })
})
