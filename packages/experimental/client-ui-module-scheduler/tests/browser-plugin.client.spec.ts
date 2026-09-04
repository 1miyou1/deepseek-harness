import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-experimental-module-scheduler/remote'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { ModuleSchedulerAction, type ModuleSchedulerActionInjected } from '../src/client/ModuleSchedulerAction.tsx'
import { inject, mountModuleSchedulerUi } from '../src/client/mount.ts'
import { apply as nodeApply } from '../src/index.ts'

const SESSION = 'module-session' as SessionId
const REMOTE: TypertRemoteContribution = {
  package: '@deepseek-ai/dsh-experimental-module-scheduler',
  descriptors: [],
}

async function bench(registrationFailure = false) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  class RemoteService extends Service {
    readonly disposeMount = vi.fn(() => Promise.resolve())
    readonly mount = vi.fn((_contribution: unknown) => Promise.resolve(this.disposeMount))

    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }

    $mount(contribution: unknown): Promise<() => Promise<void>> {
      return this.mount(contribution)
    }
  }
  const remote = new RemoteService(ctx)
  const answer = <T>(method: string, value: T) => (...args: unknown[]) => {
    calls.push({ method, args })
    return Promise.resolve({ ok: true as const, value })
  }
  const run = { runId: 'run-1', taskId: 'task-1', moduleRef: 'echo@1', status: 'created' as const }
  ctx.provide('remote.moduleScheduler', {
    view: answer('moduleScheduler/view', { modules: [], runs: [] }),
    start: answer('moduleScheduler/start', { ok: true as const, value: run }),
    cancel: answer('moduleScheduler/cancel', { ok: true as const, value: true }),
  })
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  if (registrationFailure) {
    vi.spyOn(ctx.slots, 'inject').mockImplementationOnce(() => { throw new Error('slot registration failed') })
  }
  const activation = mountModuleSchedulerUi(ctx, REMOTE).catch((error: unknown) => error)
  if (!registrationFailure) await activation
  const entry = () => ctx.slots.entries('conversation.session.header.actions')
    .find(candidate => candidate.component === ModuleSchedulerAction)
  return { activation, calls, ctx, entry, remote }
}

describe('module scheduler browser plugin', () => {
  it('mounts Remote methods and registers an order-30 disposable header action', async () => {
    const b = await bench()
    expect(inject).toEqual(['remote', 'slots', 'locale'])
    expect(b.entry()).toMatchObject({
      options: { id: 'module-scheduler', order: 30 },
      locale: 'module-scheduler',
    })
    expect(b.remote.mount).toHaveBeenCalledWith(REMOTE)
    const actions = (b.entry()!.inject as unknown as () => ModuleSchedulerActionInjected)()
    await actions.load(SESSION)
    await actions.start(SESSION, { taskId: 'task-1', moduleRef: 'echo@1', input: {} })
    await actions.cancel(SESSION, 'run-1')
    expect(b.calls).toEqual([
      { method: 'moduleScheduler/view', args: [SESSION] },
      { method: 'moduleScheduler/start', args: [SESSION, { taskId: 'task-1', moduleRef: 'echo@1', input: {} }] },
      { method: 'moduleScheduler/cancel', args: [SESSION, 'run-1'] },
    ])
    const dispose = await b.activation as () => Promise<void>
    await dispose()
    expect(b.entry()).toBeUndefined()
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
  })

  it('unmounts Remote when later Client registration fails', async () => {
    const b = await bench(true)
    await expect(b.activation).resolves.toMatchObject({ message: 'slot registration failed' })
    expect(b.remote.disposeMount).toHaveBeenCalledOnce()
  })

  it('keeps the host half inert', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
