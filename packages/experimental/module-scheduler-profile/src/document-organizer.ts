/** Plan and apply bounded repository documentation changes with one managed Agent. */

import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ManagedModuleAgent, ModuleDefinition, ModuleSchema } from '@deepseek-ai/dsh-experimental-module-scheduler'

const DEFAULT_CONFIG = {
  maxFiles: 20, maxInputBytes: 200_000, maxPlanBytes: 500_000,
  maxSteps: 8, maxTokensPerStep: 8_192, totalTimeoutMs: 180_000,
  maxOutputBytes: 65_536, graceMs: 1_000,
} as const

type CheckResult = { name: string; ok: boolean; output?: string }
type DocumentPlan = {
  summary: string
  writes: Array<{ path: string; expectedContent: string; content: string }>
  creates: Array<{ path: string; content: string }>
  moves: Array<{ from: string; to: string; expectedContent: string }>
}

/** Deployment-owned bounds for document organization. */
export interface DocumentOrganizerConfig {
  maxFiles?: number
  maxInputBytes?: number
  maxPlanBytes?: number
  maxSteps?: number
  maxTokensPerStep?: number
  totalTimeoutMs?: number
  maxOutputBytes?: number
  graceMs?: number
  /** Repository root that owns the declared documents; defaults to the process working directory. */
  root?: string
}

/** Host-owned documentation checks run after applying a plan. */
export interface DocumentOrganizerRuntime {
  /** Run fixed checks for one declared document set. */
  runChecks(paths: readonly string[], signal: AbortSignal): Promise<CheckResult[]>
}

type ResolvedConfig = Required<DocumentOrganizerConfig>

function resolveConfig(config: DocumentOrganizerConfig = {}): ResolvedConfig {
  const value = { ...DEFAULT_CONFIG, root: process.cwd(), ...config }
  if (typeof value.root !== 'string' || value.root === '') throw new Error('document-organizer-config-invalid:root')
  for (const [name, limit] of Object.entries(value) as Array<[string, number]>) {
    if (name === 'root') continue
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`document-organizer-config-invalid:${name}`)
  }
  if (value.maxOutputBytes < 2_048) throw new Error('document-organizer-config-invalid:maxOutputBytes')
  return value
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path)
  return child !== '' && !child.startsWith('..') && !isAbsolute(child)
}

function documentPath(root: string, input: string): string {
  if (input === '' || isAbsolute(input) || input.includes('\\') || input.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error('document-path-invalid')
  }
  if (!input.endsWith('.md') && !input.endsWith('.i18n.yaml')) throw new Error('document-path-invalid')
  const normalized = input.toLowerCase()
  if (normalized.startsWith('.agents/notes/archived/')) throw new Error('document-path-forbidden')
  if (/(?:^|\/)(?:\.env|.*(?:secret|token|credential|key).*)(?:\/|$)/u.test(normalized)) {
    throw new Error('document-path-forbidden')
  }
  const path = resolve(root, input)
  if (!inside(root, path)) throw new Error('document-path-invalid')
  return path
}

async function assertSafeExistingPath(root: string, path: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined)
  if (info !== undefined && (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path)) {
    throw new Error('document-path-forbidden')
  }
  let parent = dirname(path)
  while (parent !== root) {
    const parentInfo = await lstat(parent).catch(() => undefined)
    if (parentInfo?.isSymbolicLink()) throw new Error('document-path-forbidden')
    parent = dirname(parent)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asPlan(value: unknown, maxBytes: number): DocumentPlan {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes || typeof value !== 'object' || value === null) throw new Error('document-plan-invalid')
  const record = value as Record<string, unknown>
  if (typeof record.summary !== 'string' || !Array.isArray(record.writes)
    || !Array.isArray(record.creates) || !Array.isArray(record.moves)) throw new Error('document-plan-invalid')
  const validWrites = record.writes.every((item: unknown) => isRecord(item)
    && typeof item.path === 'string' && typeof item.expectedContent === 'string' && typeof item.content === 'string')
  const validCreates = record.creates.every((item: unknown) => isRecord(item)
    && typeof item.path === 'string' && typeof item.content === 'string')
  const validMoves = record.moves.every((item: unknown) => isRecord(item)
    && typeof item.from === 'string' && typeof item.to === 'string' && typeof item.expectedContent === 'string')
  if (!validWrites || !validCreates || !validMoves) throw new Error('document-plan-invalid')
  return record as DocumentPlan
}

