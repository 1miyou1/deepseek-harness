import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition } from '@deepseek-ai/dsh-experimental-module-scheduler'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/module.ts'
import { analyzeVideo, resolveModelPath, resolvePythonPath } from '../src/video.ts'

function mockSubprocess(outputJson: Record<string, unknown>, exitCode = 0): SubprocessRuntime {
  return {
    spawn: vi.fn(() => ({
      terminate: vi.fn(),
      collected: {
        stdout: { readFrom: () => ({ text: JSON.stringify(outputJson), lossy: false }) },
        stderr: { readFrom: () => ({ text: '', lossy: false }) },
      },
      done: Promise.resolve({ exitCode, signal: null }),
    } as never)),
  } as unknown as SubprocessRuntime
}

describe('video-analyzer profile', () => {
  it('registers the video-analyzer module and verifies definition', () => {
    let definition: ModuleDefinition | undefined
    let cleanup: (() => void) | undefined
    const unregister = vi.fn()

    apply({
      subprocess: {} as SubprocessRuntime,
      moduleScheduler: { registry: { register: (value: ModuleDefinition) => { definition = value; return 'video-analyzer@1.0.0' }, unregister } },
      effect: (setup: () => () => void) => { cleanup = setup() },
    } as unknown as Context)

    expect(definition).toMatchObject({
      id: 'video-analyzer',
      version: '1.0.0',
      displayName: '视频分析器',
      tools: [],
    })

    cleanup!()
    expect(unregister).toHaveBeenCalledWith('video-analyzer@1.0.0')
  })

  it('resolves default python and model paths gracefully', () => {
    const python = resolvePythonPath()
    expect(typeof python).toBe('string')
    expect(python.length).toBeGreaterThan(0)

    const model = resolveModelPath()
    expect(typeof model).toBe('string')
    expect(model.length).toBeGreaterThan(0)
  })

  it('fails fast when target video file does not exist', async () => {
    const subprocess = mockSubprocess({})
    const result = await analyzeVideo(subprocess, 'dummy-script.py', { videoPath: 'non-existent-video.mp4' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('视频文件不存在')
  })

  it('executes analysis and parses structured video transcript correctly', async () => {
    const mockOutput = {
      ok: true,
      title: '测试视频',
      duration: 15.2,
      segments: [
        { start: 0.0, end: 5.1, text: '第一段语音' },
        { start: 5.2, end: 12.0, text: '第二段核心内容' },
      ],
      transcriptMarkdown: '# 测试视频\n\n[00:00.0] 第一段语音\n[00:05.2] 第二段核心内容\n',
    }

    const subprocess = mockSubprocess(mockOutput)
    // Use an existing file as dummy videoPath (e.g. package.json)
    const result = await analyzeVideo(subprocess, 'dummy-script.py', {
      videoPath: 'package.json',
      title: '测试视频',
    })

    expect(result.ok).toBe(true)
    expect(result.title).toBe('测试视频')
    expect(result.duration).toBe(15.2)
    expect(result.segments).toHaveLength(2)
    expect(result.transcriptMarkdown).toContain('[00:05.2] 第二段核心内容')
  })
})
