import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'
import type { Context } from '@deepseek-ai/cordis'
import { validateSchema, type ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/android-diagnostics.ts'

describe('Android diagnostics profile bundle', () => {
  it('declares one private parseable host layer', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: unknown
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBe(true)
    expect(manifest.publishConfig).toBeUndefined()
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'), {
      schema: entryListSchema,
    }) as { insert?: { id?: string; name?: string }[] }[]
    expect(parsed.flatMap(patch => patch.insert ?? [])).toEqual([{
      id: 'android-environment-diagnostics',
      name: '@deepseek-ai/dsh-experimental-android-environment-diagnostics-profile/android-diagnostics',
    }])
  })

  it('registers the exact browser module and validates its complete output', () => {
    let definition: ModuleDefinition | undefined
    const unregister = vi.fn()
    apply({
      subprocess: {},
      moduleScheduler: {
        registry: {
          register: (value: ModuleDefinition) => {
            definition = value
            return `${value.id}@${value.version}`
          },
          unregister,
        },
      },
      effect: (setup: () => () => void) => { setup() },
    } as unknown as Context)

    expect(definition).toMatchObject({
      id: 'android-environment-diagnostics',
      version: '1.0.0',
      displayName: 'Android 环境与设备诊断',
      description: '只读检查 Android 环境与已连接设备',
      tools: [],
      resourcePolicy: { maxConcurrent: 2, queueLimit: 8, timeoutMs: 30_000 },
    })
    const output = {
      project: { path: 'C:/project', exists: true, type: 'android-gradle', hasGradleWrapper: true, gradleWrapperPath: 'C:/project/gradlew.bat' },
      tools: {
        sdk: { available: true, path: 'C:/sdk' },
        java: { available: true, path: 'C:/java.exe', version: '17' },
        gradle: { available: true, path: 'C:/gradle.bat', version: '8.9' },
        adb: { available: true, path: 'C:/adb.exe', version: '1.0.41' },
      },
      devices: [{ serial: 'device-1', state: 'device', model: 'Pixel 8', androidVersion: '15' }],
      application: { packageName: 'com.example.app', deviceSerial: 'device-1', installed: true, versionName: '1.0', versionCode: '1' },
      diagnostics: [{ code: 'example', severity: 'info', subject: 'device', message: 'ok' }],
    }
    expect(validateSchema(definition!.outputSchema, output)).toEqual([])
    expect(validateSchema(definition!.outputSchema, { ...output, unexpected: true })).toContain('$.unexpected: additional')
    expect(validateSchema(definition!.outputSchema, { ...output, devices: [{ ...output.devices[0], unexpected: true }] })).toContain('$.devices[0].unexpected: additional')
  })
})
