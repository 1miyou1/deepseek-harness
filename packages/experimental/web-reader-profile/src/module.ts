import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { readWebPage, type WebReaderInput } from './reader.ts'

export const inject = ['moduleScheduler']

export function apply(ctx: Context): void {
  const definition: ModuleDefinition = {
    id: 'web-reader',
    version: '1.0.0',
    displayName: '网页提取与智能清洗器',
    description: '专职高速抓取目标网页，智能剔除广告与导航杂质，提取正文、Markdown、出站链接与元数据',
    tools: [],
    inputSchema: {
      type: 'object',
      required: ['url'],
      additionalProperties: false,
      properties: {
        url: { type: 'string' },
        mode: { type: 'string' },
        maxLength: { type: 'number' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['ok', 'url', 'status', 'title', 'description', 'content', 'length', 'links', 'images', 'metadata'],
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        url: { type: 'string' },
        status: { type: 'number' },
        title: { type: 'string' },
        description: { type: 'string' },
        content: { type: 'string' },
        length: { type: 'number' },
        links: { type: 'array', items: { type: 'string' } },
        images: { type: 'array', items: { type: 'string' } },
        metadata: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ogTitle: { type: 'string' },
            ogDescription: { type: 'string' },
            ogImage: { type: 'string' },
            contentType: { type: 'string' },
            lang: { type: 'string' },
          },
        },
        error: { type: 'string' },
      },
    },
    resourcePolicy: {
      maxConcurrent: 6,
      queueLimit: 24,
      timeoutMs: 25_000,
    },
    execute: async ({ input, signal }: ModuleExecutionContext) => {
      const parsedInput = input as WebReaderInput
      return await readWebPage(parsedInput, signal)
    },
  }

  const ref = ctx.moduleScheduler.registry.register(definition)
  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, 'web-reader: registration')
}
