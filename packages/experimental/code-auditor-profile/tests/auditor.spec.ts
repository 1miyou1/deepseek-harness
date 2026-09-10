import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { auditCode, auditStatic, parseDiff } from '../src/auditor.ts'
import { apply } from '../src/module.ts'

function mockSubprocess(outputByArg: Record<string, string>): SubprocessRuntime {
  return {
    spawn: vi.fn(({ argv }: { argv: readonly string[] }) => {
      const matchedKey = Object.keys(outputByArg).find(key => argv.includes(key))
      const text = matchedKey ? outputByArg[matchedKey] ?? '' : ''
      const exitCode = text === 'error' ? 1 : 0
      return {
        terminate: vi.fn(),
        collected: {
          stdout: { readFrom: () => ({ text, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
        done: Promise.resolve({ exitCode, signal: null }),
      } as never
    }),
  } as unknown as SubprocessRuntime
}

describe('code-auditor profile', () => {
  it('registers the code-auditor module and executes auditCode on clean repo', async () => {
    let definition: ModuleDefinition | undefined
    let cleanup: (() => void) | undefined
    const unregister = vi.fn()
    const subprocess = mockSubprocess({
      '--is-inside-work-tree': 'true',
      'diff': '',
    })

    apply({
      subprocess,
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definition = value; return 'code-auditor@1.0.0' }, unregister } },
      effect: (setup: () => () => void) => { cleanup = setup() },
    } as unknown as Context)

    expect(definition).toMatchObject({
      id: 'code-auditor',
      version: '1.0.0',
      displayName: '代码与变更审计器',
    })

    const executionContext: ModuleExecutionContext = {
      sessionId: 'session-audit',
      taskId: 'task-audit',
      runId: 'run-audit',
      tools: new Map(),
      input: { targetPath: process.cwd() },
      signal: new AbortController().signal,
    }

    const result = await definition!.execute(executionContext)
    expect(result).toMatchObject({
      ok: true,
      passed: true,
      riskLevel: 'clean',
      findings: [],
    })
    cleanup!()
    expect(unregister).toHaveBeenCalledWith('code-auditor@1.0.0')
  })

  it('detects sensitive file modifications and secret leaks', () => {
    const rawDiff = [
      'diff --git a/config/router.toml b/config/router.toml',
      '--- a/config/router.toml',
      '+++ b/config/router.toml',
      '@@ -1,3 +1,4 @@',
      '+# modified router rules',
      '+sk-1234567890abcdef1234567890abcdef',
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -10,3 +10,4 @@',
      '+console.log("debugging line")',
      '+// TODO: finish this later',
    ].join('\n')

    const fileDiffs = parseDiff(rawDiff)
    expect(fileDiffs).toHaveLength(2)

    const findings = auditStatic(fileDiffs, { strictPonytail: true })
    expect(findings.length).toBeGreaterThanOrEqual(4)

    // Check sensitive file tampering
    const sensitiveFinding = findings.find(f => f.rule === 'security:sensitive-file-tampering')
    expect(sensitiveFinding).toBeDefined()
    expect(sensitiveFinding?.severity).toBe('critical')

    // Check secret leak
    const secretFinding = findings.find(f => f.rule === 'secret:openai-api-key')
    expect(secretFinding).toBeDefined()
    expect(secretFinding?.severity).toBe('critical')

    // Check console.log smell
    const logFinding = findings.find(f => f.rule === 'smell:console-log')
    expect(logFinding).toBeDefined()
    expect(logFinding?.severity).toBe('warning')

    // Check ponytail TODO
    const todoFinding = findings.find(f => f.rule === 'ponytail:unfinished-stub')
    expect(todoFinding).toBeDefined()
    expect(todoFinding?.severity).toBe('info')
  })

  it('marks audit as failed with critical risk level when secrets are present', async () => {
    const rawDiff = [
      'diff --git a/src/secret.ts b/src/secret.ts',
      '@@ -1,2 +1,3 @@',
      '+const token = "ghp_123456789012345678901234567890123456"',
    ].join('\n')

    const subprocess = mockSubprocess({
      '--is-inside-work-tree': 'true',
      'diff': rawDiff,
    })

    const result = await auditCode(subprocess, { targetPath: process.cwd() })
    expect(result.passed).toBe(false)
    expect(result.riskLevel).toBe('critical')
    expect(result.findings.some(f => f.rule === 'secret:github-token')).toBe(true)
  })
})
