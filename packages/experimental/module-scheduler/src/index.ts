import { Context, Service } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

declare module '@deepseek-ai/cordis' {
  interface Context {
    moduleScheduler: ModuleSchedulerService
  }
}

export type ModuleStatus =
  | 'created'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'timed_out'

export type ModuleSchema =
  | {
    type: 'object'
    required?: readonly string[]
    additionalProperties?: boolean
    properties?: Readonly<Record<string, ModuleSchema>>
  }
  | { type: 'string' | 'number' | 'boolean' }

export interface ModuleRunRequest {
  sessionId: string
  taskId: string
  moduleRef: string
  input?: unknown
}

export interface ModulePolicy {
  maxConcurrent: number
  queueLimit: number
  timeoutMs: number
}

export type ModuleTool = (args: unknown) => Promise<unknown>

export interface ModuleExecutionContext {
  sessionId: string
  taskId: string
  runId: string
  input: unknown
  signal: AbortSignal
  tools: ReadonlyMap<string, ModuleTool>
}

export interface ModuleDefinition {
  id: string
  version: string
  description: string
  tools: readonly string[]
  inputSchema: ModuleSchema
  outputSchema: ModuleSchema
  resourcePolicy: ModulePolicy
  execute: (context: ModuleExecutionContext) => Promise<unknown>
}

export interface ModuleRunResult {
  runId: string
  sessionId: string
  taskId: string
  moduleRef: string
  status: ModuleStatus
  validated: boolean
  reason?: string
  output?: unknown
}

export type ModuleRunHandle = Promise<ModuleRunResult> & {
  runId: string
  cancel: () => boolean
}

export interface HostToolContext {
  request: ModuleRunRequest
  run: ModuleRunResult & { signal: AbortSignal }
}

export type HostTool = (args: unknown, context: HostToolContext) => Promise<unknown>

const terminal = new Set<ModuleStatus>(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out'])

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

export function validateSchema(schema: ModuleSchema, value: unknown): string[] {
  if (schema.type !== 'object') return typeof value === schema.type ? [] : ['$: type']
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return ['$: type']

  const record = value as Record<string, unknown>
  const properties = schema.properties ?? {}
  const errors: string[] = []
  for (const key of schema.required ?? []) {
    if (!(key in record)) errors.push(`$.${key}: required`)
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(record)) {
      if (!(key in properties)) errors.push(`$.${key}: additional`)
    }
  }
  for (const [key, child] of Object.entries(properties)) {
    if (!(key in record)) continue
    const childErrors = validateSchema(child, record[key])
    errors.push(...childErrors.map(error => error.replace('$', `$.${key}`)))
  }
  return errors
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freeze(child)
  return Object.freeze(value)
}

function settledRun(result: ModuleRunResult): ModuleRunHandle {
  const promise = Promise.resolve(result) as ModuleRunHandle
  promise.runId = result.runId
  promise.cancel = () => false
  return promise
}

function blockedRun(request: ModuleRunRequest, reason: string): ModuleRunHandle {
  return settledRun({
    runId: randomUUID(),
    sessionId: request.sessionId,
    taskId: request.taskId,
    moduleRef: request.moduleRef,
    status: 'blocked',
    validated: false,
    reason,
  })
}

export class ModuleRegistry {
  private readonly items = new Map<string, ModuleDefinition>()

  register(definition: ModuleDefinition): string {
    if (!Number.isSafeInteger(definition.resourcePolicy.maxConcurrent) || definition.resourcePolicy.maxConcurrent < 1
      || !Number.isSafeInteger(definition.resourcePolicy.queueLimit) || definition.resourcePolicy.queueLimit < 0
      || !Number.isFinite(definition.resourcePolicy.timeoutMs) || definition.resourcePolicy.timeoutMs <= 0) {
      throw new Error('invalid-module-policy')
    }
    const ref = `${definition.id}@${definition.version}`
    if (this.items.has(ref)) throw new Error('duplicate-module')
    const snapshot: ModuleDefinition = {
      ...definition,
      tools: [...definition.tools],
      inputSchema: structuredClone(definition.inputSchema),
      outputSchema: structuredClone(definition.outputSchema),
      resourcePolicy: { ...definition.resourcePolicy },
    }
    this.items.set(ref, freeze(snapshot))
    return ref
  }

  get(ref: string): ModuleDefinition {
    const definition = this.items.get(ref)
    if (!definition) throw new Error('module-not-found')
    return definition
  }

