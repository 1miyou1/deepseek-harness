import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ManagedModuleAgent, ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocumentOrganizerDefinition } from '../src/document-organizer.ts'
import { apply } from '../src/document-organizer-tools.ts'

const roots: string[] = []
const archivedNote = ['.agents', 'notes', 'archived', 'a.md'].join('/')
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-document-organizer-'))
  roots.push(root)
  mkdirSync(join(root, 'content'), { recursive: true })
  writeFileSync(join(root, 'content/a.md'), '# A\n')
  return root
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function context(input: unknown, agent: ManagedModuleAgent): ModuleExecutionContext {
  return {
    sessionId: 's', taskId: 't', runId: 'r', input, agent, tools: new Map(),
    signal: new AbortController().signal,
  }
}
function plan(overrides: Record<string, unknown> = {}) {
  return { summary: '整理完成', writes: [], creates: [], moves: [], ...overrides }
}

describe('document organizer module', () => {
  it('uses Luna and applies compare-before-write updates', async () => {
    const root = workspace()
    const run = vi.fn().mockResolvedValue(plan({
      writes: [{ path: 'content/a.md', expectedContent: '# A\n', content: '# A\n\n整理后。\n' }],
    }))
    const definition = createDocumentOrganizerDefinition(root, { runChecks: async () => [{ name: 'docs', ok: true }] })

    const result = await definition.execute(context({ files: ['content/a.md'], task: '整理文档' }, { run }))

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ modelTier: 'luna' }))
    expect(readFileSync(join(root, 'content/a.md'), 'utf8')).toBe('# A\n\n整理后。\n')
    expect(result).toMatchObject({ ok: true, route: 'luna', fallback: false, changedFiles: ['content/a.md'] })
  })

  it('falls back once to Terra only for a managed model error and never requests Sol', async () => {
    const root = workspace()
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('managed-agent-error'))
      .mockResolvedValueOnce(plan())
    const definition = createDocumentOrganizerDefinition(root, { runChecks: async () => [] })

    const result = await definition.execute(context({ files: ['content/a.md'], task: '分类' }, { run }))

    const tiers = run.mock.calls.map(([request]) => (request as { modelTier?: string }).modelTier)
    expect(tiers).toEqual(['luna', 'terra'])
    expect(tiers).not.toContain('sol')
    expect(result).toMatchObject({ ok: true, route: 'terra', fallback: true })
  })

  it('still falls back to Terra when the managed model error carries a diagnostic suffix', async () => {
    const root = workspace()
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('managed-agent-error; diagnostic: managed-agent-runtime-incompatible'))
      .mockResolvedValueOnce(plan())
    const definition = createDocumentOrganizerDefinition(root, { runChecks: async () => [] })

    const result = await definition.execute(context({ files: ['content/a.md'], task: '分类' }, { run }))

    const tiers = run.mock.calls.map(([request]) => (request as { modelTier?: string }).modelTier)
    expect(tiers).toEqual(['luna', 'terra'])
    expect(result).toMatchObject({ ok: true, route: 'terra', fallback: true })
  })

  it('does not fall back for invalid structured output or cancellation', async () => {
    const root = workspace()
    const invalid = vi.fn().mockResolvedValue({ summary: 'missing operations' })
    const cancelled = vi.fn().mockRejectedValue(new Error('managed-agent-aborted'))
    const definition = createDocumentOrganizerDefinition(root, { runChecks: async () => [] })

    await expect(definition.execute(context({ files: ['content/a.md'], task: '分类' }, { run: invalid })))
      .rejects.toThrow('document-plan-invalid')
    await expect(definition.execute(context({ files: ['content/a.md'], task: '分类' }, { run: cancelled })))
      .rejects.toThrow('managed-agent-aborted')
    expect(invalid).toHaveBeenCalledTimes(1)
    expect(cancelled).toHaveBeenCalledTimes(1)
  })

  it('enforces input and plan byte limits before changing files', async () => {
    const root = workspace()
    const agent = { run: vi.fn().mockResolvedValue(plan()) }
    const tinyInput = createDocumentOrganizerDefinition(root, { runChecks: async () => [] }, { maxInputBytes: 1 })
    const tinyPlan = createDocumentOrganizerDefinition(root, { runChecks: async () => [] }, { maxPlanBytes: 1 })

    await expect(tinyInput.execute(context({ files: ['content/a.md'], task: '分类' }, agent)))
      .rejects.toThrow('document-input-too-large')
    await expect(tinyPlan.execute(context({ files: ['content/a.md'], task: '分类' }, agent)))
      .rejects.toThrow('document-plan-invalid')
    expect(readFileSync(join(root, 'content/a.md'), 'utf8')).toBe('# A\n')
  })

  it('bounds the complete structured result', async () => {
    const root = workspace()
    const run = vi.fn().mockResolvedValue(plan({ summary: '你'.repeat(2_000) }))
    const definition = createDocumentOrganizerDefinition(
      root, { runChecks: async () => [{ name: 'docs', ok: true, output: 'x'.repeat(2_000) }] }, { maxOutputBytes: 2_048 },
    )

    const result = await definition.execute(context({ files: ['content/a.md'], task: '分类' }, { run }))

    expect(result).toMatchObject({ ok: true, outputTruncated: true })
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(2_048)
  })

  it('creates and moves only explicitly declared document paths', async () => {
    const root = workspace()
    const run = vi.fn().mockResolvedValue(plan({
      creates: [{ path: 'content/new.md', content: '# New\n' }],
      moves: [{ from: 'content/a.md', to: 'content/moved.md', expectedContent: '# A\n' }],
    }))
    const definition = createDocumentOrganizerDefinition(root, { runChecks: async () => [] })

    const result = await definition.execute(context({
      files: ['content/a.md', 'content/moved.md', 'content/new.md'], task: '重组文档',
    }, { run }))

    expect(() => readFileSync(join(root, 'content/a.md'))).toThrow()
    expect(readFileSync(join(root, 'content/moved.md'), 'utf8')).toBe('# A\n')
    expect(readFileSync(join(root, 'content/new.md'), 'utf8')).toBe('# New\n')
    expect(result).toMatchObject({ ok: true, changedFiles: ['content/a.md', 'content/moved.md', 'content/new.md'] })
  })

  it('rejects traversal, archived notes, symlinks, and undeclared operations', async () => {
    const root = workspace()
    const definition = createDocumentOrganizerDefinition(root, { runChecks: async () => [] })
    const agent = { run: vi.fn().mockResolvedValue(plan({ creates: [{ path: 'content/new.md', content: '# New\n' }] })) }

    await expect(definition.execute(context({ files: ['../a.md'], task: '整理' }, agent))).rejects.toThrow('document-path-invalid')
    await expect(definition.execute(context({ files: [archivedNote], task: '整理' }, agent))).rejects.toThrow('document-path-forbidden')
    await expect(definition.execute(context({ files: ['.AGENTS/NOTES/ARCHIVED/a.md'], task: '整理' }, agent))).rejects.toThrow('document-path-forbidden')
    await expect(definition.execute(context({ files: ['content/a.md'], task: '整理' }, agent))).rejects.toThrow('document-plan-path-undeclared')
  })

  it('rolls back every file when a focused check fails', async () => {
    const root = workspace()
    const run = vi.fn().mockResolvedValue(plan({
      writes: [{ path: 'content/a.md', expectedContent: '# A\n', content: '# Changed\n' }],
      creates: [{ path: 'content/new.md', content: '# New\n' }],
    }))
    const definition = createDocumentOrganizerDefinition(root, {
      runChecks: async () => [{ name: 'translation-pairing', ok: false, output: 'failed' }],
    })

    await expect(definition.execute(context({ files: ['content/a.md', 'content/new.md'], task: '整理' }, { run })))
      .rejects.toThrow('document-check-failed')
    expect(readFileSync(join(root, 'content/a.md'), 'utf8')).toBe('# A\n')
    expect(() => readFileSync(join(root, 'content/new.md'))).toThrow()
  })

  it('rejects stale source content without changing files', async () => {
    const root = workspace()
    const run = vi.fn().mockResolvedValue(plan({
      writes: [{ path: 'content/a.md', expectedContent: 'stale', content: '# Changed\n' }],
    }))
    const definition = createDocumentOrganizerDefinition(root, { runChecks: async () => [] })

    await expect(definition.execute(context({ files: ['content/a.md'], task: '整理' }, { run })))
      .rejects.toThrow('document-file-changed')
    expect(readFileSync(join(root, 'content/a.md'), 'utf8')).toBe('# A\n')
  })

  it('registers fixed managed checks and releases the module', async () => {
    const definitions: ModuleDefinition[] = []
    const unregister = vi.fn()
    let cleanup: (() => void) | undefined
    const spawned: string[][] = []
    apply({
      moduleScheduler: { registry: {
        register: (definition: ModuleDefinition) => { definitions.push(definition); return 'document-organizer@1.0.0' },
        unregister,
      } },
      sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv] }) },
      subprocess: { spawn: ({ argv }: { argv: readonly string[] }) => {
        spawned.push([...argv])
        return {
          collected: { stdout: { readFrom: () => ({ text: 'ok' }) }, stderr: { readFrom: () => ({ text: '' }) } },
          done: Promise.resolve({ exitCode: 0 }),
        }
      } },
      effect: (setup: () => () => void) => { cleanup = setup() },
    } as unknown as Context, {
      maxFiles: 20, maxInputBytes: 200_000, maxPlanBytes: 500_000, maxSteps: 8,
      maxTokensPerStep: 8_192, totalTimeoutMs: 180_000, maxOutputBytes: 65_536, graceMs: 1_000,
    })
    const root = process.cwd()
    const definition = definitions[0]
    if (definition === undefined) throw new Error('missing organizer definition')
    const result = await definition.execute(context({ files: ['AGENTS.md'], task: '分类' }, {
      run: vi.fn().mockResolvedValue(plan()),
    }))

    expect(result).toMatchObject({ ok: true, route: 'luna' })
    expect(spawned.map(argv => argv.at(-1))).toEqual([
      join(root, 'scripts/verify-agent-note-format.ts'),
      join(root, 'scripts/verify-translation-pairing.ts'),
      join(root, 'scripts/verify-md-links.ts'),
    ])
    if (cleanup === undefined) throw new Error('missing organizer cleanup')
    cleanup()
    expect(unregister).toHaveBeenCalledWith('document-organizer@1.0.0')
  })
})
