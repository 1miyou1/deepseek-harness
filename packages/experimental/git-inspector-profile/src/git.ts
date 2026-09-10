/** Pure, read-only Git status inspector using DSH SubprocessRuntime. */

import { isAbsolute, resolve } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

export interface GitInspectionResult {
  ok: boolean
  isRepo: boolean
  branch?: string
  clean?: boolean
  ahead: number
  behind: number
  modified: string[]
  untracked: string[]
  recentCommits: Array<{ hash: string; message: string }>
  error?: string
}

export interface ParsedGitStatus {
  branch: string
  ahead: number
  behind: number
  modified: string[]
  untracked: string[]
}

const MAX_OUTPUT_BYTES = 16 * 1024

async function runGit(
  subprocess: SubprocessRuntime,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  const timeout = AbortSignal.timeout(10_000)
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
    const timedOut = timeout.aborted && (signal === undefined || !signal.aborted)
    return {
      exitCode: outcome.exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      timedOut,
    }
  } catch (err) {
    return {
      exitCode: -1,
      stdout: '',
      stderr: String(err),
      timedOut: false,
    }
  }
}

export function parseGitStatusShort(text: string): ParsedGitStatus {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
  let branch = ''
  let ahead = 0
  let behind = 0
  const modified: string[] = []
  const untracked: string[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      const header = line.slice(3).trim()
      const branchMatch = /^([^.\s]+(?:\/[^.\s]+)*)/u.exec(header)
      if (branchMatch) branch = branchMatch[1] ?? ''
      const aheadMatch = /ahead\s+(\d+)/u.exec(header)
      if (aheadMatch) ahead = Number.parseInt(aheadMatch[1] ?? '0', 10)
      const behindMatch = /behind\s+(\d+)/u.exec(header)
      if (behindMatch) behind = Number.parseInt(behindMatch[1] ?? '0', 10)
    } else if (line.startsWith('?? ')) {
      untracked.push(line.slice(3).trim())
    } else if (line.length >= 3) {
      modified.push(line.slice(3).trim())
    }
  }

  return { branch, ahead, behind, modified, untracked }
}

export function parseGitLog(text: string): Array<{ hash: string; message: string }> {
  return text
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map((line) => {
      const [hash = '', ...msgParts] = line.trim().split(' ')
      return { hash, message: msgParts.join(' ') }
    })
}

export async function inspectGit(
  subprocess: SubprocessRuntime,
  targetPath: string,
  signal?: AbortSignal,
): Promise<GitInspectionResult> {
  const cwd = isAbsolute(targetPath) ? targetPath : resolve(process.cwd(), targetPath)
  const isRepoCheck = await runGit(subprocess, ['rev-parse', '--is-inside-work-tree'], cwd, signal)
  if (isRepoCheck.exitCode !== 0 || isRepoCheck.stdout.trim() !== 'true') {
    return {
      ok: true,
      isRepo: false,
      ahead: 0,
      behind: 0,
      modified: [],
      untracked: [],
      recentCommits: [],
      error: 'not-a-git-repository',
    }
  }

  const [statusRes, logRes] = await Promise.all([
    runGit(subprocess, ['status', '--porcelain', '-b'], cwd, signal),
    runGit(subprocess, ['log', '-n', '5', '--oneline'], cwd, signal),
  ])

  const parsedStatus = parseGitStatusShort(statusRes.stdout)
  const recentCommits = parseGitLog(logRes.stdout)
  const clean = parsedStatus.modified.length === 0 && parsedStatus.untracked.length === 0

  return {
    ok: true,
    isRepo: true,
    branch: parsedStatus.branch,
    clean,
    ahead: parsedStatus.ahead,
    behind: parsedStatus.behind,
    modified: parsedStatus.modified,
    untracked: parsedStatus.untracked,
    recentCommits,
  }
}
