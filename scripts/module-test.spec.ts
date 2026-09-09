import { Context } from '@deepseek-ai/cordis'
import ModuleSchedulerService, { type ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeModuleTestCommand, parseModuleTestCommand, type ModuleTestScheduler } from '../apps/cli/src/module-test.ts'

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

const view = {
  modules: [{ ref: 'reader@1.0.0', id: 'reader', version: '1.0.0', displayName: '读取器', description: '读取输入', tools: [], inputSchema: { type: 'object' as const }, runnableFromBrowser: true }],
  runs: [],
}

function scheduler(): ModuleTestScheduler {
  return {
    remoteView: vi.fn(() => view),
    remoteStart: vi.fn(() => ({ ok: true as const, value: { runId: 'run-1', taskId: 'task-1', moduleRef: 'reader@1.0.0', status: 'created' as const } })),
    remoteCancel: vi.fn(() => ({ ok: true as const, value: true })),
  }
}

describe('module acceptance CLI', () => {
  it('parses list, start, view, and cancel commands', () => {
    expect(parseModuleTestCommand(['list', '--session', 's'])).toEqual({ command: 'list', sessionId: 's' })
    expect(parseModuleTestCommand(['start', 'reader@1.0.0', '--session', 's', '--task', 't', '--input', '{"value":"ok"}']))
      .toEqual({ command: 'start', sessionId: 's', taskId: 't', moduleRef: 'reader@1.0.0', input: { value: 'ok' } })
    expect(parseModuleTestCommand(['view', '--session', 's'])).toEqual({ command: 'view', sessionId: 's' })
    expect(parseModuleTestCommand(['cancel', 'run-1', '--session', 's'])).toEqual({ command: 'cancel', sessionId: 's', runId: 'run-1' })
  })

  it('accepts JSON input from a file', () => {
    const file = 'scripts/module-test-input.json'
    const parsed = parseModuleTestCommand(['start', 'reader@1.0.0', '--session', 's', '--task', 't', '--input-file', file])
    expect(parsed).toMatchObject({ command: 'start', sessionId: 's', taskId: 't', moduleRef: 'reader@1.0.0' })
    expect('input' in parsed ? parsed.input : undefined).toEqual({ projectPath: expect.any(String) as unknown })
  })

  it('rejects invalid JSON before calling the scheduler', () => {
    expect(() => parseModuleTestCommand(['start', 'reader@1.0.0', '--session', 's', '--task', 't', '--input', '{bad']))
      .toThrow('input-json-invalid')
  })

  it('delegates every operation to the existing scheduler service', () => {
    const service = scheduler()
    expect(executeModuleTestCommand(service, { command: 'list', sessionId: 's' })).toEqual({ ok: true, value: view.modules })
    expect(executeModuleTestCommand(service, { command: 'view', sessionId: 's' })).toEqual({ ok: true, value: view })
    expect(executeModuleTestCommand(service, { command: 'start', sessionId: 's', taskId: 'task-1', moduleRef: 'reader@1.0.0', input: {} }))
      .toMatchObject({ ok: true, value: { runId: 'run-1' } })
    expect(executeModuleTestCommand(service, { command: 'cancel', sessionId: 's', runId: 'run-1' })).toEqual({ ok: true, value: true })
    expect(service.remoteStart).toHaveBeenCalledWith('s', { taskId: 'task-1', moduleRef: 'reader@1.0.0', input: {} })
  })

  it('observes cancellation, session isolation, and remote failures through the real scheduler', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ModuleSchedulerService)
    const schema = { type: 'object', additionalProperties: false } as const
    const definition = (id: string, execute: ModuleDefinition['execute'], requiresAgent = false): ModuleDefinition => ({
      id, version: '1.0.0', displayName: `测试${id}`, description: `测试${id}`, tools: [], requiresAgent,
      inputSchema: schema, outputSchema: schema,
      resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 1_000 }, execute,
    })
    ctx.moduleScheduler.registry.register(definition('slow', async ({ signal }) => await new Promise((resolve) => {
      signal.addEventListener('abort', () => { resolve({}) }, { once: true })
    })))
    ctx.moduleScheduler.registry.register(definition('managed', async () => ({}), true))

    const started = executeModuleTestCommand(ctx.moduleScheduler, {
      command: 'start', sessionId: 'session-a', taskId: 'cancel', moduleRef: 'slow@1.0.0', input: {},
    })
    if (typeof started !== 'object' || started === null || !('ok' in started) || started.ok !== true
      || !('value' in started) || typeof started.value !== 'object' || started.value === null || !('runId' in started.value)) {
      throw new Error('expected-start-success')
    }
    const runId = String(started.value.runId)
    expect(executeModuleTestCommand(ctx.moduleScheduler, { command: 'view', sessionId: 'session-b' }))
      .toMatchObject({ ok: true, value: { runs: [] } })
    expect(executeModuleTestCommand(ctx.moduleScheduler, { command: 'cancel', sessionId: 'session-b', runId }))
      .toEqual({ ok: false, error: { code: 'run-not-found', message: 'run-not-found' } })
    expect(executeModuleTestCommand(ctx.moduleScheduler, { command: 'cancel', sessionId: 'session-a', runId }))
      .toEqual({ ok: true, value: true })
    await vi.waitFor(() => {
      expect(executeModuleTestCommand(ctx.moduleScheduler, { command: 'view', sessionId: 'session-a' }))
        .toMatchObject({ ok: true, value: { runs: [{ runId, status: 'cancelled' }] } })
    })
    expect(executeModuleTestCommand(ctx.moduleScheduler, {
      command: 'start', sessionId: 'session-a', taskId: 'blocked', moduleRef: 'managed@1.0.0', input: {},
    })).toEqual({ ok: false, error: { code: 'module-requires-agent', message: 'module-requires-agent' } })
  })
})
