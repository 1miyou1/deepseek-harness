import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

describe('Module Scheduler host profile bundle', () => {
  it('declares one private parseable scheduler layer', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: unknown
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBe(true)
    expect(manifest.publishConfig).toBeUndefined()
    expect(manifest.dependencies).toEqual({
      '@deepseek-ai/dsh-experimental-android-environment-diagnostics-profile': 'workspace:^',
      '@deepseek-ai/dsh-experimental-module-scheduler': 'workspace:^',
      '@deepseek-ai/dsh-web': 'workspace:^',
    })
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'), {
      schema: entryListSchema,
    }) as { insert?: { id?: string; name?: string; config?: Record<string, unknown> }[] }[]
    expect(parsed.flatMap(patch => patch.insert ?? [])).toEqual([{
      id: 'module-scheduler',
      name: '@deepseek-ai/dsh-experimental-module-scheduler',
      config: { maxConcurrent: 4, queueLimit: 32, timeoutMs: 30_000, maxRecentRuns: 50 },
    }, {
      id: 'module-network-research',
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/network-research',
    }, {
      id: 'android-environment-diagnostics',
      name: '@deepseek-ai/dsh-experimental-android-environment-diagnostics-profile/android-diagnostics',
    }, {
      id: 'module-developer-tools',
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-dev-tools',
    }, {
      id: 'module-developer',
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/module-developer',
    }])
  })
})
