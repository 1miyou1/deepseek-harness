/** Core implementation of code and diff auditing. */

import { isAbsolute, resolve } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

export type AuditSeverity = 'critical' | 'error' | 'warning' | 'info'
export type AuditCategory = 'security' | 'drift' | 'smell' | 'ponytail'

export interface AuditFinding {
  file: string
  line?: number
  rule: string
  category: AuditCategory
  severity: AuditSeverity
  message: string
  suggestion?: string
}

export interface AuditStats {
  filesChanged: number
  additions: number
  deletions: number
  staticFindingsCount: number
}

export interface AuditResult {
  ok: boolean
  passed: boolean
  riskLevel: 'clean' | 'low' | 'medium' | 'high' | 'critical'
  summary: string
  findings: AuditFinding[]
  stats: AuditStats
  error?: string
}

export interface AuditInput {
  targetPath?: string
  diffBase?: string
  mode?: 'static' | 'hybrid'
  strictPonytail?: boolean
}

export interface DiffLine {
  lineNum: number
  content: string
}

export interface ParsedFileDiff {
  file: string
  additions: number
  deletions: number
  lines: DiffLine[]
}

const SENSITIVE_FILES = [
  /router\.toml$/iu,
  /coordination-toggle\.json$/iu,
  /\.env(?:\.[a-z0-9_-]+)?$/iu,
  /credentials(?:\.json)?$/iu,
  /id_rsa|id_ed25519/iu,
  /(?:^|[\\/])AGENTS\.md$/iu,
]

const SECRET_PATTERNS = [
  { rule: 'secret:openai-api-key', pattern: /sk-[a-zA-Z0-9_-]{20,}/u, message: '发现疑似硬编码的 OpenAI/DeepSeek API Key' },
  { rule: 'secret:github-token', pattern: /gh[pousr][_-][a-zA-Z0-9]{36,}/u, message: '发现疑似硬编码的 GitHub Token' },
  { rule: 'secret:bearer-token', pattern: /bearer\s+[a-z0-9_.-]{32,}/iu, message: '发现疑似硬编码的 Bearer Token' },
  { rule: 'secret:private-key', pattern: /-----BEGIN\s+(?:RSA|OPENSSH|EC)?\s*PRIVATE KEY-----/iu, message: '发现硬编码的私钥证书' },
]

const DEBUG_PATTERNS = [
  { rule: 'smell:console-log', pattern: /(?:^|\s)console\.(?:log|debug|dir)\(/u, message: '发现遗留的控制台调试输出' },
  { rule: 'smell:debugger-statement', pattern: /(?:^|\s)debugger;/u, message: '发现未移除的 debugger 断点' },
]

const MAX_OUTPUT_BYTES = 64 * 1024

async function runGit(
  subprocess: SubprocessRuntime,
  args: string[],
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

export function parseDiff(rawDiff: string): ParsedFileDiff[] {
  const fileDiffs: ParsedFileDiff[] = []
  const fileChunks = rawDiff.split(/^diff --git /mu).filter(chunk => chunk.trim() !== '')

  for (const chunk of fileChunks) {
    const headerEnd = chunk.indexOf('\n')
    const header = headerEnd === -1 ? chunk : chunk.slice(0, headerEnd)
    const match = /a\/(.+?)\s+b\/(.+)/u.exec(header)
    const fileName = match ? (match[2] ?? match[1] ?? 'unknown') : 'unknown'

    let additions = 0
    let deletions = 0
    const lines: DiffLine[] = []
    let currentLine = 0

    for (const rawLine of chunk.split(/\r?\n/u)) {
      if (rawLine.startsWith('@@ ')) {
        const hunkMatch = /\+(\d+)(?:,\d+)?\s+@@/u.exec(rawLine)
        if (hunkMatch) currentLine = Number.parseInt(hunkMatch[1] ?? '1', 10)
      } else if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
        additions++
        lines.push({ lineNum: currentLine, content: rawLine.slice(1) })
        currentLine++
      } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
        deletions++
      } else if (!rawLine.startsWith('\\')) {
        currentLine++
      }
    }

    fileDiffs.push({ file: fileName, additions, deletions, lines })
  }

  return fileDiffs
}