  list(): Pick<ModuleDefinition, 'id' | 'version' | 'description' | 'tools' | 'resourcePolicy'>[] {
    return [...this.items.values()].map(({ id, version, description, tools, resourcePolicy }) => ({
      id,
      version,
      description,
      tools,
      resourcePolicy,
    }))
  }
}

interface Entry {
  result: ModuleRunResult
  controller: AbortController
  resolve: (result: ModuleRunResult) => void
  execute: () => Promise<unknown>
  policy: ModulePolicy
  outputSchema: ModuleSchema
}

export class ModuleCoordinator {
  private active = 0
  private readonly activeByModule = new Map<string, number>()
  private readonly queue: Entry[] = []
  private readonly runs = new Map<string, Entry>()
  private readonly limits: ModulePolicy
  private disposed = false

  constructor(limits: Partial<ModulePolicy> = {}) {
    this.limits = { maxConcurrent: 4, queueLimit: 32, timeoutMs: 30_000, ...limits }
    if (!Number.isSafeInteger(this.limits.maxConcurrent) || this.limits.maxConcurrent < 1
      || !Number.isSafeInteger(this.limits.queueLimit) || this.limits.queueLimit < 0) {
      throw new Error('invalid-coordinator-policy')
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.queue.splice(0)) this.finishQueued(entry, 'cancelled', 'disposed')
    for (const entry of this.runs.values()) entry.controller.abort('disposed')
  }

  run(
    request: ModuleRunRequest,
    policy: ModulePolicy,
    outputSchema: ModuleSchema,
    execute: (run: { result: ModuleRunResult; signal: AbortSignal }) => Promise<unknown>,
  ): ModuleRunHandle {
    if (this.disposed) return blockedRun(request, 'disposed')
    const result: ModuleRunResult = {
      runId: randomUUID(),
      sessionId: request.sessionId,
      taskId: request.taskId,
      moduleRef: request.moduleRef,
      status: 'created',
      validated: false,
    }
    const controller = new AbortController()
    let resolve!: (value: ModuleRunResult) => void
    const promise = new Promise<ModuleRunResult>((done) => {
      resolve = done
    }) as ModuleRunHandle
    const entry: Entry = {
      result,
      controller,
      resolve,
      execute: () => execute({ result, signal: controller.signal }),
      policy,
      outputSchema,
    }
    promise.runId = result.runId
    promise.cancel = () => this.cancel(result.runId)
    this.runs.set(result.runId, entry)
    if (this.canStart(entry)) void this.start(entry)
    else if (this.canQueue(entry)) this.queue.push(entry)
    else this.finishQueued(entry, 'blocked', 'queue-limit')
    return promise
  }

  cancel(runId: string): boolean {
    const entry = this.runs.get(runId)
    if (!entry) return false
    entry.controller.abort('cancelled')
    if (entry.result.status === 'created') {
      const index = this.queue.indexOf(entry)
      if (index >= 0) this.queue.splice(index, 1)
      this.finishQueued(entry, 'cancelled', 'cancelled-before-start')
    }
    return true
  }

  private canStart(entry: Entry): boolean {
    const moduleActive = this.activeByModule.get(entry.result.moduleRef) ?? 0
    return this.active < this.limits.maxConcurrent && moduleActive < entry.policy.maxConcurrent
  }

  private canQueue(entry: Entry): boolean {
    const moduleQueued = this.queue.filter(item => item.result.moduleRef === entry.result.moduleRef).length
    return this.queue.length < this.limits.queueLimit && moduleQueued < entry.policy.queueLimit
  }

  private finishQueued(entry: Entry, status: ModuleStatus, reason: string): void {
    this.runs.delete(entry.result.runId)
    entry.resolve({ ...entry.result, status, reason, validated: false })
  }

