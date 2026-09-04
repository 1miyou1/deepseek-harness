import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createAndroidTooling, parseAdbDevices, truncateText, type CommandResult } from '../src/index.ts'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

function handle(stdout: string, stderr = '', exitCode = 0): SubprocessHandle {
  return {
    pid: 1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: stdout, nextOffset: Buffer.byteLength(stdout), lossy: false }) },
      stderr: { readFrom: () => ({ text: stderr, nextOffset: Buffer.byteLength(stderr), lossy: false }) },
    },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: vi.fn(),
    waitForExit: async () => true,
  }
}

describe('android tooling', () => {
  it('parses adb device states and metadata with a fixed upper bound', () => {
    const rows = Array.from({ length: 40 }, (_, index) => `device-${index}\tdevice model:Pixel_${index}`).join('\n')
    const devices = parseAdbDevices(`List of devices attached\n${rows}\nunauthorized\tunauthorized\noffline\toffline\n`)
    expect(devices).toHaveLength(32)
    expect(devices[0]).toEqual({ serial: 'device-0', state: 'device', model: 'Pixel 0' })
  })

  it('truncates text by bytes and marks the result', () => {
    expect(truncateText('abcdef', 4)).toEqual({ text: 'cdef', truncated: true })
  })

  it('passes executable and arguments separately through subprocess', async () => {
    const spawn = vi.fn(() => handle('ok'))
    const tooling = createAndroidTooling({ spawn } as unknown as SubprocessRuntime)
    await expect(tooling.run('adb.exe', ['-s', 'serial; echo unsafe', 'get-state'], 'C:/work', new AbortController().signal))
      .resolves.toMatchObject({ ok: true, stdout: 'ok', timedOut: false })
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      argv: ['adb.exe', '-s', 'serial; echo unsafe', 'get-state'],
      cwd: 'C:/work',
      stdio: { stdin: 'ignore', stdout: { maxBytes: 16_384 }, stderr: { maxBytes: 16_384 } },
    }))
  })

  it('queries Windows Gradle through Java without a command shell', async () => {
    const root = mkdtempSync(join(tmpdir(), 'android-tooling-gradle-'))
    try {
      const bin = join(root, 'bin')
      const lib = join(root, 'lib')
      mkdirSync(bin)
      mkdirSync(lib)
      const gradle = join(bin, 'gradle.bat')
      const launcher = join(lib, 'gradle-launcher-8.9.jar')
      writeFileSync(gradle, '')
      writeFileSync(launcher, '')
      const spawn = vi.fn(() => handle('Gradle 8.9'))
      const tooling = createAndroidTooling({ spawn } as unknown as SubprocessRuntime)
      await expect(tooling.gradleVersion(gradle, 'java.exe', root, new AbortController().signal))
        .resolves.toMatchObject({ ok: true, stdout: 'Gradle 8.9' })
      expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
        argv: ['java.exe', '-classpath', launcher, 'org.gradle.launcher.GradleMain', '--version'],
        cwd: root,
      }))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not spawn when cancellation already happened', async () => {
    const spawn = vi.fn()
    const tooling = createAndroidTooling({ spawn } as unknown as SubprocessRuntime)
    await expect(tooling.run('adb.exe', ['version'], 'C:/work', AbortSignal.abort('cancelled'))).rejects.toBe('cancelled')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('keeps command results structured', () => {
    const result: CommandResult = { ok: false, exitCode: 1, stdout: '', stderr: 'missing', truncated: false, timedOut: false }
    expect(result).toMatchObject({ ok: false, exitCode: 1 })
  })
})
