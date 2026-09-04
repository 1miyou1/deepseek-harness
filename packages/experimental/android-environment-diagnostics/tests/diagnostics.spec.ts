import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { diagnose } from '../src/index.ts'
import type { AndroidTooling, CommandResult } from '@deepseek-ai/dsh-experimental-android-tooling'

const ok = (stdout = ''): CommandResult => ({ ok: true, exitCode: 0, stdout, stderr: '', truncated: false, timedOut: false })

function tooling(overrides: Partial<AndroidTooling> = {}): AndroidTooling {
  return {
    findTools: () => ({}),
    run: async () => ok(),
    devices: async () => ok(),
    gradleVersion: async () => ok('Gradle 8.9'),
    ...overrides,
  }
}

describe('android diagnostics', () => {
  it('reports missing project and tools without throwing', async () => {
    const result = await diagnose({ projectPath: 'C:/does-not-exist' }, tooling(), new AbortController().signal)
    expect(result.project.exists).toBe(false)
    expect(result.diagnostics.map(item => item.code)).toContain('project-not-found')
    expect(result.tools.adb.available).toBe(false)
  })

  it('queries tool versions, device Android versions, and one installed package', async () => {
    const project = mkdtempSync(join(tmpdir(), 'android-diagnostics-'))
    writeFileSync(join(project, 'settings.gradle.kts'), '')
    writeFileSync(join(project, 'gradlew.bat'), '')
    const run = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args.includes('getprop')) return ok('15\n')
      if (args.includes('dumpsys')) return ok('versionCode=42 minSdk=23\nversionName=1.2.3\n')
      return ok('tool version 1.0\n')
    })
    const result = await diagnose({ projectPath: project, packageName: 'com.example.app', deviceSerial: 'serial-1' }, tooling({
      findTools: () => ({ sdk: 'sdk', adb: 'adb.exe', java: 'java.exe', gradle: 'gradle.bat', gradleWrapper: join(project, 'gradlew.bat') }),
      devices: async () => ok('List of devices attached\nserial-1\tdevice model:Pixel_8\n'),
      run,
    }), new AbortController().signal)

    expect(result.tools.adb.version).toContain('tool version')
    expect(result.tools.gradle.version).toBe('Gradle 8.9')
    expect(result.devices).toEqual([{ serial: 'serial-1', state: 'device', model: 'Pixel 8', androidVersion: '15' }])
    expect(result.application).toEqual({ packageName: 'com.example.app', deviceSerial: 'serial-1', installed: true, versionName: '1.2.3', versionCode: '42' })
    expect(run).toHaveBeenCalledWith('adb.exe', ['-s', 'serial-1', 'shell', 'dumpsys', 'package', 'com.example.app'], project, expect.any(AbortSignal))
  })

  it('classifies a tool process timeout', async () => {
    const result = await diagnose({ projectPath: 'C:/does-not-exist', includeDevices: false }, tooling({
      findTools: () => ({ adb: 'adb.exe' }),
      run: async () => ({ ok: false, exitCode: null, stdout: '', stderr: '', truncated: false, timedOut: true }),
    }), new AbortController().signal)
    expect(result.diagnostics.some(item => item.code === 'process-timeout' && item.subject === 'adb')).toBe(true)
  })

  it('bounds diagnostics and reports truncated process output', async () => {
    const result = await diagnose({ projectPath: 'C:/does-not-exist' }, tooling({
      findTools: () => ({ adb: 'adb.exe' }),
      devices: async () => ({ ...ok(), truncated: true }),
      run: async () => ok('adb 1'),
    }), new AbortController().signal)
    expect(result.diagnostics.length).toBeLessThanOrEqual(64)
    expect(result.diagnostics.some(item => item.code === 'process-output-truncated')).toBe(true)
    expect(result.diagnostics.some(item => item.code === 'no-devices')).toBe(true)
    expect(result.diagnostics.every(item => item.message.length <= 512)).toBe(true)
  })
})
