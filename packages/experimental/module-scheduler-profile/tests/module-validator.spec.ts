import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ModuleSchedulerService, { type HostToolContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyModuleValidator, createModuleValidatorHostTool, moduleValidatorDefinition } from '../src/module-validator.ts'

const roots: string[] = []
const input = { id: 'example', targetFiles: ['src/module.ts'] }

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-module-validator-'))
  roots.push(root)
  mkdirSync(join(root, 'packages/experimental/example-profile/src'), { recursive: true })
  writeFileSync(join(root, 'packages/experimental/example-profile/src/module.ts'), 'original\n')
  writeFileSync(join(root, 'tsconfig.base.json'), '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022","skipLibCheck":true}}\n')
  return root
}

function runtime(exitCodes: number[] = [0, 0, 0], output = '') {
  let index = 0
  const terminate = vi.fn()
  return {
    terminate,
    sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv] }) },
    subprocess: { spawn: () => ({
      terminate,
      collected: { stdout: { readFrom: () => ({ text: output, lossy: output.length > 4000 }) }, stderr: { readFrom: () => ({ text: '' }) } },
      done: Promise.resolve({ exitCode: exitCodes[index++] ?? 0, signal: null }),
    }) },
  }
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function context(): HostToolContext {
  return {
    request: { sessionId: 's', taskId: 't', moduleRef: 'module-validator@1.0.0' },
    run: {
      runId: 'r', sessionId: 's', taskId: 't', moduleRef: 'module-validator@1.0.0',
      status: 'running', validated: false, signal: new AbortController().signal,
    },
  }
}


