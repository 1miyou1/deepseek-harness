import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import ModuleSchedulerService from '@deepseek-ai/dsh-experimental-module-scheduler'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import * as DocumentOrganizer from '../src/document-organizer-tools.ts'
import * as ModuleDeveloper from '../src/module-developer.ts'
import * as ModuleDeveloperTools from '../src/module-dev-tools.ts'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('Module Scheduler host profile bundle', () => {
  it('declares the scheduler layer without auto-loading the module developer', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      private?: boolean
      publishConfig?: unknown
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.private).toBe(true)
    expect(manifest.publishConfig).toBeUndefined()
    expect(manifest.dependencies).toEqual({
      '@deepseek-ai/dsh-experimental-agent-step-model-router': 'workspace:^',
      '@deepseek-ai/dsh-experimental-android-environment-diagnostics-profile': 'workspace:^',
      '@deepseek-ai/dsh-experimental-module-scheduler': 'workspace:^',
      '@deepseek-ai/dsh-util-values': 'workspace:^',
      '@deepseek-ai/dsh-web': 'workspace:^',
    })
    expect(manifest.peerDependencies).toEqual({
      '@deepseek-ai/cordis': 'workspace:^',
      '@deepseek-ai/dsh-tools': 'workspace:^',
    })
    expect(manifest.devDependencies?.['@deepseek-ai/dsh-tools']).toBe('workspace:^')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(readFileSync(resolve(root, 'cordis.organizer.patch.yml'), 'utf8')).toContain(
      '@deepseek-ai/dsh-experimental-module-scheduler-profile/document-organizer',
    )
    const parsed = yaml.load(readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'), {
      schema: entryListSchema,
    }) as { insert?: { id?: string; name?: string; config?: Record<string, unknown> }[] }[]
    expect(parsed.flatMap(patch => patch.insert ?? [])).toEqual([{
      id: 'module-scheduler',
      name: '@deepseek-ai/dsh-experimental-module-scheduler',
      config: {
        maxConcurrent: 4,
        queueLimit: 32,
        timeoutMs: 30_000,
        maxRecentRuns: 50,
        agentStepModelRoutes: {
          luna: { provider: 'xindu-glm', model: 'glm-5.3-flash' },
          terra: { provider: 'xindu-glm', model: 'glm-5.3-flash' },
          sol: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
        },
      },
    }, {
      id: 'module-network-research',
      name: '@deepseek-ai/dsh-experimental-module-scheduler-profile/network-research',
    }])
  })

  it('loads optional module patches through the real Loader and disposes their registrations', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-module-scheduler-profile-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: system-prompt',
      '  name: \'@deepseek-ai/dsh-system-prompt\'',
      '- id: tools',
      '  name: \'@deepseek-ai/dsh-tools\'',
      '- id: module-scheduler',
      '  name: \'@deepseek-ai/dsh-experimental-module-scheduler\'',
      '- id: sandbox',
      '  name: \'@deepseek-ai/dsh-sandbox-local\'',
      '- id: subprocess',
      '  name: \'@deepseek-ai/dsh-subprocess-local\'',
      '',
    ].join('\n'))

    const profileRoot = fileURLToPath(new URL('..', import.meta.url))
    const organizerPatch = yaml.load(readFileSync(resolve(profileRoot, 'cordis.organizer.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    }) as unknown[]
    const developerPatch = yaml.load(readFileSync(resolve(profileRoot, 'cordis.developer.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    }) as unknown[]
    const boot = async (patches: unknown[] = []): Promise<Context> => {
      const loaded = new Context()
      loaded.baseUrl = pathToFileURL(root!).href + '/'
      await loaded.plugin(Loader)
      loaded.loader.builtins.include = Include
      const modules = new Map<string, unknown>([
        ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
        ['@deepseek-ai/dsh-tools', ToolRuntime],
        ['@deepseek-ai/dsh-experimental-module-scheduler', ModuleSchedulerService],
        ['@deepseek-ai/dsh-sandbox-local', Sandbox],
        ['@deepseek-ai/dsh-subprocess-local', Subprocess],
        ['@deepseek-ai/dsh-experimental-module-scheduler-profile/document-organizer', DocumentOrganizer],
        ['@deepseek-ai/dsh-experimental-module-scheduler-profile/module-dev-tools', ModuleDeveloperTools],
        ['@deepseek-ai/dsh-experimental-module-scheduler-profile/module-developer', ModuleDeveloper],
      ])
      loaded.loader.internal = {
        version: 'v2',
        async import(specifier: string) {
          if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
          return modules.get(specifier)
        },
      } as unknown as NonNullable<typeof loaded.loader.internal>
      await loaded.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href, patches } })
      await loaded.loader.await()
      return loaded
    }

    context = await boot()
    const defaults = context.moduleScheduler.registry.list().map(module => module.ref)
    expect(defaults).not.toContain('document-organizer@1.0.0')
    expect(defaults).not.toContain('module-developer@3.0.0')
    await context.fiber.dispose()

    context = await boot(organizerPatch)
    expect(context.moduleScheduler.registry.get('document-organizer@1.0.0').id).toBe('document-organizer')
    const organizerScheduler = context.moduleScheduler
    await context.fiber.dispose()
    expect(() => organizerScheduler.registry.get('document-organizer@1.0.0')).toThrow('module-not-found')

    context = await boot(developerPatch)
    expect(context.moduleScheduler.registry.list().map(module => module.ref)).toEqual(expect.arrayContaining([
      'module-developer@1.0.0', 'module-developer@2.0.0', 'module-developer@3.0.0',
    ]))
    const developerScheduler = context.moduleScheduler
    await context.fiber.dispose()
    context = undefined
    expect(() => developerScheduler.registry.get('module-developer@3.0.0')).toThrow('module-not-found')
  })
})
