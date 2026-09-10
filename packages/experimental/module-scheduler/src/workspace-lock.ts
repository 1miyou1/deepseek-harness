/**
 * Path-scoped lock manager and workspace validation for writable modules.
 *
 * @module @deepseek-ai/dsh-experimental-module-scheduler/workspace-lock
 */

import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Checks if target path is inside base path or equal to base path.
 */
export function isInsideOrEqual(base: string, target: string): boolean {
  const rel = relative(resolve(base), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Checks if two filesystem paths overlap (identical or ancestor/descendant).
 */
export function pathsOverlap(pathA: string, pathB: string): boolean {
  const a = resolve(pathA)
  const b = resolve(pathB)
  return a === b || isInsideOrEqual(a, b) || isInsideOrEqual(b, a)
}

export interface PathLockAcquisition {
  readonly owner: string
  readonly paths: readonly string[]
  release: () => void
}

/**
 * Manages path-scoped mutual exclusion locks across concurrent module runs.
 */
export class PathLockManager {
  private readonly locks = new Map<string, string[]>()

  /**
   * Attempts to acquire exclusive locks on the given paths for owner (runId).
   * @param paths - Normalized absolute paths to lock.
   * @param owner - Unique runId or holder identity.
   * @returns Release callback if acquired; null if any path is currently locked by another owner.
   */
  acquire(paths: readonly string[], owner: string): (() => void) | null {
    if (paths.length === 0) return () => {}

    const normalized = paths.map(p => resolve(p))

    // Check for collision with any existing owner
    for (const [lockedOwner, lockedPaths] of this.locks) {
      if (lockedOwner === owner) continue
      for (const reqPath of normalized) {
        if (lockedPaths.some(locked => pathsOverlap(reqPath, locked))) {
          return null
        }
      }
    }

    const currentOwned = this.locks.get(owner) ?? []
    this.locks.set(owner, [...currentOwned, ...normalized])

    let released = false
    return () => {
      if (released) return
      released = true
      this.locks.delete(owner)
    }
  }

  /**
   * Checks if any of the given paths are currently locked by any other owner.
   */
  isLocked(paths: readonly string[], excludeOwner?: string): boolean {
    const normalized = paths.map(p => resolve(p))
    for (const [lockedOwner, lockedPaths] of this.locks) {
      if (excludeOwner !== undefined && lockedOwner === excludeOwner) continue
      for (const reqPath of normalized) {
        if (lockedPaths.some(locked => pathsOverlap(reqPath, locked))) {
          return true
        }
      }
    }
    return false
  }

  /**
   * Clears all locks (e.g. on coordinator disposal).
   */
  clear(): void {
    this.locks.clear()
  }
}
