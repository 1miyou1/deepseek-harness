import { describe, expect, it } from 'vitest'
import { evaluateQuickToolCall, parseQuickTask, type QuickTaskState } from '../src/policy.ts'

function state(overrides: Partial<QuickTaskState> = {}): QuickTaskState {
  return { active: true, allowedPaths: ['src/a.ts', 'src/lib'], checksRequired: true, implementAttempts: 0,
    leasedPaths: [], implemented: false, tested: false, escalated: false, ...overrides }
}

describe('quick task policy', () => {
  it('activates only for /quick and parses scope and checks', () => {
    expect(parseQuickTask(`/quick
允许范围：src/a.ts, src/lib
验收：none`)).toEqual({
      active: true, allowedPaths: ['src/a.ts', 'src/lib'], checksRequired: false,
    })
    expect(parseQuickTask('ordinary task').active).toBe(false)
  })
  it.each(['write', 'edit', 'pwsh'])('denies direct mutation through %s', (name) => {
    expect(evaluateQuickToolCall(state(), name, {}).allowed).toBe(false)
  })
  it('allows bounded code-implementer writes', () => {
    expect(evaluateQuickToolCall(state(), 'module_run', { moduleRef: 'code-implementer@1.0.0',
      input: { writePaths: ['src/a.ts', 'src/lib/b.ts'] } })).toEqual({ allowed: true })
  })
  it('denies undeclared paths, excess files, and excess repair attempts', () => {
    expect(evaluateQuickToolCall(state(), 'module_run', { moduleRef: 'code-implementer@1.0.0',
      input: { writePaths: ['test/a.ts'] } }).allowed).toBe(false)
    expect(evaluateQuickToolCall(state({ allowedPaths: ['packages/foo/src/a.ts'] }), 'module_run', {
      moduleRef: 'code-implementer@1.0.0', input: { cwd: 'packages/foo', writePaths: ['src/a.ts'] },
    }).allowed).toBe(true)
    expect(evaluateQuickToolCall(state({ allowedPaths: ['packages/foo/src/a.ts'] }), 'module_run', {
      moduleRef: 'code-implementer@1.0.0', input: { cwd: 'packages/bar', writePaths: ['src/a.ts'] },
    }).allowed).toBe(false)
    expect(evaluateQuickToolCall(state({ allowedPaths: ['packages/foo/src/a.ts'] }), 'module_run', {
      moduleRef: 'code-implementer@1.0.0', input: { cwd: 'packages/bar', writePaths: ['src/a.ts'] },
    }).allowed).toBe(false)
    expect(evaluateQuickToolCall(state(), 'module_run', { moduleRef: 'code-implementer@1.0.0',
      input: { writePaths: ['src/a.ts', 'src/lib/a.ts', 'src/lib/b.ts', 'src/lib/c.ts'] } }).allowed).toBe(false)
    expect(evaluateQuickToolCall(state({ implementAttempts: 2 }), 'module_run', { moduleRef: 'code-implementer@1.0.0',
      input: { writePaths: ['src/a.ts'] } }).allowed).toBe(false)
    expect(evaluateQuickToolCall(state({ leasedPaths: ['src/a.ts', 'src/lib/a.ts'] }), 'module_run', {
      moduleRef: 'code-implementer@1.0.0', input: { writePaths: ['src/lib/b.ts', 'src/lib/c.ts'] },
    }).allowed).toBe(false)
  })
  it('allows only the approved review pipeline and module allowlist', () => {
    expect(evaluateQuickToolCall(state(), 'pipeline_template_run', { templateRef: 'code-review-flow@1.0.0' }).allowed).toBe(true)
    expect(evaluateQuickToolCall(state(), 'pipeline_template_run', { templateRef: 'full-cycle-dev-flow@1.0.0' }).allowed).toBe(false)
    expect(evaluateQuickToolCall(state(), 'module_run', { moduleRef: 'document-organizer@1.0.0' }).allowed).toBe(false)
    expect(evaluateQuickToolCall(state(), 'module_run', { moduleRef: 'fast-vision@1.0.0' }).allowed).toBe(true)
  })
})
