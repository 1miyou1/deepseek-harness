import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { inspectGit } from './git.ts'

export const inject = ['moduleScheduler', 'subprocess']

declare module '@deepseek-ai/cordis' {
  interface Context {
    subprocess: SubprocessRuntime
  }
}

export function apply(ctx: Context): void {
  const definition: ModuleDefinition = {
    id: 'git-inspector',
    version: '1.0.0',
    displayName: 'Git状态分析器',
    description: '专职只读分析指定目录的Git工作树状态与分支概况',
    tools: [],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['ok', 'isRepo', 'ahead', 'behind', 'modified', 'untracked', 'recentCommits'],
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        isRepo: { type: 'boolean' },
        branch: { type: 'string' },
        clean: { type: 'boolean' },
        ahead: { type: 'number' },
        behind: { type: 'number' },
        modified: { type: 'array', items: { type: 'string' } },
        untracked: { type: 'array', items: { type: 'string' } },
        recentCommits: {
          type: 'array',
          items: {
            type: 'object',
            required: ['hash', 'message'],
            additionalProperties: false,
            properties: {
              hash: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
        error: { type: 'string' },
      },
    },
    resourcePolicy: { maxConcurrent: 4, queueLimit: 16, timeoutMs: 15_000 },
    execute: async ({ input, signal }: ModuleExecutionContext) => {
      const targetPath = typeof input === 'object' && input !== null && 'path' in input && typeof input.path === 'string'
        ? input.path
        : process.cwd()
      return await inspectGit(ctx.subprocess, targetPath, signal)
    },
  }
  const ref = ctx.moduleScheduler.registry.register(definition)
  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, 'git-inspector: registration')
}
