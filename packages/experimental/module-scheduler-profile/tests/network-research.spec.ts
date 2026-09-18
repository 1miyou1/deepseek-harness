import { Context } from '@deepseek-ai/cordis'
import ModuleSchedulerService, { type HostTool, type HostToolContext, type ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime, { type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as NetworkResearch from '../src/network-research.ts'

const readWebPage = vi.hoisted(() => vi.fn())
vi.mock('@deepseek-ai/dsh-experimental-web-reader-profile', () => ({ readWebPage }))

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup(provider: WebSearchProvider) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ModuleSchedulerService)
  await ctx.plugin(WebRuntime)
  ctx.web.registerSearchProvider(provider)
  return ctx
}

describe('network research module', () => {
  it('registers a real web-backed module, runs it, and projects its result', async () => {
    let observedQuery: unknown
    const ctx = await setup({
      id: 'test', available: () => true,
      search: async ({ query }) => {
        observedQuery = query
        return {
          content: 'verified summary',
          sources: [{ url: 'https://example.com', title: 'Example' }],
          truncated: false,
        }
      },
    })

    const fiber = ctx.plugin(NetworkResearch)
    await fiber
    expect(ctx.moduleScheduler.remoteView('session-a').modules.find(module => module.ref === 'network-research@1.0.0')).toMatchObject({
      ref: 'network-research@1.0.0', displayName: '网络调研', description: '使用已配置的网络搜索服务调研当前信息', tools: [], runnableFromBrowser: true,
    })

    expect(ctx.moduleScheduler.remoteStart('session-a', {
      taskId: 'research-1', moduleRef: 'network-research@1.0.0', input: { query: 'current DSH release' },
    })).toMatchObject({ ok: true })
    await vi.waitFor(() => {
      expect(ctx.moduleScheduler.remoteView('session-a').runs[0]).toMatchObject({
        status: 'succeeded',
        output: {
          content: 'verified summary',
          sources: [{ url: 'https://example.com', title: 'Example' }],
          truncated: false,
        },
      })
    })
    expect(observedQuery).toBe('current DSH release')

    await fiber.dispose()
    expect(ctx.moduleScheduler.remoteView('session-a').modules).toEqual([])
  })

  it('registers a freeform v2 agent and supplements insufficient evidence once', async () => {
    const definitions: ModuleDefinition[] = []
    const registeredTools: string[] = []
    NetworkResearch.apply({
      web: {},
      moduleScheduler: {
        registry: { register: (value: ModuleDefinition) => { definitions.push(value); return `${value.id}@${value.version}` }, unregister: vi.fn() },
        registerHostTool: (name: string) => { registeredTools.push(name); return () => undefined },
      },
      effect: () => undefined,
    } as unknown as Context)

    expect(registeredTools).toEqual(['network-research/search', 'network-research/fetch', 'network-research/evidence'])
    const managed = definitions.find(value => value.version === '2.0.0')!
    expect(managed.resourcePolicy.timeoutMs).toBe(300_000)
    expect(managed.tools).toEqual(['network-research/search', 'network-research/fetch', 'network-research/evidence'])
    const evidence = vi.fn()
      .mockResolvedValueOnce({ token: 'evidence' })
      .mockResolvedValueOnce({ sources: ['https://one.example'], fetched: [] })
      .mockResolvedValueOnce({ sources: ['https://one.example', 'https://two.example'], fetched: ['https://one.example'] })
    const run = vi.fn().mockResolvedValueOnce('first report').mockResolvedValueOnce('supplemented report')

    await expect(managed.execute({
      sessionId: 's', taskId: 't', runId: 'r', signal: new AbortController().signal,
      input: { query: 'current topic' }, agent: { run }, tools: new Map([['network-research/evidence', evidence]]),
    })).resolves.toEqual({
      ok: true, report: 'supplemented report', sources: ['https://one.example', 'https://two.example'], attempts: 2, supplemented: true,
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0]?.[0].tools).toEqual(['network-research/search', 'network-research/fetch'])
    expect(run.mock.calls[0]?.[0].maxSteps).toBe(8)
    expect(run.mock.calls[0]?.[0].task).toContain('search 最多调用 2 次')
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty('outputSchema')
    expect(run.mock.calls[1]?.[0].task).toContain('来源不足')
  })

  it('records only searched sources and successfully fetched bodies as host evidence', async () => {
    const registered = new Map<string, HostTool>()
    readWebPage.mockResolvedValue({ ok: true, url: 'https://one.example', status: 200, content: 'x'.repeat(20_000) })
    NetworkResearch.apply({
      web: {
        search: vi.fn().mockResolvedValue({ sources: [{ url: 'https://one.example' }, { url: 'https://two.example' }], truncated: false }),
        fetch: vi.fn().mockRejectedValue(new Error('legacy-fetch-must-not-run')),
      },
      moduleScheduler: {
        registry: { register: (value: ModuleDefinition) => `${value.id}@${value.version}`, unregister: vi.fn() },
        registerHostTool: (name: string, tool: HostTool) => { registered.set(name, tool); return () => undefined },
      },
      effect: () => undefined,
    } as unknown as Context)
    const context = {
      request: { sessionId: 's', taskId: 'research', moduleRef: 'network-research@2.0.0' },
      run: { runId: 'r', sessionId: 's', taskId: 'research', moduleRef: 'network-research@2.0.0', status: 'running', validated: false, signal: new AbortController().signal },
    } as HostToolContext
    const started = await registered.get('network-research/evidence')!({ action: 'begin' }, context) as { token: string }
    await registered.get('network-research/search')!({ query: 'topic' }, context)
    const fetched = await registered.get('network-research/fetch')!({ url: 'https://one.example' }, context) as { body: { content: string }; truncated: boolean }
    expect(fetched.body.content).toHaveLength(12_000)
    expect(fetched.truncated).toBe(true)
    expect(readWebPage).toHaveBeenCalledWith({ url: 'https://one.example', maxLength: 12_000 }, context.run.signal)
    await expect(registered.get('network-research/evidence')!({ action: 'end', token: started.token }, context)).resolves.toEqual({
      sources: ['https://one.example', 'https://two.example'], fetched: ['https://one.example'],
    })
  })

  it('cancels an in-flight provider request through the run signal', async () => {
    const ctx = await setup({
      id: 'test', available: () => true,
      search: async (_request, signal) => await new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('search cancelled')) }, { once: true })
      }),
    })
    await ctx.plugin(NetworkResearch)

    const started = ctx.moduleScheduler.remoteStart('session-a', {
      taskId: 'cancel', moduleRef: 'network-research@1.0.0', input: { query: 'topic' },
    })
    if (!started.ok) throw new Error(started.error.message)
    expect(ctx.moduleScheduler.remoteCancel('session-a', started.value.runId)).toEqual({ ok: true, value: true })
    await vi.waitFor(() => {
      expect(ctx.moduleScheduler.remoteView('session-a').runs[0]).toMatchObject({ status: 'cancelled' })
    })
  })

  it('keeps invalid input and provider failures explicit', async () => {
    const ctx = await setup({
      id: 'test', available: () => true,
      search: async () => { throw new Error('provider unavailable') },
    })
    await ctx.plugin(NetworkResearch)

    expect(ctx.moduleScheduler.remoteStart('session-a', {
      taskId: 'invalid', moduleRef: 'network-research@1.0.0', input: {},
    })).toMatchObject({ ok: false, error: { code: 'input-schema-invalid' } })

    ctx.moduleScheduler.remoteStart('session-a', {
      taskId: 'failed', moduleRef: 'network-research@1.0.0', input: { query: 'topic' },
    })
    await vi.waitFor(() => {
      const run = ctx.moduleScheduler.remoteView('session-a').runs[0]
      expect(run?.status).toBe('failed')
      expect(run?.reason).toContain('provider unavailable')
    })
  })
})
