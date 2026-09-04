/** Create a buildable, deliberately non-runnable Module Scheduler profile scaffold. */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export interface CreateModuleOptions {
  id: string
  name: string
  description: string
}

const GENERATED_PACKAGE_PREFIX = '@deepseek-ai/dsh-experimental-'

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u
const HAN = /\p{Script=Han}/u

function requireOptions(args: string[]): CreateModuleOptions {
  const { values } = parseArgs({
    args: args[0] === '--' ? args.slice(1) : args,
    allowPositionals: false,
    strict: true,
    options: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
    },
  })
  if (!values.id || !values.name || !values.description) throw new Error('required: --id, --name, --description')
  return { id: values.id, name: values.name, description: values.description }
}

function requireRemoveId(args: string[]): string | undefined {
  if (!args.includes('--remove')) return undefined
  const { values } = parseArgs({
    args: args[0] === '--' ? args.slice(1) : args,
    allowPositionals: false,
    strict: true,
    options: { remove: { type: 'boolean' }, id: { type: 'string' } },
  })
  if (!values.remove) return undefined
  if (!values.id) throw new Error('required: --remove --id <kebab-id>')
  return values.id
}

function validate(options: CreateModuleOptions): void {
  if (!ID.test(options.id)) throw new Error('module id must be lowercase kebab-case')
  if (!HAN.test(options.name) || !HAN.test(options.description)) throw new Error('module name and description must contain Chinese text')
}

function blobHash(content: string): string {
  return createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex')
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function manifest(options: CreateModuleOptions, version: string): string {
  const packageName = `@deepseek-ai/dsh-experimental-${options.id}-profile`
  return `${JSON.stringify({
    name: packageName,
    description: `Private Module Scheduler profile for ${options.name}`,
    version,
    private: true,
    type: 'module',
    main: 'lib/index.js',
    types: 'lib/types/index.d.ts',
    exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './module': { types: './lib/types/module.d.ts', default: './lib/types/module.js' },
      './cordis.patch.yml': './cordis.patch.yml',
      './package.json': './package.json',
    },
    files: ['lib/index.js', 'cordis.patch.yml', 'lib/types/**/*.js', 'lib/types/**/*.d.ts'],
    license: 'MIT',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    dependencies: { '@deepseek-ai/dsh-experimental-module-scheduler': 'workspace:^' },
    peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
    devDependencies: { '@deepseek-ai/cordis': 'workspace:^', typescript: '^6.0.3', vitest: '^4.1.8' },
  }, null, 2)}\n`
}

function moduleSource(options: CreateModuleOptions): string {
  return `import type { Context } from '@deepseek-ai/cordis'\nimport type { ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'\n\nexport const inject = ['moduleScheduler']\n\nexport function apply(ctx: Context): void {\n  const definition: ModuleDefinition = {\n    id: '${options.id}',\n    version: '1.0.0',\n    displayName: '${options.name}',\n    description: '${options.description}',\n    tools: [],\n    inputSchema: { type: 'object', additionalProperties: false, properties: {} },\n    outputSchema: { type: 'object', additionalProperties: false, properties: {} },\n    resourcePolicy: { maxConcurrent: 1, queueLimit: 4, timeoutMs: 30_000 },\n    execute: async () => { throw new Error('module-implementation-required') },\n  }\n  const ref = ctx.moduleScheduler.registry.register(definition)\n  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, '${options.id}: registration')\n}\n`
}

function profileTest(options: CreateModuleOptions): string {
  return `import type { Context } from '@deepseek-ai/cordis'\nimport type { ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'\nimport { describe, expect, it, vi } from 'vitest'\nimport { apply } from '../src/module.ts'\n\ndescribe('${options.id} profile', () => {\n  it('registers a Chinese, non-runnable scaffold and releases it', async () => {\n    let definition: ModuleDefinition | undefined\n    let cleanup: (() => void) | undefined\n    const unregister = vi.fn()\n    apply({\n      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definition = value; return '${options.id}@1.0.0' }, unregister } },\n      effect: (setup: () => () => void) => { cleanup = setup() },\n    } as unknown as Context)\n    expect(definition).toMatchObject({ id: '${options.id}', version: '1.0.0', displayName: '${options.name}', description: '${options.description}', tools: [] })\n    await expect(definition!.execute({} as never)).rejects.toThrow('module-implementation-required')\n    cleanup!()\n    expect(unregister).toHaveBeenCalledWith('${options.id}@1.0.0')\n  })\n})\n`
}

function readmes(options: CreateModuleOptions): { en: string; zh: string } {
  const title = `@deepseek-ai/dsh-experimental-${options.id}-profile`
  const en = `---\ndescription: "Private scaffold for the ${options.name} Module Scheduler profile."\nkind: "package-reference"\n---\n\n# ${title}\n\nEnglish | [中文](README.zh.md)\n\n## Summary\n\nThis private scaffold owns the ${options.name} module profile adapter. Replace the explicit implementation-required failure, schemas, and tool list before adding this bundle to a running profile.\n\n## Verification\n\nRun \`pnpm exec vitest run packages/experimental/${options.id}-profile/tests\` after implementing the module.\n\n## Model Experience\n\nNone, as the scaffold is not attached to a profile.\n\n#### KV Cache effect\n\nNone until a consumer explicitly loads the completed module.\n\n## Known Limitations and Deferred Work\n\n- **Implementation required** — the generated executor fails explicitly and the bundle must remain detached until replaced and tested.\n\n### Dev Note\n\nNone.\n`
  const zh = `---\ndescription: "${options.name} Module Scheduler profile 的私有脚手架。"\nkind: "package-reference"\n---\n\n# ${title}\n\n[English](README.md) | 中文\n\n## 概述\n\n这个私有脚手架拥有${options.name}模块的 profile 适配器。将此 bundle 加入运行 profile 前，必须替换显式的待实现失败、schema 和工具列表。\n\n## 验证\n\n模块实现后运行 \`pnpm exec vitest run packages/experimental/${options.id}-profile/tests\`。\n\n## 模型体验\n\n无，因为脚手架尚未接入 profile。\n\n#### KV 缓存影响\n\n在消费方显式加载已完成模块前无影响。\n\n## 已知限制与延期工作\n\n- **需要实现**——生成的执行器会显式失败；完成替换和测试前，bundle 必须保持未接入状态。\n\n### 开发备注\n\n无。\n`
  return { en, zh }
}

function hostConfigPath(root: string): string {
  return join(root, 'tsconfig.host.json')
}

function addHostReference(root: string, packagePath: string): void {
  const path = hostConfigPath(root)
  const content = readFileSync(path, 'utf8')
  if (content.includes(`"path": "${packagePath}"`)) return
  const anchor = '    { "path": "./packages/experimental/module-scheduler-profile" },\n'
  if (!content.includes(anchor)) throw new Error('tsconfig.host.json module scheduler anchor is missing')
  writeFileSync(path, content.replace(anchor, `${anchor}    { "path": "${packagePath}" },\n`))
}

export function removeModuleScaffold(root: string, id: string): void {
  validate({ id, name: '模块', description: '模块' })
  const relative = `packages/experimental/${id}-profile`
  const target = resolve(root, relative)
  if (!existsSync(target)) throw new Error(`scaffold does not exist: ${relative}`)

  const packagePath = join(target, 'package.json')
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    name?: string
    private?: boolean
    dsh?: { bundle?: { patch?: string } }
  }
  const expectedName = `${GENERATED_PACKAGE_PREFIX}${id}-profile`
  if (packageJson.name !== expectedName || packageJson.private !== true || packageJson.dsh?.bundle?.patch !== './cordis.patch.yml') {
    throw new Error('target is not a generated scaffold')
  }

  const reference = `    { "path": "./${relative}" },\n`
  const path = hostConfigPath(root)
  const content = readFileSync(path, 'utf8')
  const matches = content.split(reference).length - 1
  if (matches !== 1) throw new Error('tsconfig.host.json scaffold reference is missing or duplicated')
  writeFileSync(path, content.replace(reference, ''))
  rmSync(target, { recursive: true, force: false })
}