  private async start(entry: Entry): Promise<void> {
    this.active += 1
    const moduleRef = entry.result.moduleRef
    this.activeByModule.set(moduleRef, (this.activeByModule.get(moduleRef) ?? 0) + 1)
    entry.result.status = 'running'
    const timer = setTimeout(() => {
      entry.controller.abort('timeout')
    }, entry.policy.timeoutMs)
    let final: ModuleRunResult
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        entry.controller.signal.addEventListener('abort', () => {
          const reason = String(entry.controller.signal.reason)
          const code = reason === 'timeout' ? 'timed_out' : 'cancelled'
          reject(Object.assign(new Error(reason), { code }))
        }, { once: true })
      })
      const output = await Promise.race([entry.execute(), aborted])
      const outputErrors = validateSchema(entry.outputSchema, output)
      if (outputErrors.length > 0) throw Object.assign(new Error('output-schema-invalid'), { code: 'failed' })
      final = { ...entry.result, status: 'succeeded', validated: true, output }
    } catch (error: unknown) {
      const code = errorCode(error)
      const status: ModuleStatus = code === 'cancelled' ? 'cancelled' : code === 'timed_out' ? 'timed_out' : 'failed'
      final = { ...entry.result, status, validated: false, reason: errorMessage(error) }
    } finally {
      clearTimeout(timer)
    }
    this.active -= 1
    this.activeByModule.set(moduleRef, (this.activeByModule.get(moduleRef) ?? 1) - 1)
    this.runs.delete(entry.result.runId)
    entry.resolve(final)
    this.drain()
  }

  private drain(): void {
    for (let index = 0; index < this.queue.length && this.active < this.limits.maxConcurrent;) {
      const entry = this.queue[index]
      if (!entry) break
      if (!this.canStart(entry)) {
        index += 1
        continue
      }
      this.queue.splice(index, 1)
      void this.start(entry)
    }
  }
}

export function createModuleRunner(
  registry: ModuleRegistry,
  coordinator: ModuleCoordinator,
  hostTools: ReadonlyMap<string, HostTool>,
): (request: ModuleRunRequest) => ModuleRunHandle {
  return (request) => {
    let definition: ModuleDefinition
    try {
      definition = registry.get(request.moduleRef)
    } catch (error: unknown) {
      return blockedRun(request, errorMessage(error))
    }
    const input = request.input ?? {}
    if (validateSchema(definition.inputSchema, input).length > 0) return blockedRun(request, 'input-schema-invalid')
    if (definition.tools.some(tool => !hostTools.has(tool))) return blockedRun(request, 'tool-not-available')
    return coordinator.run(request, definition.resourcePolicy, definition.outputSchema, ({ result, signal }) => {
      const run = { ...result, signal }
      const moduleTools = new Map(definition.tools.map((name): [string, ModuleTool] => [
        name,
        async (args) => {
          if (signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'cancelled' })
          const tool = hostTools.get(name)
          if (!tool) throw new Error('tool-not-available')
          return tool(args, { request, run })
        },
      ]))
      return definition.execute({
        sessionId: result.sessionId,
        taskId: result.taskId,
        runId: result.runId,
        input,
        signal,
        tools: moduleTools,
      })
    })
  }
}

/**
 * Registers immutable module definitions and runs isolated modules through DSH ToolRuntime.
 * Disposing the service cancels queued and active runs and rejects later calls as blocked.
 */
export class ModuleSchedulerService extends Service {
  static inject = ['tools']

  readonly registry: ModuleRegistry = new ModuleRegistry()
  readonly coordinator: ModuleCoordinator

  constructor(ctx: Context, limits: Partial<ModulePolicy> = {}) {
    super(ctx, 'moduleScheduler')
    this.coordinator = new ModuleCoordinator(limits)
    ctx.effect(() => {
      return () => { this.coordinator.dispose() }
    }, 'module-scheduler: dispose runs')
  }

  /**
   * Creates a runner using the supplied host-tool map.
   * @param hostTools - Host tools available to declared module calls.
   * @returns A runner whose handles expose run-scoped cancellation and terminal results.
   */
  runner(hostTools: ReadonlyMap<string, HostTool> = new Map()): (request: ModuleRunRequest) => ModuleRunHandle {
    return createModuleRunner(this.registry, this.coordinator, hostTools)
  }

  /**
   * Runs one registered module through the host ToolRuntime.
   * @param request - Session, task, module reference, and schema-checked input.
   * @returns A handle that resolves to a validated success or an explicit terminal failure.
   */
  run(request: ModuleRunRequest): ModuleRunHandle {
    let sequence = 0
    const hostTools = new Map<string, HostTool>()
    for (const { name } of this.ctx.tools.schemas()) {
      hostTools.set(name, async (args, { run }) => {
        sequence += 1
        const outcome = await this.ctx.tools.execute({
          callId: ToolCallId(`${run.runId}:module:${sequence}`),
          name,
          arguments: args,
          signal: run.signal,
        })
        if (outcome.isError) throw new Error(outcome.error.message)
        return outcome.value
      })
    }
    return this.runner(hostTools)(request)
  }
}

export function isTerminal(status: string): status is ModuleStatus {
  return terminal.has(status as ModuleStatus)
}

export default ModuleSchedulerService