describe('模块自动校验器', () => {
  it('按 test、lint、typecheck 顺序返回成功结果且不修改源文件', async () => {
    const root = workspace()
    const before = readFileSync(join(root, 'packages/experimental/example-profile/src/module.ts'), 'utf8')
    const result = await createModuleValidatorHostTool(root, runtime())(input, context())
    expect(result).toMatchObject({ ok: true, moduleName: '模块自动校验器', status: 'succeeded', results: [
      { name: 'test', ok: true, exitCode: 0 }, { name: 'lint', ok: true, exitCode: 0 }, { name: 'typecheck', ok: true, exitCode: 0 },
    ] })
    expect(readFileSync(join(root, 'packages/experimental/example-profile/src/module.ts'), 'utf8')).toBe(before)
  })

  it.each([
    ['test', [2], 'test'], ['lint', [0, 2], 'lint'], ['typecheck', [0, 0, 2], 'typecheck'],
  ])('%s 失败时停止并返回结构化错误', async (_name, codes, failedStep) => {
    const result = await createModuleValidatorHostTool(workspace(), runtime(codes))(input, context()) as { results: unknown[] }
    expect(result).toMatchObject({ ok: false, status: 'failed', failedStep, error: { code: 'validation-command-failed' } })
    expect(result.results).toHaveLength(failedStep === 'test' ? 1 : failedStep === 'lint' ? 2 : 3)
  })

  it('启动失败时返回当前步骤结果且不向调用者抛出', async () => {
    const failing = runtime()
    failing.subprocess.spawn = () => { throw new Error('spawn unavailable') }
    await expect(createModuleValidatorHostTool(workspace(), failing)(input, context())).resolves.toMatchObject({
      ok: false, status: 'failed', failedStep: 'test', error: { code: 'validation-command-start-failed' },
      results: [{ name: 'test', ok: false, exitCode: null, error: { code: 'validation-command-start-failed' } }],
    })
  })

  it('单步超时会终止当前进程，且清理异常不覆盖原错误', async () => {
    const terminate = vi.fn(() => { throw new Error('cleanup failed') })
    const slow = {
      sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv] }) },
      subprocess: { spawn: ({ signal }: { signal: AbortSignal }) => ({
        terminate,
        collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } },
        done: new Promise<{ exitCode: null }>((resolve) => {
          signal.addEventListener('abort', () => { resolve({ exitCode: null }) }, { once: true })
        }),
      }) },
    }
    const tool = createModuleValidatorHostTool(workspace(), slow, {
      stepTimeoutMs: 5, totalTimeoutMs: 50, maxOutputBytes: 2_048, graceMs: 1,
    })
    const result = await tool(input, context())
    expect(result).toMatchObject({ ok: false, status: 'timed_out', failedStep: 'test', error: { code: 'validation-timeout' }, results: [{ name: 'test', ok: false }] })
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('整体超时会终止当前进程并一次性返回已执行结果', async () => {
    const terminate = vi.fn()
    const slow = {
      sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv] }) },
      subprocess: { spawn: ({ signal }: { signal: AbortSignal }) => ({
        terminate,
        collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } },
        done: new Promise<{ exitCode: null }>((resolve) => {
          signal.addEventListener('abort', () => { resolve({ exitCode: null }) }, { once: true })
        }),
      }) },
    }
    const tool = createModuleValidatorHostTool(workspace(), slow, {
      stepTimeoutMs: 50, totalTimeoutMs: 25, maxOutputBytes: 2_048, graceMs: 1,
    })
    const result = await tool(input, context())
    expect(result).toMatchObject({ ok: false, status: 'timed_out', failedStep: 'test', error: { code: 'validation-timeout' }, results: [{ name: 'test', ok: false }] })
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('done、输出读取和清理异常不会泄露到调用方', async () => {
    const broken = {
      sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv] }) },
      subprocess: { spawn: () => ({
        terminate: () => { throw new Error('cleanup failed') },
        collected: { stdout: { readFrom: () => { throw new Error('read failed') } }, stderr: { readFrom: () => ({ text: '' }) } },
        done: Promise.resolve({ exitCode: 0 }),
      }) },
    }
    await expect(createModuleValidatorHostTool(workspace(), broken)(input, context())).resolves.toMatchObject({
      ok: false, failedStep: 'test', error: { code: 'validation-command-start-failed' },
    })
  })

  it('拒绝模块路径越界和缺失目标文件', async () => {
    const root = workspace()
    await expect(createModuleValidatorHostTool(root, runtime())({ id: '../escape' }, context())).resolves.toMatchObject({ ok: false, error: { code: 'validation-config-invalid' } })
    await expect(createModuleValidatorHostTool(root, runtime())({ id: 'example', targetFiles: ['../outside'] }, context())).resolves.toMatchObject({ ok: false, error: { code: 'validation-path-outside-module' } })
    await expect(createModuleValidatorHostTool(root, runtime())({ id: 'example', targetFiles: ['missing.ts'] }, context())).resolves.toMatchObject({ ok: false, error: { code: 'validation-module-not-found' } })
  })

  it('用真实受管 subprocess 执行 test、lint、typecheck', async () => {
    const root = process.cwd()
    const profile = join(root, 'packages/experimental/example-profile')
    mkdirSync(join(profile, 'src'), { recursive: true })
    mkdirSync(join(profile, 'tests'), { recursive: true })
    writeFileSync(join(profile, 'src/module.ts'), 'export const value = 1\n')
    writeFileSync(join(profile, 'tests/smoke.spec.ts'), "import { writeFileSync } from 'node:fs'\nimport { expect, it } from 'vitest'\nit('sandbox rejects direct writes', () => { expect(() => { writeFileSync(new URL('../src/module.ts', import.meta.url), 'changed') }).toThrow() })\n")
    writeFileSync(join(profile, 'tsconfig.json'), '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022","skipLibCheck":true}}\n')
    const ctx = new Context()
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    const sandboxFiber = await ctx.plugin(LocalSandboxProvider)
    const before = readFileSync(join(profile, 'src/module.ts'), 'utf8')
    try {
      const result = await createModuleValidatorHostTool(root, {
        sandbox: ctx.sandbox,
        subprocess: ctx.subprocess,
      }, { maxOutputBytes: 65_536 })({ id: 'example', targetFiles: ['src/module.ts'] }, context())
      expect(result).toMatchObject({ ok: true, status: 'succeeded', results: [
        { name: 'test', ok: true }, { name: 'lint', ok: true }, { name: 'typecheck', ok: true },
      ] })
      expect(readFileSync(join(profile, 'src/module.ts'), 'utf8')).toBe(before)
    } finally {
      await sandboxFiber.dispose()
      await subprocessFiber.dispose()
      rmSync(profile, { recursive: true, force: true })
    }
  }, 30_000)

  it('取消信号终止真实受管 subprocess 并等待退出', async () => {
    const root = process.cwd()
    const profile = join(root, 'packages/experimental/example-profile')
    mkdirSync(join(profile, 'src'), { recursive: true })
    mkdirSync(join(profile, 'tests'), { recursive: true })
    writeFileSync(join(profile, 'src/module.ts'), 'export const value = 1\n')
    writeFileSync(join(profile, 'tests/wait.spec.ts'), "import { it } from 'vitest'\nit('waits', async () => await new Promise(() => {}))\n")
    writeFileSync(join(profile, 'tsconfig.json'), '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2022","skipLibCheck":true}}\n')
    const ctx = new Context()
    const fiber = await ctx.plugin(LocalSubprocessRuntime)
    const started = Promise.withResolvers<ReturnType<typeof ctx.subprocess.spawn>>()
    const controller = new AbortController()
    const runContext = context()
    runContext.run.signal = controller.signal
    try {
      const pending = createModuleValidatorHostTool(root, {
        sandbox: { confine: (argv: readonly string[]) => ({ argv: [...argv] }) },
        subprocess: {
          spawn: (spec) => {
            const handle = ctx.subprocess.spawn(spec)
            started.resolve(handle)
            return handle
          },
        },
      }, { graceMs: 50 })(input, runContext)
      const handle = await started.promise
      controller.abort('cancelled')
      await expect(pending).resolves.toMatchObject({
        ok: false, status: 'cancelled', failedStep: 'test', error: { code: 'validation-cancelled' },
        results: [{ name: 'test', ok: false, error: { code: 'validation-cancelled' } }],
      })
      const outcome = await handle.done
      expect(outcome.exitCode === null || Number.isInteger(outcome.exitCode)).toBe(true)
    } finally {
      await fiber.dispose()
      rmSync(profile, { recursive: true, force: true })
    }
  }, 30_000)

  it('拒绝无效的部署预算', async () => {
    const result = await createModuleValidatorHostTool(workspace(), runtime(), { maxOutputBytes: 1 })(input, context())
    expect(result).toMatchObject({ ok: false, error: { code: 'validation-config-invalid' } })
  })

  it('固定显示名、版本和无 Agent 合同', () => {
    expect(moduleValidatorDefinition).toMatchObject({ id: 'module-validator', version: '1.0.0', displayName: '模块自动校验器' })
    expect(moduleValidatorDefinition.requiresAgent).toBeUndefined()
    expect(moduleValidatorDefinition.tools).toEqual(['module-validator/run'])
  })

  it('释放 Cordis fiber 后撤销模块与私有工具注册', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ModuleSchedulerService)
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(LocalSandboxProvider)
    applyModuleValidator(ctx)
    const scheduler = ctx.moduleScheduler
    expect(scheduler.registry.get('module-validator@1.0.0').tools).toEqual(['module-validator/run'])
    expect(scheduler.remoteView('session-a').modules.map(module => module.id)).toContain('module-validator')
    await ctx.fiber.dispose()
    expect(() => scheduler.registry.get('module-validator@1.0.0')).toThrow('module-not-found')
    expect(scheduler.remoteView('session-a').modules).not.toContainEqual(expect.objectContaining({ id: 'module-validator' }))
  })

  it('三步固定校验性能保持在本地可接受范围', async () => {
    const started = performance.now()
    const result = await createModuleValidatorHostTool(workspace(), runtime())(input, context())
    expect(result).toMatchObject({ ok: true, status: 'succeeded' })
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('输出超过字节上限时失败并返回稳定错误码', async () => {
    const result = await createModuleValidatorHostTool(
      workspace(), runtime([0, 0, 0], '你'.repeat(2000)),
    )(input, context()) as { results: unknown[] }
    expect(result).toMatchObject({
      ok: false, status: 'failed', failedStep: 'test', error: { code: 'validation-output-truncated' },
      results: [{ name: 'test', ok: false, outputTruncated: true, error: { code: 'validation-output-truncated' } }],
    })
  })
})