export function auditStatic(
  fileDiffs: ParsedFileDiff[],
  options: { strictPonytail?: boolean } = {},
): AuditFinding[] {
  const findings: AuditFinding[] = []

  for (const fileDiff of fileDiffs) {
    const isTest = /\.(?:spec|test)\.[a-z]+$/iu.test(fileDiff.file)

    // 1. Sensitive file modification check
    if (SENSITIVE_FILES.some(pattern => pattern.test(fileDiff.file))) {
      findings.push({
        file: fileDiff.file,
        rule: 'security:sensitive-file-tampering',
        category: 'security',
        severity: 'critical',
        message: `修改了敏感系统控制或凭据文件 (${fileDiff.file})，需强制确认授权`,
        suggestion: '确认本次修改是否在任务授权范围内，避免意外改动治理真源',
      })
    }

    // 2. Line-by-line checks on added lines
    for (const line of fileDiff.lines) {
      // Secret leak check
      for (const secretRule of SECRET_PATTERNS) {
        if (secretRule.pattern.test(line.content)) {
          findings.push({
            file: fileDiff.file,
            line: line.lineNum,
            rule: secretRule.rule,
            category: 'security',
            severity: 'critical',
            message: secretRule.message,
            suggestion: '立即清除硬编码凭据，改用环境变量读取',
          })
        }
      }

      // Debug leak check (non-test files only)
      if (!isTest) {
        for (const debugRule of DEBUG_PATTERNS) {
          if (debugRule.pattern.test(line.content)) {
            findings.push({
              file: fileDiff.file,
              line: line.lineNum,
              rule: debugRule.rule,
              category: 'smell',
              severity: 'warning',
              message: debugRule.message,
              suggestion: '在交付前移除调试打印，或转用结构化日志服务',
            })
          }
        }
      }

      // Ponytail checks (speculative debt or empty abstractions)
      if (options.strictPonytail && !isTest) {
        if (/TODO|FIXME|XXX/iu.test(line.content)) {
          findings.push({
            file: fileDiff.file,
            line: line.lineNum,
            rule: 'ponytail:unfinished-stub',
            category: 'ponytail',
            severity: 'info',
            message: '发现 TODO / FIXME 占位符代码，请确认是否留下了未交付的半成品',
            suggestion: '若属于故意延后项，请记录到项目债务账本；否则应一次性交付闭环',
          })
        }
      }
    }
  }

  return findings
}

export async function auditCode(
  subprocess: SubprocessRuntime,
  input: AuditInput = {},
  signal?: AbortSignal,
): Promise<AuditResult> {
  const target = input.targetPath ?? '.'
  const cwd = isAbsolute(target) ? target : resolve(process.cwd(), target)

  // Check repo
  const isRepo = await runGit(subprocess, ['rev-parse', '--is-inside-work-tree'], cwd, signal)
  if (isRepo.exitCode !== 0 || isRepo.stdout.trim() !== 'true') {
    return {
      ok: true,
      passed: true,
      riskLevel: 'clean',
      summary: '指定目录不是 Git 仓库，跳过版本差异审计',
      findings: [],
      stats: { filesChanged: 0, additions: 0, deletions: 0, staticFindingsCount: 0 },
    }
  }

  // Determine diff command args
  const diffArgs = input.diffBase
    ? ['diff', input.diffBase]
    : ['diff', 'HEAD']

  let diffRun = await runGit(subprocess, diffArgs, cwd, signal)
  if (diffRun.stdout.trim() === '') {
    // Fallback to diff against staged or working tree
    diffRun = await runGit(subprocess, ['diff'], cwd, signal)
  }

  const fileDiffs = parseDiff(diffRun.stdout)
  let totalAdditions = 0
  let totalDeletions = 0
  for (const diff of fileDiffs) {
    totalAdditions += diff.additions
    totalDeletions += diff.deletions
  }

  const findings = auditStatic(fileDiffs, { strictPonytail: input.strictPonytail ?? true })

  // Calculate risk level
  const hasCritical = findings.some(f => f.severity === 'critical')
  const hasError = findings.some(f => f.severity === 'error')
  const hasWarning = findings.some(f => f.severity === 'warning')

  let riskLevel: 'clean' | 'low' | 'medium' | 'high' | 'critical' = 'clean'
  if (hasCritical) {
    riskLevel = 'critical'
  } else if (hasError) {
    riskLevel = 'high'
  } else if (hasWarning) {
    riskLevel = 'medium'
  } else if (findings.length > 0) {
    riskLevel = 'low'
  }

  const passed = !hasCritical && !hasError

  let summary = '变更审计通过，未发现风险项'
  if (hasCritical) {
    const count = findings.filter(f => f.severity === 'critical').length
    summary = `审计拦截：发现 ${count} 项严重安全或越权隐患！`
  } else if (hasError) {
    const count = findings.filter(f => f.severity === 'error').length
    summary = `审计不通过：发现 ${count} 项阻塞性错误`
  } else if (hasWarning) {
    const count = findings.filter(f => f.severity === 'warning').length
    summary = `审计通过但存在警告：发现 ${count} 项代码异味，建议优化`
  } else if (fileDiffs.length === 0) {
    summary = '工作区无未提交的变更，状态干净'
  }

  return {
    ok: true,
    passed,
    riskLevel,
    summary,
    findings,
    stats: {
      filesChanged: fileDiffs.length,
      additions: totalAdditions,
      deletions: totalDeletions,
      staticFindingsCount: findings.length,
    },
  }
}
