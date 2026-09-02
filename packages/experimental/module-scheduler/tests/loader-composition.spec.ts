import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import ModuleSchedulerService, { ModuleRegistry } from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const key of ['__systemPromptService', '__toolRuntimeService', '__moduleSchedulerService']) Reflect.deleteProperty(globalThis, key)
})

describe('module scheduler Loader composition', () => {
  it('loads the service and its dependencies from Cordis configuration rows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-module-scheduler-'))
    roots.push(root)
    const systemPrompt = join(root, 'system-prompt.mjs')
    const toolRuntime = join(root, 'tools.mjs')
    const scheduler = join(root, 'module-scheduler.mjs')
    const config = join(root, 'cordis.yml')
    writeFileSync(systemPrompt, 'export default globalThis.__systemPromptService\n')
    writeFileSync(toolRuntime, 'export default globalThis.__toolRuntimeService\n')
    writeFileSync(scheduler, 'export default globalThis.__moduleSchedulerService\n')
    writeFileSync(config, [
      '- id: system-prompt',
      `  name: ${pathToFileURL(systemPrompt).href}`,
      '- id: tools',
      `  name: ${pathToFileURL(toolRuntime).href}`,
      '- id: module-scheduler',
      `  name: ${pathToFileURL(scheduler).href}`,
      '',
    ].join('\n'))
    Reflect.set(globalThis, '__systemPromptService', SystemPrompt)
    Reflect.set(globalThis, '__toolRuntimeService', ToolRuntime)
    Reflect.set(globalThis, '__moduleSchedulerService', ModuleSchedulerService)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()

    expect(ctx.moduleScheduler).toBeInstanceOf(ModuleSchedulerService)
    expect(ctx.moduleScheduler.registry).toBeInstanceOf(ModuleRegistry)
  })
})
