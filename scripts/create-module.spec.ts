import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createModuleScaffold, removeModuleScaffold } from './create-module.ts'

const roots: string[] = []

function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'dsh-create-module-'))
  roots.push(path)
  writeFileSync(join(path, 'package.json'), '{"version":"0.1.2-alpha.5"}\n')
  writeFileSync(join(path, 'tsconfig.host.json'), '{\n  "references": [\n    { "path": "./packages/experimental/module-scheduler-profile" },\n    { "path": "./apps/cli" }\n  ]\n}\n')
  return path
}

afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('create module scaffold', () => {
  it('creates one detached Chinese profile scaffold and host reference', () => {
    const workspace = root()
    const relative = createModuleScaffold(workspace, {
      id: 'android-device-debug',
      name: 'Android 设备调试',
      description: '诊断已连接 Android 设备',
    })
    const target = join(workspace, relative)

    expect(relative).toBe('packages/experimental/android-device-debug-profile')
    expect(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-android-device-debug-profile',
      version: '0.1.2-alpha.5',
      private: true,
    })
    expect(readFileSync(join(target, 'src/module.ts'), 'utf8')).toContain("displayName: 'Android 设备调试'")
    expect(readFileSync(join(target, 'src/module.ts'), 'utf8')).toContain("Promise.reject(new Error('module-implementation-required'))")
    expect(readFileSync(join(target, 'README.i18n.yaml'), 'utf8')).toMatch(/README\.md: [a-f0-9]{40}/u)
    expect(readFileSync(join(workspace, 'tsconfig.host.json'), 'utf8')).toContain(`{ "path": "./${relative}" }`)
    expect(existsSync(join(target, 'cordis.patch.yml'))).toBe(true)
  })

  it('escapes generated TypeScript literals and rejects control characters', () => {
    const workspace = root()
    const options = { id: 'quoted-module', name: "引号 '模块", description: '描述 第二行' }
    const relative = createModuleScaffold(workspace, options)
    const source = readFileSync(join(workspace, relative, 'src/module.ts'), 'utf8')
    expect(source).toContain("displayName: '引号 \\'模块'")
    expect(source).toContain("description: '描述 第二行'")
    expect(() => createModuleScaffold(workspace, { ...options, id: 'control-module', description: '描述\u0001模块' })).toThrow('invalid-description')
  })

  it('cleans the partial scaffold when host reference setup fails', () => {
    const workspace = root()
    const options = { id: 'failed-module', name: '失败模块', description: '验证失败清理' }
    writeFileSync(join(workspace, 'tsconfig.host.json'), '{"references":[] }\n')

    expect(() => { createModuleScaffold(workspace, options) }).toThrow('anchor is missing')
    expect(existsSync(join(workspace, 'packages/experimental/failed-module-profile'))).toBe(false)
    expect(readFileSync(join(workspace, 'tsconfig.host.json'), 'utf8')).toBe('{"references":[] }\n')
  })

  it('removes the generated scaffold and its host reference', () => {
    const workspace = root()
    const options = { id: 'removable-module', name: '可移除模块', description: '验证脚手架回滚' }
    const relative = createModuleScaffold(workspace, options)

    removeModuleScaffold(workspace, options.id)

    expect(existsSync(join(workspace, relative))).toBe(false)
    expect(readFileSync(join(workspace, 'tsconfig.host.json'), 'utf8')).not.toContain(`{ "path": "./${relative}" }`)
  })

  it('refuses to remove a duplicated host reference', () => {
    const workspace = root()
    const options = { id: 'duplicated-module', name: '重复模块', description: '验证重复引用' }
    const relative = createModuleScaffold(workspace, options)
    const hostPath = join(workspace, 'tsconfig.host.json')
    const reference = `    { "path": "./${relative}" },\n`
    writeFileSync(hostPath, `${readFileSync(hostPath, 'utf8')}${reference}`)

    expect(() => { removeModuleScaffold(workspace, options.id) }).toThrow('missing or duplicated')
    expect(existsSync(join(workspace, relative))).toBe(true)
  })

  it('refuses to remove a non-generated package', () => {
    const workspace = root()
    const target = join(workspace, 'packages/experimental/not-generated-profile')
    writeFileSync(join(workspace, 'tsconfig.host.json'), '{\n  "references": [\n    { "path": "./packages/experimental/module-scheduler-profile" },\n    { "path": "./packages/experimental/not-generated-profile" }\n  ]\n}\n')
    mkdirSync(join(target), { recursive: true })
    writeFileSync(join(target, 'package.json'), '{"name":"@deepseek-ai/other-package"}\n')

    expect(() => { removeModuleScaffold(workspace, 'not-generated') }).toThrow('generated scaffold')
    expect(existsSync(target)).toBe(true)
  })
})
