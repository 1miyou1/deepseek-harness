import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { performIndependentReview, type ReviewInput } from './reviewer.ts'

export const inject = ['moduleScheduler', 'subprocess']

declare module '@deepseek-ai/cordis' {
  interface Context {
    subprocess: SubprocessRuntime
  }
}

export function apply(ctx: Context): void {
  const definition: ModuleDefinition = {
    id: 'independent-review',
    version: '1.0.0',
    displayName: '独立代码与架构审查器',
    description: '专职独立审查工作区代码变更的架构合规性、伴随测试完备度与破坏性依赖风险',
    tools: [],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        targetPath: { type: 'string' },
        diffBase: { type: 'string' },
        contextNote: { type: 'string' },
        requireTests: { type: 'boolean' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['ok', 'verdict', 'score', 'summary', 'findings', 'stats'],
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        verdict: { type: 'string' },
        score: { type: 'number' },
        summary: { type: 'string' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'aspect', 'severity', 'title', 'details'],
            additionalProperties: false,
            properties: {
              file: { type: 'string' },
              line: { type: 'number' },
              aspect: { type: 'string' },
              severity: { type: 'string' },
              title: { type: 'string' },
              details: { type: 'string' },
              suggestion: { type: 'string' },
            },
          },
        },
        stats: {
          type: 'object',
          required: ['filesAnalyzed', 'criticalCount', 'warningCount', 'infoCount'],
          additionalProperties: false,
          properties: {
            filesAnalyzed: { type: 'number' },
            criticalCount: { type: 'number' },
            warningCount: { type: 'number' },
            infoCount: { type: 'number' },
          },
        },
      },
    },
    resourcePolicy: { maxConcurrent: 4, queueLimit: 16, timeoutMs: 20_000 },
    execute: async ({ input, signal }: ModuleExecutionContext) => {
      const parsedInput: ReviewInput = typeof input === 'object' && input !== null ? input : {}
      return await performIndependentReview(ctx.subprocess, parsedInput, signal)
    },
  }

  const ref = ctx.moduleScheduler.registry.register(definition)
  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, 'independent-review: registration')
}
