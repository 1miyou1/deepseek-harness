import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { auditCode, type AuditInput } from './auditor.ts'

export const inject = ['moduleScheduler', 'subprocess']

declare module '@deepseek-ai/cordis' {
  interface Context {
    subprocess: SubprocessRuntime
  }
}

export function apply(ctx: Context): void {
  const definition: ModuleDefinition = {
    id: 'code-auditor',
    version: '1.0.0',
    displayName: '代码与变更审计器',
    description: '专职只读审计工作区代码变更，拦截敏感越权、凭据泄露与代码异味',
    tools: [],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        targetPath: { type: 'string' },
        diffBase: { type: 'string' },
        mode: { type: 'string' },
        strictPonytail: { type: 'boolean' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['ok', 'passed', 'riskLevel', 'summary', 'findings', 'stats'],
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        passed: { type: 'boolean' },
        riskLevel: { type: 'string' },
        summary: { type: 'string' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'rule', 'category', 'severity', 'message'],
            additionalProperties: false,
            properties: {
              file: { type: 'string' },
              line: { type: 'number' },
              rule: { type: 'string' },
              category: { type: 'string' },
              severity: { type: 'string' },
              message: { type: 'string' },
              suggestion: { type: 'string' },
            },
          },
        },
        stats: {
          type: 'object',
          required: ['filesChanged', 'additions', 'deletions', 'staticFindingsCount'],
          additionalProperties: false,
          properties: {
            filesChanged: { type: 'number' },
            additions: { type: 'number' },
            deletions: { type: 'number' },
            staticFindingsCount: { type: 'number' },
          },
        },
        error: { type: 'string' },
      },
    },
    resourcePolicy: { maxConcurrent: 4, queueLimit: 16, timeoutMs: 20_000 },
    execute: async ({ input, signal }: ModuleExecutionContext) => {
      const parsedInput: AuditInput = typeof input === 'object' && input !== null ? input : {}
      return await auditCode(ctx.subprocess, parsedInput, signal)
    },
  }

  const ref = ctx.moduleScheduler.registry.register(definition)
  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, 'code-auditor: registration')
}
