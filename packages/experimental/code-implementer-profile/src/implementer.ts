/**
 * Core implementation engine for dedicated code modifications.
 * Executes atomic and verified edits within declared write bounds.
 *
 * @module @deepseek-ai/dsh-experimental-code-implementer-profile/implementer
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

export interface FileEdit {
  readonly path: string
  readonly oldString?: string
  readonly newString: string
  readonly replaceAll?: boolean
}

export interface ImplementInput {
  readonly cwd?: string | undefined
  readonly writePaths?: readonly string[] | undefined
  readonly edits: readonly FileEdit[]
  readonly dryRun?: boolean | undefined
}

export interface FileChangeRecord {
  readonly path: string
  readonly additions: number
  readonly deletions: number
  readonly status: 'modified' | 'created'
}

export interface ImplementResult {
  readonly ok: boolean
  readonly changedFiles: readonly string[]
  readonly records: readonly FileChangeRecord[]
  readonly stats: {
    readonly totalAdditions: number
    readonly totalDeletions: number
  }
  readonly error?: string
}

const SENSITIVE_PATTERNS = [
  /router\.toml$/iu,
  /coordination-toggle\.json$/iu,
  /\.env(?:\.[a-z0-9_-]+)?$/iu,
  /credentials(?:\.json)?$/iu,
]

function isInsideOrEqual(parent: string, child: string): boolean {
  const normParent = resolve(parent)
  const normChild = resolve(child)
  if (normParent === normChild) return true
  const rel = relative(normParent, normChild)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function countLines(str: string): number {
  return str.split(/\r?\n/u).length
}

export async function executeCodeImplementation(
  input: ImplementInput,
  signal?: AbortSignal,
): Promise<ImplementResult> {
  await Promise.resolve()
  if (signal?.aborted) {
    throw new Error('implementation-aborted')
  }

  const cwd = input.cwd ? resolve(input.cwd) : process.cwd()
  const writePaths = (input.writePaths ?? []).map(p => resolve(cwd, p))
  const edits = input.edits

  if (edits.length === 0) {
    return {
      ok: true,
      changedFiles: [],
      records: [],
      stats: { totalAdditions: 0, totalDeletions: 0 },
    }
  }

  const records: FileChangeRecord[] = []
  const stagedWrites: Array<{ targetPath: string; content: string; record: FileChangeRecord }> = []

  for (const edit of edits) {
    if (signal?.aborted) throw new Error('implementation-aborted')
    const targetPath = resolve(cwd, edit.path)

    // 1. Check sensitive file boundary
    if (SENSITIVE_PATTERNS.some(p => p.test(targetPath))) {
      throw new Error(`sensitive-file-protected:${edit.path}`)
    }

    // 2. Check authorized write paths boundary
    if (writePaths.length > 0) {
      const isAllowed = writePaths.some(allowed => isInsideOrEqual(allowed, targetPath))
      if (!isAllowed) {
        throw new Error(`write-path-outside-scope:${edit.path}`)
      }
    }

    const fileExists = existsSync(targetPath)
    if (!fileExists) {
      if (edit.oldString !== undefined) {
        throw new Error(`file-not-found:${edit.path}`)
      }
      const additions = countLines(edit.newString)
      const record: FileChangeRecord = {
        path: edit.path,
        additions,
        deletions: 0,
        status: 'created',
      }
      records.push(record)
      stagedWrites.push({ targetPath, content: edit.newString, record })
      continue
    }

    const currentContent = readFileSync(targetPath, 'utf8')
    if (edit.oldString === undefined) {
      // Direct overwrite
      const deletions = countLines(currentContent)
      const additions = countLines(edit.newString)
      const record: FileChangeRecord = {
        path: edit.path,
        additions,
        deletions,
        status: 'modified',
      }
      records.push(record)
      stagedWrites.push({ targetPath, content: edit.newString, record })
      continue
    }

    // Targeted string replacement
    if (!currentContent.includes(edit.oldString)) {
      throw new Error(`old-string-not-found:${edit.path}`)
    }

    if (!edit.replaceAll && currentContent.indexOf(edit.oldString) !== currentContent.lastIndexOf(edit.oldString)) {
      throw new Error(`old-string-ambiguous:${edit.path}`)
    }

    const updatedContent = edit.replaceAll
      ? currentContent.replaceAll(edit.oldString, edit.newString)
      : currentContent.replace(edit.oldString, edit.newString)

    const deletions = countLines(edit.oldString)
    const additions = countLines(edit.newString)
    const record: FileChangeRecord = {
      path: edit.path,
      additions,
      deletions,
      status: 'modified',
    }
    records.push(record)
    stagedWrites.push({ targetPath, content: updatedContent, record })
  }

  // Apply writes if not dry run
  if (!input.dryRun) {
    for (const staged of stagedWrites) {
      writeFileSync(staged.targetPath, staged.content, 'utf8')
    }
  }

  const totalAdditions = records.reduce((acc, r) => acc + r.additions, 0)
  const totalDeletions = records.reduce((acc, r) => acc + r.deletions, 0)

  return {
    ok: true,
    changedFiles: records.map(r => r.path),
    records,
    stats: {
      totalAdditions,
      totalDeletions,
    },
  }
}
