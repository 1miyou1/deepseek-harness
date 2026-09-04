import { Context } from '@deepseek-ai/cordis'
import ModuleSchedulerService from '@deepseek-ai/dsh-experimental-module-scheduler'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime, { type WebSearchProvider } from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as NetworkResearch from '../src/network-research.ts'

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
    expect(ctx.moduleScheduler.remoteView('session-a').modules).toMatchObject([{
      ref: 'network-research@1.0.0', tools: [], runnableFromBrowser: true,
    }])

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
