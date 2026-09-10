import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { executeCodeImplementation, type ImplementInput } from './implementer.ts'

export const inject = ['moduleScheduler']

export function apply(ctx: Context): void {
  const definition: ModuleDefinition = {
    id: 'code-implementer',
    version: '1.0.0',
    displayName: '代码实现与修补器',
    description: '专职在受管可写工作区内执行源码精准实现与原子差异修补，提供防越权写隔离',
    tools: [],
    inputSchema: {
      type: 'object',
      required: ['edits'],
      additionalProperties: false,
      properties: {
        cwd: { type: 'string' },
        writePaths: {
          type: 'array',
          items: { type: 'string' },
        },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'newString'],
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              oldString: { type: 'string' },
              newString: { type: 'string' },
              replaceAll: { type: 'boolean' },
            },
          },
        },
        dryRun: { type: 'boolean' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['ok', 'changedFiles', 'records', 'stats'],
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        changedFiles: {
          type: 'array',
          items: { type: 'string' },
        },
        records: {
          type: 'array',
          items: {
            type: 'object',
            required: ['path', 'additions', 'deletions', 'status'],
            additionalProperties: false,
            properties: {
              path: { type: 'string' },
              additions: { type: 'number' },
              deletions: { type: 'number' },
              status: { type: 'string' },
            },
          },
        },
        stats: {
          type: 'object',
          required: ['totalAdditions', 'totalDeletions'],
          additionalProperties: false,
          properties: {
            totalAdditions: { type: 'number' },
            totalDeletions: { type: 'number' },
          },
        },
        error: { type: 'string' },
      },
    },
    resourcePolicy: { maxConcurrent: 2, queueLimit: 8, timeoutMs: 30_000 },
    execute: async ({ input, signal }: ModuleExecutionContext) => {
      const rawInput = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
      const edits = Array.isArray(rawInput.edits) ? rawInput.edits : []
      const cwd = typeof rawInput.cwd === 'string' ? rawInput.cwd : undefined
      const writePaths = Array.isArray(rawInput.writePaths) ? (rawInput.writePaths as string[]) : undefined
      const dryRun = typeof rawInput.dryRun === 'boolean' ? rawInput.dryRun : undefined

      const parsedInput: ImplementInput = {
        edits: edits as ImplementInput['edits'],
        cwd,
        writePaths,
        dryRun,
      }
      return await executeCodeImplementation(parsedInput, signal)
    },
  }

  const ref = ctx.moduleScheduler.registry.register(definition)
  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, 'code-implementer: registration')
}
