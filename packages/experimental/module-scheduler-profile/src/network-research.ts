/** Register the first real browser-startable Module Scheduler workload. */

import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'
import type {} from '@deepseek-ai/dsh-web'

export const inject = ['moduleScheduler', 'web']

/** Register the network-research module for this profile layer. */
export function apply(ctx: Context): void {
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
  const ref = ctx.moduleScheduler.registry.register(definition)
  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, 'network-research: registration')
}
