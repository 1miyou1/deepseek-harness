import { describe, expect, it } from 'vitest'
import {
  ModuleCoordinator,
  PathLockManager,
  pathsOverlap,
  type ModulePolicy,
  type ModuleSchema,
} from '../src/index.ts'

const dummySchema: ModuleSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
}

const dummyPolicy: ModulePolicy = {
  maxConcurrent: 4,
  queueLimit: 10,
  timeoutMs: 3000,
}

describe('workspace path-scoped locking', () => {
  it('detects direct matches and hierarchical directory overlaps', () => {
    // Exact match
    expect(pathsOverlap('C:/src/app.ts', 'C:/src/app.ts')).toBe(true)

    // Sub-path inside directory
    expect(pathsOverlap('C:/src', 'C:/src/components/Button.tsx')).toBe(true)
    expect(pathsOverlap('C:/src/components/Button.tsx', 'C:/src')).toBe(true)

    // Siblings do not overlap
    expect(pathsOverlap('C:/src/a.ts', 'C:/src/b.ts')).toBe(false)
    expect(pathsOverlap('C:/src/components', 'C:/src/utils')).toBe(false)
  })

  it('manages lock acquisitions and releases by owner', () => {
    const manager = new PathLockManager()

    const release1 = manager.acquire(['C:/repo/src/index.ts'], 'run-1')
    expect(release1).toBeTypeOf('function')
    expect(manager.isLocked(['C:/repo/src/index.ts'])).toBe(true)

    // Same owner can check or re-acquire without conflict
    expect(manager.isLocked(['C:/repo/src/index.ts'], 'run-1')).toBe(false)

    // Different owner blocked on overlapping directory
    const release2 = manager.acquire(['C:/repo/src'], 'run-2')
    expect(release2).toBeNull()

    // Non-overlapping path acquired successfully by run-2
    const release3 = manager.acquire(['C:/repo/docs/readme.md'], 'run-2')
    expect(release3).toBeTypeOf('function')

    // Release run-1
    release1!()
    expect(manager.isLocked(['C:/repo/src/index.ts'])).toBe(false)

    // Now run-2 can acquire C:/repo/src
    const release4 = manager.acquire(['C:/repo/src'], 'run-2')
    expect(release4).toBeTypeOf('function')

    release3!()
    release4!()
  })

  it('queues concurrent module runs with overlapping writePaths until predecessor finishes', async () => {
    const coordinator = new ModuleCoordinator({ maxConcurrent: 4, queueLimit: 10 })

    let releaseA!: () => void
    const gateA = new Promise<void>((resolve) => { releaseA = resolve })
    const executionOrder: string[] = []

    // Run A: writes C:/project/src/file.ts, holds execution until gateA resolves
    const handleA = coordinator.run(
      {
        sessionId: 's1',
        taskId: 't1',
        moduleRef: 'writer@1.0.0',
        workspace: { writePaths: ['C:/project/src/file.ts'] },
      },
      dummyPolicy,
      dummySchema,
      async () => {
        executionOrder.push('A-started')
        await gateA
        executionOrder.push('A-finished')
        return { ok: true }
      },
    )

    // Give run A a microtask turn to start and acquire lock
    await new Promise(r => setTimeout(r, 10))

    // Run B: writes overlapping directory C:/project/src
    // Must be queued because run A holds lock on C:/project/src/file.ts!
    const handleB = coordinator.run(
      {
        sessionId: 's1',
        taskId: 't2',
        moduleRef: 'writer@1.0.0',
        workspace: { writePaths: ['C:/project/src'] },
      },
      dummyPolicy,
      dummySchema,
      async () => {
        executionOrder.push('B-started')
        return { ok: true }
      },
    )

    await new Promise(r => setTimeout(r, 10))
    expect(executionOrder).toEqual(['A-started'])

    // Now let Run A finish
    releaseA()
    await handleA

    // Run B should now automatically drain from queue, acquire lock, and finish!
    await handleB
    expect(executionOrder).toEqual(['A-started', 'A-finished', 'B-started'])

    coordinator.dispose()
  })
})
