import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { describe, expect, it } from 'vitest'
import { executeCodeImplementation, normalizeWorkspacePath } from '../src/implementer.ts'
import { apply } from '../src/module.ts'

describe('code-implementer dedicated module', () => {
  it('applies targeted string replacement within authorized write boundary', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'dsh-implement-test-'))
    const testFile = join(tempDir, 'sample.ts')
    writeFileSync(testFile, 'export function add(a: number, b: number) { return a - b; }\n', 'utf8')

    try {
      const result = await executeCodeImplementation({
        cwd: tempDir,
        writePaths: ['sample.ts'],
        edits: [
          {
            path: 'sample.ts',
            oldString: 'return a - b;',
            newString: 'return a + b;',
          },
        ],
      })

      expect(result.ok).toBe(true)
      expect(result.changedFiles).toEqual(['sample.ts'])
      expect(result.records[0]?.status).toBe('modified')

      const updated = readFileSync(testFile, 'utf8')
      expect(updated).toContain('return a + b;')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('rejects writes outside authorized write scope', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'dsh-implement-test-'))
    try {
      await expect(executeCodeImplementation({
        cwd: tempDir,
        writePaths: ['src/allowed.ts'],
        edits: [
          {
            path: 'src/forbidden.ts',
            newString: 'console.log("bad")',
          },
        ],
      })).rejects.toThrow('write-path-outside-scope:src/forbidden.ts')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('normalizes workspace path with uppercase drive letter on Windows', () => {
    const norm = normalizeWorkspacePath('c:\\users\\test')
    expect(norm).toBe('C:\\users\\test')
  })

  it('rejects tampering with sensitive credential and configuration files', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'dsh-implement-test-'))
    try {
      await expect(executeCodeImplementation({
        cwd: tempDir,
        writePaths: ['.env'],
        edits: [
          {
            path: '.env',
            newString: 'SECRET=123',
          },
        ],
      })).rejects.toThrow('sensitive-file-protected:.env')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('registers into moduleScheduler and executes through module definition contract', async () => {
    let registeredDef: ModuleDefinition | undefined
    const unregister = () => {}

    apply({
      moduleScheduler: {
        registry: {
          register: (def: ModuleDefinition) => {
            registeredDef = def
            return 'code-implementer@1.0.0'
          },
          unregister,
        },
      },
      effect: (fn: () => () => void) => fn(),
    } as unknown as Context)

    expect(registeredDef).toBeDefined()
    expect(registeredDef?.displayName).toContain('代码实现与修补器')

    const tempDir = mkdtempSync(join(tmpdir(), 'dsh-implement-test-'))
    try {
      const execContext: ModuleExecutionContext = {
        sessionId: 'session-impl',
        taskId: 'task-impl',
        runId: 'run-impl',
        tools: new Map(),
        input: {
          cwd: tempDir,
          writePaths: ['newfile.ts'],
          edits: [
            {
              path: 'newfile.ts',
              newString: 'export const PI = 3.14;',
            },
          ],
        },
        signal: new AbortController().signal,
      }

      const res = await registeredDef!.execute(execContext) as { ok: boolean; changedFiles: string[] }
      expect(res.ok).toBe(true)
      expect(res.changedFiles).toEqual(['newfile.ts'])

      const content = readFileSync(join(tempDir, 'newfile.ts'), 'utf8')
      expect(content).toBe('export const PI = 3.14;')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
