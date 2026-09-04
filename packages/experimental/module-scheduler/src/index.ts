import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

declare module '@deepseek-ai/cordis' {
  interface Context {
    moduleScheduler: ModuleSchedulerService
  }
}

/** Lifecycle states for one module run. */
export type ModuleStatus =
  | 'created'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'timed_out'

/** JSON-like validation schema supported by module inputs and outputs. */
export type ModuleSchema =
  | {
    type: 'object'
    required?: readonly string[]
    additionalProperties?: boolean
    properties?: Readonly<Record<string, ModuleSchema>>
  }
  | { type: 'array'; items: ModuleSchema; minItems?: number; maxItems?: number }
  | { type: 'string' | 'number' | 'boolean' }

/** Input identifying one module run. */
export interface ModuleRunRequest {
  sessionId: string
  taskId: string
  moduleRef: string
  input?: unknown
}

/** Concurrency, queue, and timeout limits for a module. */
export interface ModulePolicy {
  /** Maximum active runs for this module. */
  maxConcurrent: number
  /** Maximum queued runs for this module. */
  queueLimit: number
  /** Run timeout in milliseconds. */
  timeoutMs: number
}

/** Tool callable by a module execution. */
export type ModuleTool = (args: unknown) => Promise<unknown>

/** Context supplied to a module execution. */
export interface ModuleExecutionContext {
  sessionId: string
  taskId: string
  runId: string
  input: unknown
  signal: AbortSignal
  tools: ReadonlyMap<string, ModuleTool>
}

/** Immutable registered module definition. */
export interface ModuleDefinition {
  id: string
  version: string
  /** Chinese name shown to users; the stable id remains language-neutral. */
  displayName: string
  description: string
  tools: readonly string[]
  inputSchema: ModuleSchema
  outputSchema: ModuleSchema
  resourcePolicy: ModulePolicy
  execute: (context: ModuleExecutionContext) => Promise<unknown>
}

/** Terminal or active result for one module run. */
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

/** Browser-facing module projection. */
export interface ModuleView {
  ref: string
  id: string
  version: string
  displayName: string
  description: string
  tools: readonly string[]
  inputSchema: ModuleSchema
  runnableFromBrowser: boolean
}

/** Browser-facing run projection. */
export interface ModuleRunView {
  runId: string
  taskId: string
  moduleRef: string
  status: ModuleStatus
  reason?: string
  output?: JsonValue
}

/** Browser-facing scheduler projection. */
export interface ModuleSchedulerView {
  modules: ModuleView[]
  runs: ModuleRunView[]
}

/** Browser request to start a module. */
export interface BrowserModuleRunRequest {
  taskId: string
  moduleRef: string
  input?: JsonValue
}

/** Structured browser control error. */
export interface ModuleConsoleError {
  code: string
  message: string
}

/** Result returned by a browser start request. */
export type ModuleStartResult =
  | { ok: true; value: ModuleRunView }
  | { ok: false; error: ModuleConsoleError }

/** Result returned by a browser cancellation request. */
export type ModuleCancelResult =
  | { ok: true; value: boolean }
  | { ok: false; error: ModuleConsoleError }

/** Scheduler-wide optional limits and run history retention. */
export interface ModuleSchedulerConfig extends Partial<ModulePolicy> {
  /** Maximum terminal run records retained per session. */
  maxRecentRuns?: number
}

/** Promise handle for one isolated module run. */
export type ModuleRunHandle = Promise<ModuleRunResult> & {
  runId: string
  cancel: () => boolean
}

/** Context passed to a host tool adapter. */
export interface HostToolContext {
  request: ModuleRunRequest
  run: ModuleRunResult & { signal: AbortSignal }
}

/** Host tool adapter exposed to module runners. */
export type HostTool = (args: unknown, context: HostToolContext) => Promise<unknown>

const terminal = new Set<ModuleStatus>(['succeeded', 'failed', 'blocked', 'cancelled', 'timed_out'])

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
}

/** Validate a value against a module schema.
 * @param schema - Schema to apply.
 * @param value - Value to validate.
 * @returns Validation error paths, or an empty array.
 */
export function validateSchema(schema: ModuleSchema, value: unknown): string[] {
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return ['$: type']
    const errors: string[] = []
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push('$: minItems')
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push('$: maxItems')
    for (const [index, item] of value.entries()) {
      errors.push(...validateSchema(schema.items, item).map(error => error.replace('$', `$[${index}]`)))
    }
    return errors
  }
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

/** Registry of immutable module definitions. */
export class ModuleRegistry {
  private readonly items = new Map<string, ModuleDefinition>()

