import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { performIndependentReview } from '../src/reviewer.ts'
import { apply } from '../src/module.ts'

function mockSubprocess(outputByArg: Record<string, string>): SubprocessRuntime {
  return {
    spawn: vi.fn(({ argv }: { argv: readonly string[] }) => {
      const matchedKey = Object.keys(outputByArg).find(key => argv.includes(key))
      const text = matchedKey ? outputByArg[matchedKey] ?? '' : ''
      return {
        terminate: vi.fn(),
        collected: {
          stdout: { readFrom: () => ({ text, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
        done: Promise.resolve({ exitCode: 0, signal: null }),
      } as never
    }),
  } as unknown as SubprocessRuntime
}

describe('independent-review dedicated module', () => {
  it('approves a clean workspace with no changes', async () => {
    const subprocess = mockSubprocess({
      diff: '',
      status: '',
    })

    const result = await performIndependentReview(subprocess, {})
    expect(result.ok).toBe(true)
    expect(result.verdict).toBe('approved')
    expect(result.score).toBe(100)
    expect(result.findings.length).toBe(0)
    expect(result.stats.filesAnalyzed).toBe(0)
  })

  it('detects missing test coverage when source code is changed without companion tests', async () => {
    const subprocess = mockSubprocess({
      diff: 'diff --git a/src/math.ts b/src/math.ts\n+++ b/src/math.ts\n+export function add(a: number, b: number) { return a + b; }',
      status: ' M src/math.ts',
    })

    const result = await performIndependentReview(subprocess, { requireTests: true })
    expect(result.ok).toBe(true)
    expect(result.verdict).toBe('commented')
    expect(result.stats.filesAnalyzed).toBe(1)
    expect(result.findings.some(f => f.aspect === 'test_coverage')).toBe(true)
  })

  it('registers independent-review into moduleScheduler and executes properly', async () => {
    let definition: ModuleDefinition | undefined
    const unregister = vi.fn()
    const subprocess = mockSubprocess({
      diff: '',
      status: '',
    })

    apply({
      subprocess,
      moduleScheduler: {
        registry: {
          register: (val: ModuleDefinition) => {
            definition = val
            return 'independent-review@1.0.0'
          },
          unregister,
        },
      },
      effect: (fn: () => () => void) => fn(),
    } as unknown as Context)

    expect(definition).toBeDefined()
    expect(definition?.displayName).toContain('独立代码与架构审查器')

    const execContext: ModuleExecutionContext = {
      sessionId: 'session-review',
      taskId: 'task-review',
      runId: 'run-review',
      tools: new Map(),
      input: {},
      signal: new AbortController().signal,
    }

    const output = await definition!.execute(execContext) as { ok: boolean; verdict: string; score: number }
    expect(output.ok).toBe(true)
    expect(output.verdict).toBe('approved')
    expect(output.score).toBe(100)
  })
})
