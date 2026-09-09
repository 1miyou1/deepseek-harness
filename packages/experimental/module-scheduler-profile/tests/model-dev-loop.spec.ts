import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import ModuleSchedulerService from '@deepseek-ai/dsh-experimental-module-scheduler'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { apply as applySpawn } from '@deepseek-ai/dsh-subagent-spawn-in-process'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { applyModule, createModuleDevHostTools, moduleDevToolFactories } from '../src/module-dev.ts'

function toolResponse(id: string, name: string, args: unknown): StreamChunk[] {
  const callId = ToolCallId(id)
  const encoded = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: encoded },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: encoded } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class DeveloperAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private turn = 0

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.turn++ === 0) {
      const id = ToolCallId('develop-module')
      const args = JSON.stringify({
        moduleRef: 'module-developer@1.0.0',
        input: { id: 'example', file: 'src/module.ts', content: 'after\n' },
      })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'module_run', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'module_run', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '开发完成' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: '开发完成' } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 4 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class ManagedDeveloperAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private turn = 0

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.turn++ === 0
      ? toolResponse('develop-module-v2', 'module_run', {
        moduleRef: 'module-developer@2.0.0', input: { id: 'example', task: '把 src/module.ts 更新为 after' },
      })
      : this.turn === 2
        ? toolResponse('read-file', 'module_dev_read', { id: 'example', file: 'src/module.ts' })
        : this.turn === 3
          ? toolResponse('write-file', 'module_dev_write', { id: 'example', file: 'src/module.ts', expectedContent: 'before\n', content: 'after\n' })
          : this.turn === 4
            ? toolResponse('test-module', 'module_dev_test', { id: 'example' })
            : this.turn === 5
              ? toolResponse('retry-test-module', 'module_dev_test', { id: 'example' })
              : this.turn === 6
                ? toolResponse('lint-module', 'module_dev_lint', { id: 'example' })
                : this.turn === 7
                  ? toolResponse('typecheck-module', 'module_dev_typecheck', { id: 'example' })
                  : this.turn === 8
                    ? toolResponse('complete-module', 'structured_output', {
                      ok: true,
                      changedFiles: ['src/module.ts'],
                      checks: [{ name: 'test', ok: true }, { name: 'lint', ok: true }, { name: 'typecheck', ok: true }],
                      summary: '已完成修改并通过验证',
                    })
                    : [
                      { type: 'block-start', index: 0, blockType: 'text' },
                      { type: 'block-end', index: 0, block: { type: 'text', text: '开发完成' } },
                      { type: 'finish', reason: { kind: 'stop' } },
                    ] as StreamChunk[]
    yield* response
  }
}

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function waitForIdle(ctx: Context, agent: Agent): Promise<undefined> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve(undefined)
    })
  })
}

describe('module developer model loop composition', () => {
  it('runs module-developer@2 through an inherited-model child with only private development tools', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-module-managed-dev-loop-'))
    roots.push(root)
    const moduleRoot = join(root, 'packages/experimental/example-profile')
    mkdirSync(join(moduleRoot, 'src'), { recursive: true })
    writeFileSync(join(moduleRoot, 'src/module.ts'), 'before\n')
    const adapter = new ManagedDeveloperAdapter()
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
    await ctx.plugin(SubagentRuntime)
    applySpawn(ctx, { providerName: 'spawn' })
    ctx.llm.registerAdapter(['mock'], adapter)
    const runtime = {
      sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv] }) },
      subprocess: {
        spawn: () => ({
          collected: { stdout: { readFrom: () => ({ text: 'passed' }) }, stderr: { readFrom: () => ({ text: '' }) } },
          done: Promise.resolve({ exitCode: 0 }),
        }),
      },
    }
    for (const [name, tool] of createModuleDevHostTools(root, runtime)) {
      ctx.moduleScheduler.registerHostTool(name, tool, moduleDevToolFactories.get(name))
    }
    applyModule(ctx)
    const parent = await ctx.agentLoop.create(SessionId('managed-developer-loop'), { provider: 'mock', model: 'mock', maxTokens: 8192 })
    parent.followup(createUserMessage({ content: [{ type: 'text', text: '修改示例模块' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, parent)
    expect(readFileSync(join(moduleRoot, 'src/module.ts'), 'utf8')).toBe('after\n')
    const child = ctx.agents.list().find(agent => agent !== parent)
    expect(child).toBeUndefined()
    const childRequests = adapter.requests.slice(1, 7)
    expect(childRequests.every(request => request.provider === 'mock' && request.model === 'mock')).toBe(true)
    expect(childRequests.every(request => request.maxTokens === 4096)).toBe(true)
    expect(childRequests[0]?.tools?.map(tool => tool.name).sort()).toEqual([
      'module_dev_lint', 'module_dev_read', 'module_dev_test', 'module_dev_typecheck', 'module_dev_write', 'structured_output',
    ])
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).not.toContain('module_dev_read')
    expect(adapter.requests[1]?.tools?.map(tool => tool.name)).not.toContain('module_run')
    const result = adapter.requests.at(-1)?.messages.flatMap(message => message.content).find(block => block.type === 'tool-result')
    if (result?.type !== 'tool-result' || result.content[0]?.type !== 'text') throw new Error('missing-managed-developer-result')
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      moduleRef: 'module-developer@2.0.0', status: 'succeeded', validated: true,
      output: { ok: true, changedFiles: ['src/module.ts'] },
    })
  })

  it('lets the current model drive the restricted developer and observe validation results', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-module-dev-loop-'))
    roots.push(root)
    const moduleRoot = join(root, 'packages/experimental/example-profile')
    mkdirSync(join(moduleRoot, 'src'), { recursive: true })
    writeFileSync(join(moduleRoot, 'src/module.ts'), 'before\n')
    const adapter = new DeveloperAdapter()
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
    const runtime = {
      sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv] }) },
      subprocess: {
        spawn: () => ({
          collected: { stdout: { readFrom: () => ({ text: 'passed' }) }, stderr: { readFrom: () => ({ text: '' }) } },
          done: Promise.resolve({ exitCode: 0 }),
        }),
      },
    }
    for (const [name, tool] of createModuleDevHostTools(root, runtime)) ctx.moduleScheduler.registerHostTool(name, tool)
    applyModule(ctx)
    const agent = await ctx.agentLoop.create(SessionId('developer-loop'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: '把示例模块更新为 after' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(readFileSync(join(moduleRoot, 'src/module.ts'), 'utf8')).toBe('after\n')
    expect(adapter.requests).toHaveLength(2)
    const result = adapter.requests[1]?.messages.flatMap(message => message.content).find(block => block.type === 'tool-result')
    if (result?.type !== 'tool-result' || result.content[0]?.type !== 'text') throw new Error('missing-developer-result')
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      moduleRef: 'module-developer@1.0.0', status: 'succeeded', validated: true,
      output: { ok: true },
    })
  })
})