const planSchema: ModuleSchema = {
  type: 'object', required: ['summary', 'writes', 'creates', 'moves'], additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    writes: { type: 'array', items: { type: 'object', required: ['path', 'expectedContent', 'content'], additionalProperties: false, properties: {
      path: { type: 'string' }, expectedContent: { type: 'string' }, content: { type: 'string' },
    } } },
    creates: { type: 'array', items: { type: 'object', required: ['path', 'content'], additionalProperties: false, properties: {
      path: { type: 'string' }, content: { type: 'string' },
    } } },
    moves: { type: 'array', items: { type: 'object', required: ['from', 'to', 'expectedContent'], additionalProperties: false, properties: {
      from: { type: 'string' }, to: { type: 'string' }, expectedContent: { type: 'string' },
    } } },
  },
}

async function requestPlan(
  agent: ManagedModuleAgent,
  task: string,
  tier: 'luna' | 'terra',
  config: ResolvedConfig,
): Promise<unknown> {
  return agent.run({
    task, tools: [], outputSchema: planSchema, maxSteps: config.maxSteps,
    maxTokensPerStep: config.maxTokensPerStep, modelTier: tier,
  })
}

async function restoreFiles(snapshots: ReadonlyMap<string, Buffer | undefined>): Promise<void> {
  for (const path of snapshots.keys()) await rm(path, { force: true }).catch(() => undefined)
  for (const [path, content] of snapshots) {
    if (content === undefined) continue
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }
}

function allowedPath(allowed: ReadonlyMap<string, string>, path: string): string {
  const resolved = allowed.get(path)
  if (resolved === undefined) throw new Error('document-plan-path-undeclared')
  return resolved
}

async function applyPlan(
  root: string,
  allowed: ReadonlyMap<string, string>,
  plan: DocumentPlan,
  runtime: DocumentOrganizerRuntime,
  signal: AbortSignal,
): Promise<{ changedFiles: string[]; checks: CheckResult[] }> {
  const uses = [
    ...plan.writes.map(item => item.path), ...plan.creates.map(item => item.path),
    ...plan.moves.flatMap(item => [item.from, item.to]),
  ]
  if (new Set(uses).size !== uses.length) throw new Error('document-plan-conflict')
  for (const path of uses) if (!allowed.has(path)) throw new Error('document-plan-path-undeclared')
  const affected = new Map<string, Buffer | undefined>()
  for (const absolute of allowed.values()) {
    await assertSafeExistingPath(root, absolute)
    affected.set(absolute, await readFile(absolute).catch(() => undefined))
  }
  try {
    for (const item of plan.writes) {
      const path = allowedPath(allowed, item.path)
      if (await readFile(path, 'utf8').catch(() => undefined) !== item.expectedContent) throw new Error('document-file-changed')
      await writeFile(path, item.content)
    }
    for (const item of plan.creates) {
      const path = allowedPath(allowed, item.path)
      if (await lstat(path).then(() => true).catch(() => false)) throw new Error('document-target-exists')
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, item.content, { flag: 'wx' })
    }
    for (const item of plan.moves) {
      const from = allowedPath(allowed, item.from)
      const to = allowedPath(allowed, item.to)
      if (await readFile(from, 'utf8').catch(() => undefined) !== item.expectedContent) throw new Error('document-file-changed')
      if (await lstat(to).then(() => true).catch(() => false)) throw new Error('document-target-exists')
      await mkdir(dirname(to), { recursive: true })
      await rename(from, to)
    }
    const checks = await runtime.runChecks([...allowed.keys()], signal)
    if (checks.some(check => !check.ok)) throw new Error('document-check-failed')
    const changedFiles: string[] = []
    for (const [name, absolute] of allowed) {
      const before = affected.get(absolute)
      const after = await readFile(absolute).catch(() => undefined)
      if (before === undefined ? after !== undefined : after === undefined || !before.equals(after)) changedFiles.push(name)
    }
    return { changedFiles: changedFiles.sort(), checks }
  } catch (error) {
    await restoreFiles(affected)
    throw error
  }
}

function clip(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let end = Math.min(text.length, maxBytes)
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) end -= 1
  return text.slice(0, end)
}

function boundedOutput(
  value: { route: 'luna' | 'terra'; fallback: boolean; summary: string; changedFiles: string[]; checks: CheckResult[] },
  maxBytes: number,
): Record<string, unknown> {
  const complete = { ok: true, ...value, outputTruncated: false }
  if (Buffer.byteLength(JSON.stringify(complete), 'utf8') <= maxBytes) return complete
  const bounded = {
    ...complete,
    summary: clip(value.summary, Math.floor(maxBytes / 4)),
    checks: value.checks.map(check => ({ name: check.name, ok: check.ok })),
    outputTruncated: true,
  }
  if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= maxBytes) return bounded
  return { ...bounded, summary: '', changedFiles: [], checks: [] }
}

