import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import ModuleSchedulerService from '../src/index.ts'

function response(chunks: StreamChunk[]): StreamChunk[] {
  return [...chunks, { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }]
}

function moduleCall(): StreamChunk[] {
  const id = ToolCallId('module-call')
  const args = JSON.stringify({ moduleRef: 'echo@1.0.0', input: { value: 'hello' } })
  return response([
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'module_run', argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'module_run', arguments: args } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ])
}

function finalText(): StreamChunk[] {
  return response([
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '模块已完成' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '模块已完成' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly script = [moduleCall(), finalText()]

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (!chunks) throw new Error('script-exhausted')
    for (const chunk of chunks) yield chunk
  }
}

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function waitForIdle(ctx: Context, agent: Agent): Promise<undefined> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve(undefined)
    })
  })
}

describe('module scheduler model loop composition', () => {
  it('returns a validated module result to the initiating model session', async () => {
    const adapter = new ScriptedAdapter()
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ModuleSchedulerService)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], adapter)
    ctx.moduleScheduler.registry.register({
      id: 'echo', version: '1.0.0', displayName: '回显', description: '返回输入', tools: [],
      inputSchema: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'string' } } },
      outputSchema: { type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'string' } } },
      resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 1_000 },
      execute: async ({ input }) => input,
    })
    const agent = await ctx.agentLoop.create(SessionId('model-module'), { provider: 'mock', model: 'mock' })

    send(agent, '使用模块处理 hello')
    await waitForIdle(ctx, agent)

    expect(adapter.requests[0]?.tools?.some(tool => tool.name === 'module_run')).toBe(true)
    expect(adapter.requests).toHaveLength(2)
    const result = adapter.requests[1]?.messages
      .flatMap(message => message.content)
      .find(block => block.type === 'tool-result')
    if (result?.type !== 'tool-result' || result.content[0]?.type !== 'text') throw new Error('missing-module-result')
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      sessionId: 'model-module', taskId: 'module-call', moduleRef: 'echo@1.0.0',
      status: 'succeeded', validated: true, output: { value: 'hello' },
    })
    expect(agent.session.snapshotEvents().map(event => event.type)).toEqual(expect.arrayContaining([
      'tool/call', 'tool/result', 'assistant/message',
    ]))
  })
})
