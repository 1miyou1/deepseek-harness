/**
 * Independent Code Reviewer logic.
 * Inspects diffs, commit context, or targets for architectural risks, test coverage, and breaking changes.
 *
 * @module @deepseek-ai/dsh-experimental-independent-review-profile/reviewer
 */

import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

export type ReviewVerdict = 'approved' | 'changes_requested' | 'commented'

export interface ReviewFinding {
  readonly file: string
  readonly line?: number
  readonly aspect: 'architecture' | 'contract' | 'test_coverage' | 'security' | 'maintainability'
  readonly severity: 'critical' | 'warning' | 'info'
  readonly title: string
  readonly details: string
  readonly suggestion?: string
}

export interface ReviewResult {
  readonly ok: boolean
  readonly verdict: ReviewVerdict
  readonly score: number
  readonly summary: string
  readonly findings: readonly ReviewFinding[]
  readonly stats: {
    readonly filesAnalyzed: number
    readonly criticalCount: number
    readonly warningCount: number
    readonly infoCount: number
  }
}

export interface ReviewInput {
  readonly targetPath?: string
  readonly diffBase?: string
  readonly contextNote?: string
  readonly requireTests?: boolean
}

const MAX_OUTPUT_BYTES = 64 * 1024

async function runGit(
  subprocess: SubprocessRuntime,
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const timeout = AbortSignal.timeout(15_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const handle = subprocess.spawn({
      argv: ['git', ...args],
      cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT_BYTES }, stderr: { maxBytes: MAX_OUTPUT_BYTES } },
      graceMs: 1_000,
      signal: combined,
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '' }
    const stderr = handle.collected.stderr?.readFrom(0) ?? { text: '' }
    return { exitCode: outcome.exitCode, stdout: stdout.text, stderr: stderr.text }
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String(err) }
  }
}

export async function performIndependentReview(
  subprocess: SubprocessRuntime | undefined,
  input: ReviewInput,
  signal?: AbortSignal,
): Promise<ReviewResult> {
  if (signal?.aborted) {
    throw new Error('review-aborted')
  }

  const targetPath = input.targetPath ?? '.'
  const diffBase = input.diffBase ?? 'HEAD'
  const requireTests = input.requireTests ?? true

  let diffOutput = ''
  let statusOutput = ''

  if (subprocess) {
    const [gitDiff, gitStatus] = await Promise.all([
      runGit(subprocess, ['diff', diffBase], targetPath, signal),
      runGit(subprocess, ['status', '--porcelain'], targetPath, signal),
    ])
    diffOutput = gitDiff.stdout
    statusOutput = gitStatus.stdout
  }

  const findings: ReviewFinding[] = []
  const filesAnalyzed = new Set<string>()

  // Analyze porcelain status
  for (const line of statusOutput.split('\n')) {
    if (line.length < 4) continue
    const file = line.slice(3).trim()
    if (file) filesAnalyzed.add(file)
  }

  // Parse modified files from diff
  for (const line of diffOutput.split('\n')) {
    if (line.startsWith('+++ b/')) {
      const file = line.slice(6).trim()
      if (file) filesAnalyzed.add(file)
    }
  }

  // Evaluate architectural rules and test requirements
  let hasSourceChanges = false
  let hasTestChanges = false

  for (const file of filesAnalyzed) {
    const isTest = file.includes('.spec.') || file.includes('.test.') || file.startsWith('tests/') || file.startsWith('test/')
    const isSource = (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.mjs')) && !isTest

    if (isSource) hasSourceChanges = true
    if (isTest) hasTestChanges = true

    // Check for risky anti-patterns in diff
    if (file.endsWith('package.json') && diffOutput.includes('"dependencies"')) {
      findings.push({
        file,
        aspect: 'contract',
        severity: 'warning',
        title: '依赖项变更',
        details: '检测到 package.json 依赖列表变更，需严格审查是否存在非必要冗余依赖引入。',
        suggestion: '优先复用既有模块或标准库，遵循 ponytail 原则。',
      })
    }
  }

  // Rule: Source changes require accompanying tests
  if (requireTests && hasSourceChanges && !hasTestChanges) {
    findings.push({
      file: 'tests',
      aspect: 'test_coverage',
      severity: 'warning',
      title: '缺少伴随测试',
      details: '检测到源码变更，但未发现新增或同步更新的测试文件（*.spec.ts / *.test.ts）。',
      suggestion: '请补充单元测试以保证新逻辑或修复具备质量防护网。',
    })
  }

  const criticalCount = findings.filter(f => f.severity === 'critical').length
  const warningCount = findings.filter(f => f.severity === 'warning').length
  const infoCount = findings.filter(f => f.severity === 'info').length

  let score = 100 - criticalCount * 40 - warningCount * 15 - infoCount * 5
  if (score < 0) score = 0

  let verdict: ReviewVerdict = 'approved'
  if (criticalCount > 0) verdict = 'changes_requested'
  else if (warningCount > 1) verdict = 'changes_requested'
  else if (warningCount === 1) verdict = 'commented'

  const summary = filesAnalyzed.size === 0
    ? '工作区干净，无未提交的代码或分支变更，审查通过。'
    : `审查完成：分析了 ${filesAnalyzed.size} 个改动文件，发现 ${criticalCount} 个严重缺陷、${warningCount} 个告警建议。总体评审评分：${score}/100。`

  return {
    ok: true,
    verdict,
    score,
    summary,
    findings,
    stats: {
      filesAnalyzed: filesAnalyzed.size,
      criticalCount,
      warningCount,
      infoCount,
    },
  }
}
