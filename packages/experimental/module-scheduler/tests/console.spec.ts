import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import ModuleSchedulerService, { type ModuleDefinition } from '../src/index.ts'

const contexts: Context[] = []
const valueSchema = {
  type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'string' } },
} as const

function moduleDefinition(id: string, execute: ModuleDefinition['execute'], tools: readonly string[] = []): ModuleDefinition {
  return {
    id, version: '1.0.0', description: id, tools, inputSchema: valueSchema, outputSchema: valueSchema,
    resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 1_000 }, execute,
  }
}

async function setup(maxRecentRuns = 2): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ModuleSchedulerService, { maxRecentRuns })
  return ctx
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('module scheduler browser control contract', () => {
  it('lists registered modules and isolates run views by session', async () => {
    const ctx = await setup()
    ctx.moduleScheduler.registry.register(moduleDefinition('reader', async ({ input }) => input))

    expect(ctx.moduleScheduler.remoteView('session-a')).toEqual({
      modules: [{
        ref: 'reader@1.0.0', id: 'reader', version: '1.0.0', description: 'reader', tools: [],
        inputSchema: valueSchema, runnableFromBrowser: true,
      }],
      runs: [],
    })

    const started = ctx.moduleScheduler.remoteStart('session-a', {
      taskId: 'task-a', moduleRef: 'reader@1.0.0', input: { value: 'ok' },
    })
    expect(started).toMatchObject({ ok: true, value: { taskId: 'task-a', moduleRef: 'reader@1.0.0' } })
    await viWait()

    expect(ctx.moduleScheduler.remoteView('session-a').runs).toMatchObject([{ status: 'succeeded' }])
    expect(ctx.moduleScheduler.remoteView('session-b').runs).toEqual([])
  })

  it('rejects tool modules from the browser control surface', async () => {
    const ctx = await setup()
    let executed = false
    ctx.moduleScheduler.registry.register(moduleDefinition('writer', async () => {
      executed = true
      return { value: 'unused' }
    }, ['write']))

    expect(ctx.moduleScheduler.remoteStart('session-a', {
      taskId: 'task-a', moduleRef: 'writer@1.0.0', input: { value: 'x' },
    })).toEqual({ ok: false, error: { code: 'module-requires-agent', message: 'module-requires-agent' } })
    expect(executed).toBe(false)
  })

  it('cancels only runs owned by the requested session', async () => {
    const ctx = await setup()
    ctx.moduleScheduler.registry.register(moduleDefinition('slow', async ({ signal }) => await new Promise((resolve) => {
      signal.addEventListener('abort', () => { resolve({ value: 'cancelled' }) }, { once: true })
    })))
    const started = ctx.moduleScheduler.remoteStart('session-a', {
      taskId: 'task-a', moduleRef: 'slow@1.0.0', input: { value: 'x' },
    })
    if (!started.ok) throw new Error(started.error.message)

    expect(ctx.moduleScheduler.remoteCancel('session-b', started.value.runId)).toEqual({
      ok: false, error: { code: 'run-not-found', message: 'run-not-found' },
    })
    expect(ctx.moduleScheduler.remoteCancel('session-a', started.value.runId)).toEqual({
      ok: true, value: true,
    })
    await viWait()
    expect(ctx.moduleScheduler.remoteView('session-a').runs[0]?.status).toBe('cancelled')
  })

  it('keeps only the configured number of terminal runs per session', async () => {
    const ctx = await setup(2)
    ctx.moduleScheduler.registry.register(moduleDefinition('reader', async ({ input }) => input))
    for (const taskId of ['one', 'two', 'three']) {
      ctx.moduleScheduler.remoteStart('session-a', {
        taskId, moduleRef: 'reader@1.0.0', input: { value: taskId },
      })
      await viWait()
    }

    expect(ctx.moduleScheduler.remoteView('session-a').runs.map(run => run.taskId)).toEqual(['three', 'two'])
  })
})

async function viWait(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}
