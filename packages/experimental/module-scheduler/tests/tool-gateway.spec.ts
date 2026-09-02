import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import ModuleSchedulerService from '../src/index.ts'

const contexts: Context[] = []
const schema = { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'string' } } } as const

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ModuleSchedulerService)
  return ctx
}

describe('module scheduler DSH tool gateway', () => {
  it('routes an allowlisted module call through ToolRuntime', async () => {
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: 'echo', description: 'echo',
      parameters: { value: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async args => args.value,
    }))
    ctx.moduleScheduler.registry.register({
      id: 'gateway', version: '1.0.0', description: 'gateway', tools: ['echo'],
      inputSchema: schema, outputSchema: schema,
      resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 100 },
      execute: async ({ input, tools }) => ({
        value: await tools.get('echo')?.({ value: (input as { value: string }).value }),
      }),
    })

    const result = await ctx.moduleScheduler.run({
      sessionId: 'session-a', taskId: 'task-a', moduleRef: 'gateway@1.0.0', input: { value: 'hello' },
    })

    expect(result).toMatchObject({ status: 'succeeded', validated: true, output: { value: 'hello' } })
  })

  it('preserves ToolRuntime policy failures as failed module results', async () => {
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: 'echo', description: 'echo', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'unused',
    }))
    ctx.on('tools/pre-execute', async (_exec, _next) => ({ kind: 'deny', reason: 'policy denied' }))
    ctx.moduleScheduler.registry.register({
      id: 'denied', version: '1.0.0', description: 'denied', tools: ['echo'],
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: schema, resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 100 },
      execute: async ({ tools }) => ({ value: await tools.get('echo')?.({}) }),
    })

    const result = await ctx.moduleScheduler.run({ sessionId: 'session-a', taskId: 'task-a', moduleRef: 'denied@1.0.0' })

    expect(result.status).toBe('failed')
    expect(result.validated).toBe(false)
    expect(result.reason).toContain('policy denied')
  })

  it('uses a distinct DSH call identity for every module tool invocation', async () => {
    const ctx = await setup()
    const callIds: string[] = []
    ctx.tools.register(defineTool({
      name: 'identity', description: 'identity', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => { callIds.push(exec.callId); return exec.callId },
    }))
    ctx.moduleScheduler.registry.register({
      id: 'identity-module', version: '1.0.0', description: 'identity', tools: ['identity'],
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: schema, resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 100 },
      execute: async ({ tools }) => { await tools.get('identity')?.({}); return { value: await tools.get('identity')?.({}) } },
    })

    const result = await ctx.moduleScheduler.run({ sessionId: 'session-a', taskId: 'task-a', moduleRef: 'identity-module@1.0.0' })

    expect(result.status).toBe('succeeded')
    expect(callIds).toHaveLength(2)
    expect(callIds[0]).not.toBe(callIds[1])
    expect(callIds.every(id => typeof ToolCallId(id) === 'string')).toBe(true)
  })
})
