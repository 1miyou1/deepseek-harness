/** TypeScript orchestration layer for video transcription and analysis. */

import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

export interface VideoSegment {
  start: number
  end: number
  text: string
}

export interface VideoAnalysisResult {
  ok: boolean
  title: string
  duration: number
  segments: VideoSegment[]
  transcriptMarkdown: string
  error?: string
}

export interface VideoAnalysisInput {
  videoPath: string
  title?: string
  pythonPath?: string
  modelPath?: string
}

const DEFAULT_PYTHON_PATHS = [
  'C:/Users/wangl/Desktop/workspace/dsh会话/dsh网页分析专项/.asr-venv/Scripts/python.exe',
  'python',
]

const DEFAULT_MODEL_PATHS = [
  'C:/Users/wangl/.dsh/models/SenseVoiceSmall',
  'C:/Users/wangl/Desktop/workspace/dsh会话/dsh网页分析专项/models/SenseVoiceSmall',
  'SenseVoiceSmall',
]

const MAX_OUTPUT_BYTES = 1024 * 1024

export function resolvePythonPath(customPath?: string): string {
  if (customPath && existsSync(customPath)) return resolve(customPath)
  for (const p of DEFAULT_PYTHON_PATHS) {
    if (existsSync(p)) return resolve(p)
  }
  return 'python'
}

export function resolveModelPath(customPath?: string): string {
  if (customPath && existsSync(customPath)) return resolve(customPath)
  for (const p of DEFAULT_MODEL_PATHS) {
    if (existsSync(p)) return resolve(p)
  }
  return 'SenseVoiceSmall'
}

export async function analyzeVideo(
  subprocess: SubprocessRuntime,
  scriptPath: string,
  input: VideoAnalysisInput,
  signal?: AbortSignal,
): Promise<VideoAnalysisResult> {
  const targetVideo = isAbsolute(input.videoPath) ? input.videoPath : resolve(process.cwd(), input.videoPath)
  if (!existsSync(targetVideo)) {
    return {
      ok: false,
      title: input.title ?? '未命名视频',
      duration: 0,
      segments: [],
      transcriptMarkdown: '',
      error: `视频文件不存在: ${targetVideo}`,
    }
  }

  const pythonExec = resolvePythonPath(input.pythonPath)
  const modelDir = resolveModelPath(input.modelPath)

  // Use a temporary UTF-8 JSON file to pass paths cleanly, avoiding Windows CLI codepage corruption
  const tempConfigFile = resolve(tmpdir(), `dsh-video-cfg-${randomUUID()}.json`)
  const configPayload = {
    video: targetVideo,
    model: modelDir,
    title: input.title ?? '视频转写结果',
  }
  writeFileSync(tempConfigFile, JSON.stringify(configPayload), 'utf8')

  const args = [scriptPath, '--config', tempConfigFile]
  const timeout = AbortSignal.timeout(180_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  try {
    const handle = subprocess.spawn({
      argv: [pythonExec, ...args],
      cwd: resolve(scriptPath, '..'),
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT_BYTES }, stderr: { maxBytes: MAX_OUTPUT_BYTES } },
      graceMs: 2_000,
      signal: combined,
    })

    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0) ?? { text: '' }
    const stderr = handle.collected.stderr?.readFrom(0) ?? { text: '' }

    if (outcome.exitCode !== 0) {
      return {
        ok: false,
        title: input.title ?? '转写失败',
        duration: 0,
        segments: [],
        transcriptMarkdown: '',
        error: stderr.text.trim() || stdout.text.trim() || '转写进程非零退出',
      }
    }

    // Parse the last line of stdout that is valid JSON (ignoring warnings/notices)
    const stdoutLines = stdout.text.split(/\r?\n/u).map(l => l.trim()).filter(Boolean)
    for (let i = stdoutLines.length - 1; i >= 0; i--) {
      const line = stdoutLines[i]
      if (line && (line.startsWith('{') || line.startsWith('['))) {
        try {
          return JSON.parse(line) as VideoAnalysisResult
        } catch {
          // Continue scanning backwards
        }
      }
    }

    return {
      ok: false,
      title: input.title ?? '解析失败',
      duration: 0,
      segments: [],
      transcriptMarkdown: '',
      error: '未能从转写输出中提取出 JSON 结果',
    }
  } catch (err) {
    return {
      ok: false,
      title: input.title ?? '执行异常',
      duration: 0,
      segments: [],
      transcriptMarkdown: '',
      error: String(err),
    }
  } finally {
    try {
      if (existsSync(tempConfigFile)) unlinkSync(tempConfigFile)
    } catch {
      // Ignore temp file cleanup failures
    }
  }
}
