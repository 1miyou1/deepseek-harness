import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { inspectGit, parseGitLog, parseGitStatusShort } from '../src/git.ts'
import { apply } from '../src/module.ts'

function mockSubprocess(outputByArg: Record<string, string>): SubprocessRuntime {
  return {
    spawn: vi.fn(({ argv }: { argv: readonly string[] }) => {
      const matchedKey = Object.keys(outputByArg).find(key => argv.includes(key))
      const text = matchedKey ? outputByArg[matchedKey] ?? '' : ''
      const exitCode = text === 'error' ? 1 : 0
      return {
        terminate: vi.fn(),
        collected: {
          stdout: { readFrom: () => ({ text, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
        done: Promise.resolve({ exitCode, signal: null }),
      } as never
    }),
  } as unknown as SubprocessRuntime
}

describe('git-inspector profile', () => {
  it('registers the git-inspector module and executes inspectGit', async () => {
    let definition: ModuleDefinition | undefined
    let cleanup: (() => void) | undefined
    const unregister = vi.fn()
    const subprocess = mockSubprocess({
      '--is-inside-work-tree': 'true',
      '--porcelain': '## master...origin/master [ahead 1]\n M file.ts\n',
      '--oneline': 'abc1234 test commit\n',
    })

    apply({
      subprocess,
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definition = value; return 'git-inspector@1.0.0' }, unregister } },
      effect: (setup: () => () => void) => { cleanup = setup() },
    } as unknown as Context)

    expect(definition).toMatchObject({
      id: 'git-inspector',
      version: '1.0.0',
      displayName: 'Git状态分析器',
      description: '专职只读分析指定目录的Git工作树状态与分支概况',
      tools: [],
    })

    const executionContext: ModuleExecutionContext = {
      sessionId: 'session-test',
      taskId: 'task-test',
      runId: 'run-test',
      tools: new Map(),
      input: { path: process.cwd() },
      signal: new AbortController().signal,
    }

    const result = await definition!.execute(executionContext)
    expect(result).toMatchObject({
      ok: true,
      isRepo: true,
      branch: 'master',
      ahead: 1,
      clean: false,
      modified: ['file.ts'],
      recentCommits: [{ hash: 'abc1234', message: 'test commit' }],
    })
    cleanup!()
    expect(unregister).toHaveBeenCalledWith('git-inspector@1.0.0')
  })

  it('correctly parses git status porcelain output', () => {
    const raw = [
      '## master...origin/master [ahead 2, behind 1]',
      ' M packages/file1.ts',
      '?? new-file.txt',
    ].join('\n')

    const parsed = parseGitStatusShort(raw)
    expect(parsed.branch).toBe('master')
    expect(parsed.ahead).toBe(2)
    expect(parsed.behind).toBe(1)
    expect(parsed.modified).toEqual(['packages/file1.ts'])
    expect(parsed.untracked).toEqual(['new-file.txt'])
  })

  it('correctly parses git log output', () => {
    const raw = [
      '79188da fix(module-scheduler): cap execution drain timeout',
      'f313a36 fix(subagent): surface diagnostic on llm error',
    ].join('\n')

    const parsed = parseGitLog(raw)
    expect(parsed).toEqual([
      { hash: '79188da', message: 'fix(module-scheduler): cap execution drain timeout' },
      { hash: 'f313a36', message: 'fix(subagent): surface diagnostic on llm error' },
    ])
  })

  it('returns isRepo=false for non-git directory', async () => {
    const subprocess = mockSubprocess({
      '--is-inside-work-tree': 'error',
    })
    const result = await inspectGit(subprocess, 'C:/Windows')
    expect(result).toMatchObject({ ok: true, isRepo: false, error: 'not-a-git-repository' })
  })
})
