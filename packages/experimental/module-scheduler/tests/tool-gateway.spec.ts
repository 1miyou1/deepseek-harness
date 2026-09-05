import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
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

function agent(id = 'session-a'): Agent {
  return { id: id as SessionId, session: { id: id as SessionId } } as Agent
}

describe('module scheduler DSH tool gateway', () => {
  it('registers one model-visible module tool and derives trusted run identity from its caller', async () => {
    const ctx = await setup()
    ctx.moduleScheduler.registry.register({
      id: 'gateway', version: '1.0.0', displayName: '网关', description: '调用模块网关', tools: [],
      inputSchema: schema, outputSchema: schema,
      resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 100 },
      execute: async ({ sessionId, taskId }) => ({ value: `${sessionId}:${taskId}` }),
    })
    const caller = agent()
    const result = await ctx.tools.execute({
      callId: ToolCallId('call-a'), name: 'module_run',
      arguments: { moduleRef: 'gateway@1.0.0', input: { value: 'hello' } },
      agent: caller, signal: new AbortController().signal,
    })

    expect(ctx.tools.schemas(caller).find(tool => tool.name === 'module_run')).toMatchObject({
      parameters: { required: ['moduleRef', 'input'] },
    })
    expect(result).toMatchObject({
      isError: false,
      value: {
        sessionId: 'session-a', taskId: 'call-a', moduleRef: 'gateway@1.0.0',
        status: 'succeeded', validated: true, output: { value: 'session-a:call-a' },
      },
    })
  })

  it('runs module tools through the initiating Agent scope', async () => {
    const ctx = await setup()
    const caller = agent()
    ctx.tools.register(defineTool({
      name: 'echo', description: 'global echo', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'global',
    }))
    ctx.moduleScheduler.registry.register({
      id: 'gateway', version: '1.0.0', displayName: '网关', description: '调用工具网关', tools: ['echo'],
      inputSchema: schema, outputSchema: schema,
      resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 100 },
      execute: async ({ tools }) => ({ value: await tools.get('echo')?.({}) }),
    })
    let seen: Agent | undefined
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name === 'echo') seen = exec.agent
      return await next()
    })

    const result = await ctx.tools.execute({
      callId: ToolCallId('call-a'), name: 'module_run',
      arguments: { moduleRef: 'gateway@1.0.0', input: { value: 'hello' } },
      agent: caller, signal: new AbortController().signal,
    })

    expect(result).toMatchObject({ isError: false, value: { status: 'succeeded', output: { value: 'global' } } })
    expect(seen).toBe(caller)
  })

  it('cancels a module run when the outer model tool call is aborted', async () => {
    const ctx = await setup()
    const started = Promise.withResolvers<undefined>()
    ctx.moduleScheduler.registry.register({
      id: 'slow', version: '1.0.0', displayName: '慢模块', description: '等待取消信号', tools: [],
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: schema,
      resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 1_000 },
      execute: async ({ signal }) => {
        started.resolve(undefined)
        await new Promise<undefined>((resolve) => {
          signal.addEventListener('abort', () => { resolve(undefined) }, { once: true })
        })
        return { value: 'late' }
      },
    })
    const controller = new AbortController()
    const pending = ctx.tools.execute({
      callId: ToolCallId('call-a'), name: 'module_run',
      arguments: { moduleRef: 'slow@1.0.0', input: {} },
      agent: agent(), signal: controller.signal,
    })
    await started.promise
    controller.abort('cancelled')

    await expect(pending).resolves.toMatchObject({ isError: true, error: { info: { code: 'ABORTED' } } })
  })

  it('routes an allowlisted module call through ToolRuntime', async () => {
    const ctx = await setup()
    ctx.tools.register(defineTool({
      name: 'echo', description: 'echo',
      parameters: { value: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async args => args.value,
    }))
    ctx.moduleScheduler.registry.register({
      id: 'gateway', version: '1.0.0', displayName: '网关', description: '调用工具网关', tools: ['echo'],
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

  it('keeps private Host tools out of the ordinary model tool catalog', async () => {
    const ctx = await setup()
    const dispose = ctx.moduleScheduler.registerHostTool('private-edit', async args => args)
    ctx.moduleScheduler.registry.register({
      id: 'private-tool', version: '1.0.0', displayName: '私有工具', description: '验证私有工具边界', tools: ['private-edit'],
      inputSchema: schema, outputSchema: schema,
      resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 100 },
      execute: async ({ input, tools }) => await tools.get('private-edit')?.(input),
    })

    expect(ctx.tools.schemas().some(tool => tool.name === 'private-edit')).toBe(false)
    await expect(ctx.moduleScheduler.run({
      sessionId: 'session-a', taskId: 'task-a', moduleRef: 'private-tool@1.0.0', input: { value: 'private' },
    })).resolves.toMatchObject({ status: 'succeeded', validated: true, output: { value: 'private' } })
    dispose()
    const disposeReplacement = ctx.moduleScheduler.registerHostTool('private-edit', async () => ({ value: 'replacement' }))
    dispose()
    await expect(ctx.moduleScheduler.run({
      sessionId: 'session-a', taskId: 'task-b', moduleRef: 'private-tool@1.0.0', input: { value: 'private' },
    })).resolves.toMatchObject({ status: 'succeeded', validated: true, output: { value: 'replacement' } })
    disposeReplacement()
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
      id: 'denied', version: '1.0.0', displayName: '拒绝测试', description: '验证策略拒绝', tools: ['echo'],
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
      id: 'identity-module', version: '1.0.0', displayName: '身份测试', description: '验证调用身份', tools: ['identity'],
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
