import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import {
  ModuleCoordinator, ModuleRegistry, ModuleSchedulerService, createModuleRunner,
  type ModuleDefinition, type ModuleExecutionContext,
} from '../src/index.ts'

const schema = {
  type: 'object', required: ['value'], additionalProperties: false, properties: { value: { type: 'string' } },
} as const
function valueInput(input: unknown): string {
  return (input as { value: string }).value
}
const reader = (
  execute: ModuleDefinition['execute'] = async ({ input }) => ({ value: valueInput(input) }),
): ModuleDefinition => ({
  id: 'reader', version: '1.0.0', description: 'reader', tools: [], inputSchema: schema, outputSchema: schema,
  resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 100 }, execute,
})

describe('module scheduler Cordis service', () => {
  it('registers one shared scheduler and removes it with the plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = ctx.plugin(ModuleSchedulerService)
    await fiber

    expect(ctx.moduleScheduler).toBeInstanceOf(ModuleSchedulerService)
    expect(ctx.moduleScheduler.registry).toBeInstanceOf(ModuleRegistry)

    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    ctx.moduleScheduler.registry.register(reader(async () => { await gate; return { value: 'done' } }))
    const active = ctx.moduleScheduler.run({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'a' } })

    await fiber.dispose()
    await expect(active).resolves.toMatchObject({ status: 'cancelled', reason: 'disposed' })
    expect(ctx.moduleScheduler).toBeUndefined()
    release()
  })
})