export function createModuleScaffold(root: string, options: CreateModuleOptions): string {
  validate(options)
  const relative = `packages/experimental/${options.id}-profile`
  const target = resolve(root, relative)
  if (existsSync(target)) throw new Error(`target already exists: ${relative}`)
  const version = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version
  const packageName = `@deepseek-ai/dsh-experimental-${options.id}-profile`
  const { en, zh } = readmes(options)
  write(join(target, 'package.json'), manifest(options, version))
  write(join(target, 'tsconfig.json'), `${JSON.stringify({ extends: '../../../tsconfig.base.json', compilerOptions: { rootDir: 'src', outDir: 'lib/types' }, include: ['src'], references: [{ path: '../../../vendor/cordis' }, { path: '../module-scheduler' }] }, null, 2)}\n`)
  write(join(target, 'src/index.ts'), "export * as modulePlugin from './module.ts'\n")
  write(join(target, 'src/module.ts'), moduleSource(options))
  write(join(target, 'tests/profile.spec.ts'), profileTest(options))
  write(join(target, 'cordis.patch.yml'), `- insert:\n    - id: ${options.id}\n      name: '${packageName}/module'\n`)
  write(join(target, 'README.md'), en)
  write(join(target, 'README.zh.md'), zh)
  write(join(target, 'README.i18n.yaml'), `# Bilingual-pair consistency record (docs/i18n/README.md): the git blob hash of each\n# side as of the last confirmed-consistent state. Both languages carry equal authority;\n# after editing either side, bring the other along and re-record with:\n#   pnpm run verify-translation-pairing --write ${relative}/README.md\nREADME.md: ${blobHash(en)}\nREADME.zh.md: ${blobHash(zh)}\n`)
  addHostReference(root, `./${relative}`)
  return relative
}

function main(): void {
  const args = process.argv.slice(2)
  const removeId = requireRemoveId(args)
  if (removeId) {
    removeModuleScaffold(process.cwd(), removeId)
    process.stdout.write(`已回滚 packages/experimental/${removeId}-profile 及其 Host 引用。\n`)
    return
  }
  const relative = createModuleScaffold(process.cwd(), requireOptions(args))
  process.stdout.write(`已创建 ${relative}。实现执行逻辑后运行 pnpm install 和包级验证，再显式接入主 Profile。\n`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
