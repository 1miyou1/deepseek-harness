export interface QuickTaskRequest {
  readonly active: boolean
  readonly allowedPaths: readonly string[]
  readonly checksRequired: boolean
}

export interface QuickTaskState extends QuickTaskRequest {
  implementAttempts: number
  leasedPaths: string[]
  implemented: boolean
  tested: boolean
  escalated: boolean
}

export type QuickToolDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

const ALLOWED_MODULES = new Set([
  'code-implementer@1.0.0',
  'test-runner@1.0.0',
  'git-inspector@1.0.0',
  'code-auditor@1.0.0',
  'independent-review@1.0.0',
])

function normalizePath(path: string): string {
  let normalized = path.split(String.fromCharCode(92)).join('/')
  if (normalized.startsWith('./')) normalized = normalized.slice(2)
  if (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
  return normalized
}

function fieldValue(text: string, label: string): string | undefined {
  for (const rawLine of text.split(String.fromCharCode(10))) {
    const line = rawLine.replaceAll(String.fromCharCode(13), '').trim()
    if (line.startsWith(label + ':') || line.startsWith(label + '：')) return line.slice(label.length + 1).trim()
  }
  return undefined
}

export function parseQuickTask(text: string): QuickTaskRequest {
  const trimmed = text.trimStart()
  const newline = String.fromCharCode(10)
  if (trimmed !== '/quick' && !trimmed.startsWith('/quick ') && !trimmed.startsWith('/quick' + newline)) {
    return { active: false, allowedPaths: [], checksRequired: true }
  }
  const scope = fieldValue(text, '允许范围')
  const allowedPaths = scope === undefined
    ? []
    : [...new Set(scope.split(/[,，]/u).map(part => normalizePath(part.trim())).filter(Boolean))]
  const checks = fieldValue(text, '验收')?.toLowerCase()
  return { active: true, allowedPaths, checksRequired: checks !== 'none' && checks !== '无' }
}

function isAllowedPath(path: string, scopes: readonly string[]): boolean {
  const normalized = normalizePath(path)
  return scopes.some(scope => normalized === scope || normalized.startsWith(scope + '/'))
}

export function evaluateQuickToolCall(
  state: QuickTaskState,
  name: string,
  args: Readonly<Record<string, unknown>>,
): QuickToolDecision {
  if (name === 'write' || name === 'edit' || name === 'pwsh') {
    return { allowed: false, reason: 'quick_task_direct-mutation-denied: use code-implementer and test-runner modules' }
  }
  if (name === 'pipeline_template_run') {
    return args.templateRef === 'code-review-flow@1.0.0'
      ? { allowed: true }
      : { allowed: false, reason: 'quick_task_pipeline-denied: only code-review-flow@1.0.0 is allowed' }
  }
  if (name !== 'module_run') return { allowed: true }
  const moduleRef = typeof args.moduleRef === 'string' ? args.moduleRef : ''
  if (!ALLOWED_MODULES.has(moduleRef)) {
    return { allowed: false, reason: 'quick_task_module-denied: module is outside the quick-task allowlist' }
  }
  if (moduleRef !== 'code-implementer@1.0.0') return { allowed: true }
  if (state.implementAttempts >= 2) {
    return { allowed: false, reason: 'quick_task_repair-budget-exhausted: at most two implementation attempts are allowed' }
  }
  const input = args.input !== null && typeof args.input === 'object' ? args.input as Record<string, unknown> : {}
  const writePaths = Array.isArray(input.writePaths) ? input.writePaths.filter((path): path is string => typeof path === 'string') : []
  if (writePaths.length === 0 || writePaths.length > 3) {
    return { allowed: false, reason: 'quick_task_write-scope-invalid: writePaths must contain between one and three paths' }
  }
  const cumulativePaths = new Set([...state.leasedPaths, ...writePaths.map(normalizePath)])
  if (cumulativePaths.size > 3) {
    return { allowed: false, reason: 'quick_task_cumulative-scope-denied: the task may touch at most three paths in total' }
  }
  if (state.allowedPaths.length === 0 || writePaths.some(path => !isAllowedPath(path, state.allowedPaths))) {
    return { allowed: false, reason: 'quick_task_write-scope-denied: writePaths exceed the user-declared scope' }
  }
  return { allowed: true }
}