describe('module scheduler contract', () => {
  it('isolates concurrent calls to one shared module', async () => {
    const registry = new ModuleRegistry(); registry.register(reader())
    const runner = createModuleRunner(registry, new ModuleCoordinator({ maxConcurrent: 4 }), new Map())
    const [a, b] = await Promise.all([
      runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'a' } }),
      runner({ sessionId: 'B', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'b' } }),
    ])
    expect(a.status).toBe('succeeded'); expect(b.status).toBe('succeeded'); expect(a.runId).not.toBe(b.runId)
  })

  it('enforces module concurrency and bounded queue', async () => {
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve })
    const registry = new ModuleRegistry()
    registry.register(reader(async ({ input }) => { await gate; return { value: valueInput(input) } }))
    const runner = createModuleRunner(registry, new ModuleCoordinator({ maxConcurrent: 4 }), new Map())
    const a = runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'a' } })
    const b = runner({ sessionId: 'B', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'b' } })
    const c = await runner({ sessionId: 'C', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'c' } })
    expect(c.status).toBe('blocked'); expect(c.reason).toBe('queue-limit'); release(); await Promise.all([a, b])
  })

  it('applies global and per-module queue limits independently', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const registry = new ModuleRegistry()
    registry.register(reader(async ({ input }) => { await gate; return { value: valueInput(input) } }))
    registry.register({ ...reader(), id: 'other' })
    const runner = createModuleRunner(registry, new ModuleCoordinator({ maxConcurrent: 1, queueLimit: 2 }), new Map())
    const active = runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'a' } })
    const queuedReader = runner({ sessionId: 'B', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'b' } })
    const queuedOther = runner({ sessionId: 'C', taskId: 'T', moduleRef: 'other@1.0.0', input: { value: 'c' } })
    const blocked = await runner({ sessionId: 'D', taskId: 'T', moduleRef: 'other@1.0.0', input: { value: 'd' } })

    expect(blocked).toMatchObject({ status: 'blocked', reason: 'queue-limit' })
    release()
    await expect(active).resolves.toMatchObject({ status: 'succeeded' })
    await expect(queuedReader).resolves.toMatchObject({ status: 'succeeded' })
    await expect(queuedOther).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('validates bounded array item shapes', async () => {
    const registry = new ModuleRegistry()
    registry.register({
      ...reader(async ({ input }) => input),
      inputSchema: {
        type: 'object', required: ['queries'], additionalProperties: false,
        properties: { queries: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } } },
      },
      outputSchema: {
        type: 'object', required: ['queries'], additionalProperties: false,
        properties: { queries: { type: 'array', minItems: 1, maxItems: 4, items: { type: 'string' } } },
      },
    })
    const runner = createModuleRunner(registry, new ModuleCoordinator(), new Map())

    await expect(runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { queries: ['one'] } }))
      .resolves.toMatchObject({ status: 'succeeded' })
    await expect(runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { queries: [] } }))
      .resolves.toMatchObject({ status: 'blocked', reason: 'input-schema-invalid' })
    await expect(runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { queries: ['one', 2] } }))
      .resolves.toMatchObject({ status: 'blocked', reason: 'input-schema-invalid' })
  })

  it('rejects output values with the wrong property type', async () => {
    const registry = new ModuleRegistry(); registry.register(reader(async () => ({ value: 42 })))
    const runner = createModuleRunner(registry, new ModuleCoordinator(), new Map())

    const result = await runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'valid' } })

    expect(result.status).toBe('failed')
    expect(result.validated).toBe(false)
    expect(result.reason).toBe('output-schema-invalid')
  })

  it('times out a run and reports a structured terminal result', async () => {
    const registry = new ModuleRegistry()
    registry.register({
      ...reader(async () => await new Promise(() => {})),
      resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 5 },
    })
    const runner = createModuleRunner(registry, new ModuleCoordinator(), new Map())

    const result = await runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'a' } })

    expect(result.status).toBe('timed_out')
    expect(result.validated).toBe(false)
    expect(result.reason).toBe('timeout')
  })

  it('releases queue capacity when a queued run is cancelled', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const registry = new ModuleRegistry()
    registry.register(reader(async ({ input }) => { await gate; return { value: valueInput(input) } }))
    const runner = createModuleRunner(registry, new ModuleCoordinator(), new Map())
    const active = runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'a' } })
    const cancelled = runner({ sessionId: 'B', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'b' } })

    expect(cancelled.cancel()).toBe(true)
    expect((await cancelled).status).toBe('cancelled')
    const replacement = runner({ sessionId: 'C', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'c' } })
    release()

    expect((await active).status).toBe('succeeded')
    expect((await replacement).status).toBe('succeeded')
  })

  it('returns an identified non-cancellable run for an unknown module', async () => {
    const runner = createModuleRunner(new ModuleRegistry(), new ModuleCoordinator(), new Map())

    const run = runner({ sessionId: 'A', taskId: 'T', moduleRef: 'missing@1.0.0' })

    expect(run.runId).toEqual(expect.any(String))
    expect(run.cancel()).toBe(false)
    const result = await run
    expect(result.runId).toBe(run.runId)
    expect(result.status).toBe('blocked')
    expect(result.reason).toBe('module-not-found')
  })

  it('blocks invalid input before execution', async () => {
    let executed = false
    const registry = new ModuleRegistry(); registry.register(reader(async () => { executed = true; return { value: 'unused' } }))
    const runner = createModuleRunner(registry, new ModuleCoordinator(), new Map())

    const result = await runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 42 } })

    expect(result.status).toBe('blocked')
    expect(result.reason).toBe('input-schema-invalid')
    expect(executed).toBe(false)
  })

  it('blocks a missing tool before execution', async () => {
    let executed = false
    const registry = new ModuleRegistry(); registry.register({ ...reader(async () => { executed = true; return { value: 'unused' } }), tools: ['read'] })
    const runner = createModuleRunner(registry, new ModuleCoordinator(), new Map())

    const result = await runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'valid' } })

    expect(result.status).toBe('blocked')
    expect(result.reason).toBe('tool-not-available')
    expect(executed).toBe(false)
  })

  it('rejects invalid module resource policies at registration', () => {
    for (const resourcePolicy of [
      { maxConcurrent: 0, queueLimit: 1, timeoutMs: 100 },
      { maxConcurrent: 1.5, queueLimit: 1, timeoutMs: 100 },
      { maxConcurrent: 1, queueLimit: -1, timeoutMs: 100 },
      { maxConcurrent: 1, queueLimit: 1, timeoutMs: 0 },
      { maxConcurrent: 1, queueLimit: 1, timeoutMs: Number.POSITIVE_INFINITY },
    ]) {
      const registry = new ModuleRegistry()
      expect(() => registry.register({ ...reader(), resourcePolicy })).toThrow('invalid-module-policy')
    }
  })

  it('rejects invalid coordinator limits', () => {
    for (const limits of [
      { maxConcurrent: 0 },
      { maxConcurrent: 1.5 },
      { queueLimit: -1 },
      { queueLimit: 1.5 },
    ]) expect(() => new ModuleCoordinator(limits)).toThrow('invalid-coordinator-policy')
  })

  it('stores module definitions as deeply immutable snapshots', () => {
    const registry = new ModuleRegistry()
    const definition = reader()
    registry.register(definition)
    const mutableTools = definition.tools as string[]
    mutableTools.push('late')
    definition.resourcePolicy.maxConcurrent = 99
    const stored = registry.get('reader@1.0.0')

    expect(stored.tools).toEqual([])
    expect(stored.resourcePolicy.maxConcurrent).toBe(1)
    expect(Object.isFrozen(stored)).toBe(true)
    expect(Object.isFrozen(stored.resourcePolicy)).toBe(true)
  })



  it('cancels active and queued runs when the coordinator is disposed', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const registry = new ModuleRegistry()
    registry.register(reader(async () => { await gate; return { value: 'done' } }))
    const coordinator = new ModuleCoordinator({ maxConcurrent: 1, queueLimit: 1 })
    const runner = createModuleRunner(registry, coordinator, new Map())
    const active = runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'a' } })
    const queued = runner({ sessionId: 'B', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'b' } })

    coordinator.dispose()

    await expect(active).resolves.toMatchObject({ status: 'cancelled', reason: 'disposed' })
    await expect(queued).resolves.toMatchObject({ status: 'cancelled', reason: 'disposed' })
    await expect(runner({ sessionId: 'C', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'c' } })).resolves.toMatchObject({ status: 'blocked', reason: 'disposed' })
    release()
  })

  it('cancels only the selected run', async () => {
    const registry = new ModuleRegistry(); registry.register(reader(async ({ signal, input }: ModuleExecutionContext) => { await new Promise<void>((resolve, reject) => { signal.addEventListener('abort', () =>{  reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })) }); setTimeout(resolve, 20) }); return { value: valueInput(input) } }))
    const runner = createModuleRunner(registry, new ModuleCoordinator({ maxConcurrent: 2 }), new Map())
    const a = runner({ sessionId: 'A', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'a' } }); const b = runner({ sessionId: 'B', taskId: 'T', moduleRef: 'reader@1.0.0', input: { value: 'b' } }); a.cancel()
    expect((await a).status).toBe('cancelled'); expect((await b).status).toBe('succeeded')
  })
})
