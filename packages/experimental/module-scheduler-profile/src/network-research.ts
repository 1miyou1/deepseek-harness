/** Register the first real browser-startable Module Scheduler workload. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { runVerifiedAgent, type HostTool, type HostToolContext, type ManagedAgentToolFactory, type ModuleDefinition, type ModuleTool } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readWebPage } from '@deepseek-ai/dsh-experimental-web-reader-profile'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-web'

export const inject = ['moduleScheduler', 'web']

const agentTools = ['network-research/search', 'network-research/fetch']
const MAX_FETCH_CHARS = 12_000

function defineResearchTool(name: string, description: string, parameter: 'query' | 'url', execute: ModuleTool) {
  return defineTool({
    name: name.replaceAll(/[-/]/g, '_'),
    description,
    parameters: { [parameter]: { type: 'string', required: true } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: args => execute(args) as Promise<JsonValue>,
  })
}

const toolFactories: ReadonlyMap<string, ManagedAgentToolFactory> = new Map([
  ['network-research/search', execute => defineResearchTool('network-research/search', '搜索当前网络信息并返回候选来源。', 'query', execute)],
  ['network-research/fetch', execute => defineResearchTool('network-research/fetch', '读取一个候选来源的正文。', 'url', execute)],
])

function validSource(url: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false }
}

/** Register the network-research module for this profile layer. */
export function apply(ctx: Context): void {
  const evidence = new Map<string, { taskId: string; sources: Set<string>; fetched: Set<string> }>()
  const active = new Map<string, string>()
  const hostTools = new Map<string, HostTool>([
    ['network-research/search', async (args, context) => {
      const result = await ctx.web.search({ query: (args as { query: string }).query, maxResults: 8 }, context.run.signal)
      const token = active.get(context.request.taskId)
      const record = token === undefined ? undefined : evidence.get(token)
      for (const source of result.sources) if (validSource(source.url)) record?.sources.add(source.url)
      return result
    }],
    ['network-research/fetch', async (args, context) => {
      const result = await readWebPage({ url: (args as { url: string }).url, maxLength: MAX_FETCH_CHARS }, context.run.signal)
      const token = active.get(context.request.taskId)
      const record = token === undefined ? undefined : evidence.get(token)
      if (result.ok && result.content.trim() !== '') record?.fetched.add(result.url)
      const content = result.content.slice(0, MAX_FETCH_CHARS)
      return { url: result.url, statusCode: result.status, body: { kind: 'text', content }, truncated: content.length < result.content.length }
    }],
    ['network-research/evidence', async (args, context: HostToolContext) => {
      const input = args as { action: 'begin' | 'view' | 'end' | 'discard'; token?: string }
      if (input.action === 'begin') {
        const token = randomUUID()
        evidence.set(token, { taskId: context.request.taskId, sources: new Set(), fetched: new Set() })
        active.set(context.request.taskId, token)
        return { token }
      }
      if (input.token === undefined) throw new Error('network-research-evidence-token-required')
      const record = evidence.get(input.token)
      if (record === undefined || record.taskId !== context.request.taskId) throw new Error('network-research-evidence-token-invalid')
      const result = { sources: [...record.sources].sort(), fetched: [...record.fetched].sort() }
      if (input.action === 'end' || input.action === 'discard') {
        evidence.delete(input.token)
        active.delete(context.request.taskId)
      }
      return input.action === 'discard' ? { sources: [], fetched: [] } : result
    }],
  ])
  for (const [name, tool] of hostTools) {
    const dispose = ctx.moduleScheduler.registerHostTool(name, tool, toolFactories.get(name))
    ctx.effect(() => dispose, `${name}: registration`)
  }

  const definition: ModuleDefinition = {
    id: 'network-research',
    version: '1.0.0',
    displayName: '网络调研',
    description: '使用已配置的网络搜索服务调研当前信息',
    tools: [],
    inputSchema: {
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: { query: { type: 'string' } },
    },
    outputSchema: {
      type: 'object',
      required: ['sources', 'truncated'],
      additionalProperties: false,
      properties: {
        content: { type: 'string' },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            required: ['url'],
            additionalProperties: false,
            properties: {
              url: { type: 'string' },
              title: { type: 'string' },
              snippet: { type: 'string' },
              publishedAt: { type: 'string' },
            },
          },
        },
        truncated: { type: 'boolean' },
      },
    },
    resourcePolicy: { maxConcurrent: 2, queueLimit: 8, timeoutMs: 30_000 },
    execute: async ({ input, signal }) => await ctx.web.search({
      query: (input as { query: string }).query,
      maxResults: 8,
    }, signal),
  }
  const managedDefinition: ModuleDefinition = {
    id: 'network-research',
    version: '2.0.0',
    displayName: '自治网络调研',
    description: '由受管专职代理规划检索、阅读来源并补查证据',
    tools: [...agentTools, 'network-research/evidence'],
    inputSchema: {
      type: 'object', required: ['query'], additionalProperties: false,
      properties: { query: { type: 'string' } },
    },
    outputSchema: {
      type: 'object', required: ['ok', 'report', 'sources', 'attempts', 'supplemented'], additionalProperties: false,
      properties: {
        ok: { type: 'boolean' }, report: { type: 'string' },
        sources: { type: 'array', items: { type: 'string' } },
        attempts: { type: 'number' }, supplemented: { type: 'boolean' },
      },
    },
    resourcePolicy: { maxConcurrent: 2, queueLimit: 4, timeoutMs: 300_000 },
    requiresAgent: true,
    execute: async ({ input, agent, tools }) => {
      if (agent === undefined) throw new Error('module-requires-agent')
      const tracker = tools.get('network-research/evidence')
      if (tracker === undefined) throw new Error('network-research-evidence-unavailable')
      const started = await tracker({ action: 'begin' }) as { token?: unknown }
      if (typeof started.token !== 'string') throw new Error('network-research-evidence-token-missing')
      const query = (input as { query: string }).query
      const runAgent = (task: string) => agent.run({ task, tools: agentTools, maxSteps: 8, maxTokensPerStep: 4096 })
      const inspect = async (action: 'view' | 'end') => {
        const value = await tracker({ action, token: started.token }) as { sources?: unknown; fetched?: unknown }
        const sources = Array.isArray(value.sources) ? value.sources.filter((item): item is string => typeof item === 'string' && validSource(item)) : []
        const fetched = Array.isArray(value.fetched) ? value.fetched.filter((item): item is string => typeof item === 'string' && validSource(item)) : []
        return { sources: [...new Set(sources)].sort(), fetched: [...new Set(fetched)].sort() }
      }
      try {
        const originalTask = `调研目标：${query}\n先规划检索词。search 最多调用 2 次，fetch 最多调用 2 次；达到预算后立即报告，禁止继续扩散检索。至少读取一个来源正文。报告只写有来源支持的结论，明确不确定性。`
        let validations = 0
        const loop = await runVerifiedAgent({
          task: originalTask,
          run: runAgent,
          validate: async () => await inspect(validations++ === 0 ? 'view' : 'end'),
          retryTask: ({ validation }) => validation.sources.length >= 2 && validation.fetched.length >= 1
            ? undefined
            : `${originalTask}\n\n首次调研来源不足：当前有效来源 ${validation.sources.length} 个，成功读取正文 ${validation.fetched.length} 个。补查缺口后重新报告，不扩大主题。`,
        })
        const { value: report, attempts } = loop
        const observed = attempts === 1 ? await inspect('end') : loop.validation
        const ok = observed.sources.length >= 2 && observed.fetched.length >= 1
        return { ok, report: typeof report === 'string' ? report : '', sources: observed.sources, attempts, supplemented: attempts === 2 }
      } catch (error) {
        await tracker({ action: 'discard', token: started.token }).catch(() => undefined)
        throw error
      }
    },
  }
  const refs = [
    ctx.moduleScheduler.registry.register(definition),
    ctx.moduleScheduler.registry.register(managedDefinition),
  ]
  ctx.effect(() => () => { for (const ref of refs) ctx.moduleScheduler.registry.unregister(ref) }, 'network-research: registration')
}