function prompt(task: string, documents: readonly { path: string; content?: string }[]): string {
  return [
    '整理以下显式声明的仓库文档。只返回结构化计划，不要调用 Sol。移动操作必须保持原内容不变；内容修改使用 writes；新文件使用 creates。',
    `任务：${task}`,
    ...documents.map(document => `\n--- ${document.path} ---\n${document.content ?? '[文件不存在，可作为新建或移动目标]'}`),
  ].join('\n')
}

/**
 * Create the general document organizer module definition.
 * @param root - Repository root containing the declared documents.
 * @param runtime - Host-owned focused documentation checks.
 * @param config - Deployment-owned run and content bounds.
 * @returns One immutable scheduler definition.
 */
export function createDocumentOrganizerDefinition(
  root: string,
  runtime: DocumentOrganizerRuntime,
  config?: DocumentOrganizerConfig,
): ModuleDefinition {
  const resolved = resolveConfig(config)
  return {
    id: 'document-organizer', version: '1.0.0', displayName: '通用文档整理器', description: '使用 Luna 规划并安全应用显式文档整理任务，模型错误时降级到 Terra',
    tools: [], requiresAgent: true,
    inputSchema: { type: 'object', required: ['files', 'task'], additionalProperties: false, properties: {
      files: { type: 'array', minItems: 1, maxItems: resolved.maxFiles, items: { type: 'string' } }, task: { type: 'string' },
    } },
    outputSchema: {
      type: 'object', required: ['ok', 'route', 'fallback', 'summary', 'changedFiles', 'checks', 'outputTruncated'],
      additionalProperties: false, properties: {
        ok: { type: 'boolean' }, route: { type: 'string' }, fallback: { type: 'boolean' }, summary: { type: 'string' },
        changedFiles: { type: 'array', items: { type: 'string' } },
        checks: { type: 'array', items: { type: 'object', additionalProperties: true } },
        outputTruncated: { type: 'boolean' },
      },
    },
    resourcePolicy: { maxConcurrent: 1, queueLimit: 1, timeoutMs: resolved.totalTimeoutMs },
    execute: async ({ input, agent, signal }) => {
      if (agent === undefined) throw new Error('module-requires-agent')
      if (typeof input !== 'object' || input === null) throw new Error('document-input-invalid')
      const request = input as { files?: unknown; task?: unknown }
      if (!Array.isArray(request.files) || request.files.length < 1 || request.files.length > resolved.maxFiles
        || request.files.some(path => typeof path !== 'string') || typeof request.task !== 'string' || request.task.trim() === '') {
        throw new Error('document-input-invalid')
      }
      const allowed = new Map<string, string>()
      const documents: Array<{ path: string; content?: string }> = []
      let inputBytes = Buffer.byteLength(request.task, 'utf8')
      for (const path of request.files as string[]) {
        inputBytes += Buffer.byteLength(path, 'utf8')
        if (allowed.has(path)) throw new Error('document-input-invalid')
        const absolute = documentPath(root, path)
        await assertSafeExistingPath(root, absolute)
        const content = await readFile(absolute, 'utf8').catch(() => undefined)
        inputBytes += Buffer.byteLength(content ?? '', 'utf8')
        if (inputBytes > resolved.maxInputBytes) throw new Error('document-input-too-large')
        allowed.set(path, absolute)
        documents.push({ path, ...(content === undefined ? {} : { content }) })
      }
      const task = prompt(request.task, documents)
      let route: 'luna' | 'terra' = 'luna'
      let fallback = false
      let rawPlan: unknown
      try {
        rawPlan = await requestPlan(agent, task, 'luna', resolved)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('managed-agent-error')) throw error
        route = 'terra'; fallback = true
        rawPlan = await requestPlan(agent, task, 'terra', resolved)
      }
      const plan = asPlan(rawPlan, resolved.maxPlanBytes)
      const applied = await applyPlan(root, allowed, plan, runtime, signal)
      return boundedOutput({ route, fallback, summary: plan.summary, ...applied }, resolved.maxOutputBytes)
    },
  }
}

/**
 * Register the document organizer for this profile lifetime.
 * @param ctx - Profile context that owns the scheduler registration.
 * @param runtime - Host-owned focused documentation checks.
 * @param config - Deployment-owned run and content bounds.
 */
export function applyDocumentOrganizer(ctx: Context, runtime: DocumentOrganizerRuntime, config?: DocumentOrganizerConfig): void {
  const resolved = resolveConfig(config)
  const ref = ctx.moduleScheduler.registry.register(createDocumentOrganizerDefinition(resolved.root, runtime, config))
  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, 'document-organizer: registration')
}
