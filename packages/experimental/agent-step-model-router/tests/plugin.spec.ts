import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as ModelRouter from '../src/index.ts'

async function setup(script = [textResponse('ok')], install = true) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ModelRouter, {
    luna: { provider: 'mock', model: 'gpt-5.6-luna' },
    terra: { provider: 'mock', model: 'gpt-5.6-terra' },
    sol: { provider: 'mock', model: 'gpt-5.6-sol' },
  })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const ref: ModelSelectionRef = {
    current: { provider: 'mock', model: 'gpt-5.6-terra' },
    assembled: undefined,
  }
  const { agent } = await ctx.agents.create({
    sessionId: SessionId('routed'),
    agentOptions: { provider: 'mock', model: 'gpt-5.6-terra' },
    ...install ? { setup: (agentCtx: Context) => { installModelSelection(agentCtx, ref) } } : {},
  })
  return { ctx, adapter, agent, ref }
}

describe('agent step model router', () => {
  it('routes before assembly and records why separately from the actual request header', async () => {
    const { ctx, adapter, agent } = await setup()
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '设计复杂架构' }], source: { kind: 'user' },
    }))
    await agent.whenIdle()

    expect(adapter.requests[0]).toMatchObject({ provider: 'mock', model: 'gpt-5.6-sol' })
    expect(agent.session.requestHeader()?.config.model).toBe('gpt-5.6-sol')
    expect(agent.session.snapshotEvents().find(event => event.type === 'model/routing-decision')?.data)
      .toMatchObject({ turn: 1, step: 1, tier: 'sol', reason: 'complex' })
    expect(ctx.sessionProjections.snapshot(agent.session).values.modelRoutingDecision)
      .toMatchObject({ tier: 'sol', reason: 'complex' })
  })

  it('keeps the routed model for tool-result continuation steps', async () => {
    const { ctx, adapter, agent } = await setup([
      toolCallResponse('c1', 'echo', { text: 'hi' }),
      textResponse('done'),
    ])
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'echo',
      parameters: { text: { type: 'string', required: true } },
      execute: async () => [{ type: 'text', text: 'hi' }],
    }))
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '设计复杂架构' }], source: { kind: 'user' },
    }))
    await agent.whenIdle()

    expect(adapter.requests.map(request => request.model)).toEqual(['gpt-5.6-sol', 'gpt-5.6-sol'])
    expect(agent.session.snapshotEvents().filter(event => event.type === 'model/routing-decision')).toHaveLength(1)
  })

  it('does nothing when an Agent has no installed model selection', async () => {
    const { adapter, agent } = await setup([textResponse('ok')], false)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '设计复杂架构' }], source: { kind: 'user' },
    }))
    await agent.whenIdle()
    expect(adapter.requests[0]?.model).toBe('gpt-5.6-terra')
    expect(agent.session.snapshotEvents().some(event => event.type === 'model/routing-decision')).toBe(false)
  })

  it('preserves an explicit selection after its request header', async () => {
    const { adapter, agent, ref } = await setup()
    const explicit = { provider: 'mock', model: 'gpt-5.6-sol' }
    agent.session.append('model/selection', explicit)
    agent.session.append('request/header', {
      header: { config: explicit }, reason: 'initial',
    })
    ref.current = explicit
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '修复这个缺陷并补测试' }], source: { kind: 'user' },
    }))
    await agent.whenIdle()
    expect(adapter.requests[0]).toMatchObject(explicit)
    expect(agent.session.snapshotEvents().some(event => event.type === 'model/routing-decision')).toBe(false)
  })

  it('preserves a durable explicit selection for the next request', async () => {
    const { adapter, agent, ref } = await setup()
    const explicit = { provider: 'mock', model: 'gpt-5.6-luna' }
    agent.session.append('model/selection', explicit)
    ref.current = explicit
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '设计复杂架构' }], source: { kind: 'user' },
    }))
    await agent.whenIdle()

    expect(adapter.requests[0]).toMatchObject(explicit)
    expect(agent.session.snapshotEvents().some(event => event.type === 'model/routing-decision')).toBe(false)
  })
})
