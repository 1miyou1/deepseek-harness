/**
 * Core test execution and noise-reduction engine.
 * Strips ANSI escapes, parses structured test summaries, and extracts failure targets.
 *
 * @module @deepseek-ai/dsh-experimental-test-runner-profile/runner
 */

import { isAbsolute, relative, resolve } from 'node:path'

export interface TestFailureItem {
  readonly file: string
  readonly testName: string
  readonly error: string
  readonly line?: number | undefined
}

export interface TestRunInput {
  readonly cwd?: string | undefined
  readonly testPath?: string | undefined
  readonly timeoutMs?: number | undefined
}

export interface TestRunResult {
  readonly ok: boolean
  readonly total: number
  readonly passed: number
  readonly failed: number
  readonly durationMs: number
  readonly failures: readonly TestFailureItem[]
  readonly summary: string
  readonly rawSnippet?: string | undefined
}

export interface SubprocessRuntime {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: { stdin: 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
    graceMs: number
    signal: AbortSignal
  }): {
    collected: {
      stdout?: { readFrom(offset: number): { text: string } }
      stderr?: { readFrom(offset: number): { text: string } }
    }
    done: Promise<{ exitCode: number | null }>
  }
}

// Strip ANSI escape codes
const ANSI_REGEX = /\u001B\[[0-9;]*[a-zA-Z]/gu

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '')
}

export function parseVitestOutput(rawOutput: string, exitCode: number): TestRunResult {
  const clean = stripAnsi(rawOutput)

  // Matches "Test Files  X passed | Y failed (Z)" or "Tests  X passed (Y)"
  const testsMatch = clean.match(/Tests\s+([0-9]+)\s+passed.*?\(([0-9]+)\)/u)
  const failedMatch = clean.match(/Tests\s+([0-9]+)\s+failed\s+\|\s+([0-9]+)\s+passed\s+\(([0-9]+)\)/u)

  let total = 0
  let passed = 0
  let failed = 0

  if (failedMatch?.[1] && failedMatch[2] && failedMatch[3]) {
    failed = Number.parseInt(failedMatch[1], 10)
    passed = Number.parseInt(failedMatch[2], 10)
    total = Number.parseInt(failedMatch[3], 10)
  } else if (testsMatch?.[1] && testsMatch[2]) {
    passed = Number.parseInt(testsMatch[1], 10)
    total = Number.parseInt(testsMatch[2], 10)
    failed = total - passed
  } else if (exitCode === 0) {
    passed = 1
    total = 1
  } else {
    failed = 1
    total = 1
  }

  // Duration match "Duration  1.23s" or "Duration  764ms"
  const durationMatch = clean.match(/Duration\s+([0-9.]+)(ms|s)/u)
  let durationMs = 0
  if (durationMatch?.[1] && durationMatch[2]) {
    const val = Number.parseFloat(durationMatch[1])
    durationMs = durationMatch[2] === 's' ? Math.round(val * 1000) : Math.round(val)
  }

  // Parse failures
  const failures: TestFailureItem[] = []
  const failureBlocks = clean.split(/FAIL\s+/gu).slice(1)

  for (const block of failureBlocks) {
    const firstLine = block.split(/\r?\n/u)[0] ?? ''
    const parts = firstLine.split('>').map(p => p.trim())
    const filePart = parts[0]?.replace(/^\|[^|]+\|\s*/u, '') ?? 'unknown'
    const testName = parts.slice(1).join(' > ') || 'test'

    // Extract primary error line
    const errMatch = block.match(/(?:Error:|AssertionError:)\s*([^\r\n]+)/u)
    const errorMsg = errMatch?.[1]?.trim() ?? 'Test assertion failed'

    const lineMatch = block.match(/:([0-9]+):[0-9]+/u)
    const line = lineMatch?.[1] ? Number.parseInt(lineMatch[1], 10) : undefined

    failures.push({
      file: filePart,
      testName,
      error: errorMsg,
      ...(line !== undefined ? { line } : {}),
    })
  }

  const ok = exitCode === 0 && failed === 0
  const summary = ok
    ? `All ${passed} test(s) passed successfully in ${durationMs}ms.`
    : `${failed} test(s) failed out of ${total}. Primary failure: ${failures[0]?.error ?? 'Execution error'}.`

  return {
    ok,
    total,
    passed,
    failed,
    durationMs,
    failures,
    summary,
    rawSnippet: !ok ? clean.slice(0, 1000) : '',
  }
}

export async function runTests(
  subprocess: SubprocessRuntime,
  input: TestRunInput,
  signal?: AbortSignal,
): Promise<TestRunResult> {
  const cwd = input.cwd ? resolve(input.cwd) : process.cwd()
  const targetPath = input.testPath ?? 'tests'

  // Security check: cannot execute tests outside cwd
  if (input.testPath) {
    const full = resolve(cwd, input.testPath)
    const rel = relative(cwd, full)
    if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
      throw new Error('test-path-outside-workspace')
    }
  }

  const argv = [
    process.execPath,
    resolve(cwd, 'node_modules/vitest/vitest.mjs'),
    'run',
    targetPath,
    '--no-cache',
    '--pool',
    'threads',
    '--maxWorkers',
    '1',
  ]

  const handle = subprocess.spawn({
    argv,
    cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 50_000 }, stderr: { maxBytes: 50_000 } },
    graceMs: 1000,
    signal: signal ?? new AbortController().signal,
  })

  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  const fullOutput = `${stdout}\n${stderr}`

  return parseVitestOutput(fullOutput, outcome.exitCode ?? 1)
}
