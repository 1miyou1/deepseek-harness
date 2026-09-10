import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/module.ts'
import { parseVitestOutput, runTests, stripAnsi, type SubprocessRuntime } from '../src/runner.ts'

describe('test-runner dedicated module', () => {
  it('strips ANSI color and control characters cleanly', () => {
    const ansiText = '\u001B[31mFAIL\u001B[39m \u001B[2mtests/sample.spec.ts\u001B[22m'
    expect(stripAnsi(ansiText)).toBe('FAIL tests/sample.spec.ts')
  })

  it('parses successful vitest output into structured summary', () => {
    const rawSuccess = `
 Test Files  2 passed (2)
      Tests  10 passed (10)
   Duration  450ms
`
    const res = parseVitestOutput(rawSuccess, 0)
    expect(res.ok).toBe(true)
    expect(res.passed).toBe(10)
    expect(res.total).toBe(10)
    expect(res.failed).toBe(0)
    expect(res.durationMs).toBe(450)
    expect(res.failures.length).toBe(0)
    expect(res.summary).toContain('All 10 test(s) passed successfully')
  })

  it('extracts structured failure targets and error messages from failing vitest output', () => {
    const rawFail = `
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/experimental/sample/tests/sample.spec.ts > sample module > should add numbers correctly
AssertionError: expected 10 to be 20
  at packages/experimental/sample/tests/sample.spec.ts:42:15

 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
   Duration  1.25s
`
    const res = parseVitestOutput(rawFail, 1)
    expect(res.ok).toBe(false)
    expect(res.passed).toBe(9)
    expect(res.failed).toBe(1)
    expect(res.total).toBe(10)
    expect(res.durationMs).toBe(1250)
    expect(res.failures.length).toBe(1)
    expect(res.failures[0]?.file).toBe('packages/experimental/sample/tests/sample.spec.ts')
    expect(res.failures[0]?.testName).toContain('should add numbers correctly')
    expect(res.failures[0]?.error).toContain('expected 10 to be 20')
    expect(res.failures[0]?.line).toBe(42)
  })

  it('executes via mock SubprocessRuntime with boundary validation', async () => {
    const mockRuntime: SubprocessRuntime = {
      spawn: () => ({
        collected: {
          stdout: {
            readFrom: () => ({ text: 'Test Files 1 passed (1)\n Tests 4 passed (4)\n Duration 200ms' }),
          },
          stderr: {
            readFrom: () => ({ text: '' }),
          },
        },
        done: Promise.resolve({ exitCode: 0 }),
      }),
    }

    const res = await runTests(mockRuntime, { testPath: 'tests' })
    expect(res.ok).toBe(true)
    expect(res.passed).toBe(4)

    // Verify boundary rejection
    await expect(runTests(mockRuntime, { testPath: '../../outside' })).rejects.toThrow('test-path-outside-workspace')
  })

  it('registers into moduleScheduler as test-runner@1.0.0', () => {
    let registeredDef: ModuleDefinition | undefined
    apply({
      subprocess: {},
      moduleScheduler: {
        registry: {
          register: (def: ModuleDefinition) => {
            registeredDef = def
            return 'test-runner@1.0.0'
          },
          unregister: () => {},
        },
      },
      effect: (fn: () => () => void) => fn(),
    } as unknown as Context)

    expect(registeredDef).toBeDefined()
    expect(registeredDef?.displayName).toContain('测试执行与降噪诊断器')
  })
})