  /** Register one immutable module definition.
   * @param definition - Module to register.
   * @returns Its versioned reference.
   */
  register(definition: ModuleDefinition): string {
    if (!/\p{Script=Han}/u.test(definition.displayName) || !/\p{Script=Han}/u.test(definition.description)) {
      throw new Error('invalid-module-localization')
    }
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

  /** Remove one registered module.
   * @param ref - Versioned module reference.
   * @returns Whether a module was removed.
   */
  unregister(ref: string): boolean {
    return this.items.delete(ref)
  }

  /** Retrieve one registered module.
   * @param ref - Versioned module reference.
   * @returns The registered definition.
   */
  get(ref: string): ModuleDefinition {
    const definition = this.items.get(ref)
    if (!definition) throw new Error('module-not-found')
    return definition
  }

  /** List browser-facing module projections.
   * @returns Registered module projections sorted by reference.
   */
  list(): ModuleView[] {
    return [...this.items.values()].map(({ id, version, displayName, description, tools, inputSchema }) => ({
      ref: `${id}@${version}`,
      id,
      version,
      displayName,
      description,
      tools,
      inputSchema,
      runnableFromBrowser: tools.length === 0,
    })).sort((left, right) => left.ref.localeCompare(right.ref))
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

/** Bounded coordinator for isolated module runs. */
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

  /** Cancel queued and active runs. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.queue.splice(0)) this.finishQueued(entry, 'cancelled', 'disposed')
    for (const entry of this.runs.values()) entry.controller.abort('disposed')
  }

  /** Enqueue and execute one isolated module run.
   * @param request - Run request and module reference.
   * @param policy - Module resource policy.
   * @param outputSchema - Schema for the module output.
   * @param execute - Module execution callback.
   * @returns A cancellable run handle.
   */
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

  /** Cancel one queued or active run.
   * @param runId - Run identity to cancel.
   * @returns Whether the run was found.
   */
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

/** Create a runner that resolves modules and gates declared tools.
 * @param registry - Module definition registry.
 * @param coordinator - Bounded run coordinator.
 * @param hostTools - Host tool adapters available to modules.
 * @returns A function that creates cancellable run handles.
 */
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
export class ModuleSchedulerService extends TypertRemoteService {
  static inject = ['tools']

  /** Shared immutable module registry. */
  readonly registry: ModuleRegistry = new ModuleRegistry()
  /** Bounded coordinator for all runs. */
  readonly coordinator: ModuleCoordinator
  private readonly recentRuns = new Map<string, ModuleRunView[]>()
  private readonly activeHandles = new Map<string, ModuleRunHandle>()
  private readonly maxRecentRuns: number

  constructor(ctx: Context, config: ModuleSchedulerConfig = {}) {
    super(ctx, 'moduleScheduler')
    const { maxRecentRuns = 50, ...limits } = config
    if (!Number.isSafeInteger(maxRecentRuns) || maxRecentRuns < 0) throw new Error('invalid-run-history-limit')
    this.maxRecentRuns = maxRecentRuns
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
   * Returns registered modules and bounded run records for one browser session.
   * @param sessionId - Browser session whose run history is projected.
   * @returns The current module catalog and session-local run history.
   */
  @Remote('view')
  remoteView(sessionId: string): ModuleSchedulerView {
    return {
      modules: this.registry.list(),
      runs: structuredClone(this.recentRuns.get(sessionId) ?? []),
    }
  }

  /**
   * Starts one tool-free module from the browser control surface.
   * @param sessionId - Browser session that owns the projected run.
   * @param request - Task, module reference, and schema-checked input.
   * @returns The created run view or an explicit business failure.
   */
  @Remote('start')
  remoteStart(sessionId: string, request: BrowserModuleRunRequest): ModuleStartResult {
    let definition: ModuleDefinition
    try {
      definition = this.registry.get(request.moduleRef)
    } catch (error: unknown) {
      return failure(errorMessage(error))
    }
    if (definition.tools.length > 0) return failure('module-requires-agent')
    if (validateSchema(definition.inputSchema, request.input ?? {}).length > 0) return failure('input-schema-invalid')

    const handle = this.run({ ...request, sessionId })
    const view: ModuleRunView = {
      runId: handle.runId,
      taskId: request.taskId,
      moduleRef: request.moduleRef,
      status: 'created',
    }
    const runs = this.recentRuns.get(sessionId) ?? []
    runs.unshift(view)
    this.recentRuns.set(sessionId, runs)
    this.activeHandles.set(handle.runId, handle)
    void handle.then((result) => {
      view.status = result.status
      if (result.reason === undefined) delete view.reason
      else view.reason = result.reason
      if (result.status === 'succeeded') view.output = structuredClone(result.output as JsonValue)
      else delete view.output
      this.activeHandles.delete(handle.runId)
      this.trimRuns(sessionId)
    })
    return { ok: true, value: structuredClone(view) }
  }

  /**
   * Cancels one active run owned by the requested browser session.
   * @param sessionId - Browser session that must own the run.
   * @param runId - Active run identity to cancel.
   * @returns Whether cancellation was accepted or an explicit business failure.
   */
  @Remote('cancel')
  remoteCancel(sessionId: string, runId: string): ModuleCancelResult {
    const run = this.recentRuns.get(sessionId)?.find(candidate => candidate.runId === runId)
    const handle = this.activeHandles.get(runId)
    if (!run || !handle) return failure('run-not-found')
    return { ok: true, value: handle.cancel() }
  }

  private trimRuns(sessionId: string): void {
    const runs = this.recentRuns.get(sessionId)
    if (!runs) return
    let terminalCount = 0
    this.recentRuns.set(sessionId, runs.filter((run) => {
      if (!isTerminal(run.status)) return true
      terminalCount += 1
      return terminalCount <= this.maxRecentRuns
    }))
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

function failure(message: string): { ok: false; error: ModuleConsoleError } {
  return { ok: false, error: { code: message, message } }
}

/** Test whether a run status is terminal.
 * @param status - Status to inspect.
 * @returns Whether the status is terminal.
 */
export function isTerminal(status: string): status is ModuleStatus {
  return terminal.has(status as ModuleStatus)
}

export default ModuleSchedulerService
