import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { runTests, type SubprocessRuntime, type TestRunInput } from './runner.ts'

export const inject = ['moduleScheduler', 'subprocess']

export function apply(ctx: Context): void {
  const definition: ModuleDefinition = {
    id: 'test-runner',
    version: '1.0.0',
    displayName: '测试执行与降噪诊断器',
    description: '专职受管执行单测套件，自动剥离ANSI与控制台噪音，向主模型返回高度提炼的结构化失败诊断与关键报错靶点',
    tools: [],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string' },
        testPath: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['ok', 'total', 'passed', 'failed', 'durationMs', 'failures', 'summary'],
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        total: { type: 'number' },
        passed: { type: 'number' },
        failed: { type: 'number' },
        durationMs: { type: 'number' },
        summary: { type: 'string' },
        rawSnippet: { type: 'string' },
        failures: {
          type: 'array',
          items: {
            type: 'object',
            required: ['file', 'testName', 'error'],
            additionalProperties: false,
            properties: {
              file: { type: 'string' },
              testName: { type: 'string' },
              error: { type: 'string' },
              line: { type: 'number' },
            },
          },
        },
      },
    },
    resourcePolicy: { maxConcurrent: 2, queueLimit: 4, timeoutMs: 60_000 },
    execute: async ({ input, signal }: ModuleExecutionContext) => {
      const rawInput = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
      const parsedInput: TestRunInput = {
        cwd: typeof rawInput.cwd === 'string' ? rawInput.cwd : undefined,
        testPath: typeof rawInput.testPath === 'string' ? rawInput.testPath : undefined,
        timeoutMs: typeof rawInput.timeoutMs === 'number' ? rawInput.timeoutMs : undefined,
      }
      const subprocess = (ctx as unknown as { subprocess: SubprocessRuntime }).subprocess
      return await runTests(subprocess, parsedInput, signal)
    },
  }

  const ref = ctx.moduleScheduler.registry.register(definition)
  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, 'test-runner: registration')
}
