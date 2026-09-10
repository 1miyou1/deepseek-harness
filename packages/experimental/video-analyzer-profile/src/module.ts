import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleDefinition, ModuleExecutionContext } from '@deepseek-ai/dsh-experimental-module-scheduler'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { analyzeVideo, type VideoAnalysisInput } from './video.ts'

export const inject = ['moduleScheduler', 'subprocess']

declare module '@deepseek-ai/cordis' {
  interface Context {
    subprocess: SubprocessRuntime
  }
}

export function apply(ctx: Context): void {
  const currentDir = typeof __dirname !== 'undefined'
    ? __dirname
    : dirname(fileURLToPath(import.meta.url))
  const scriptPath = resolve(currentDir, 'scripts/transcribe.py')

  const definition: ModuleDefinition = {
    id: 'video-analyzer',
    version: '1.0.0',
    displayName: '视频分析器',
    description: '专职只读分析视频文件，基于本地 ASR 提取带时间轴的结构化转写文稿与分段',
    tools: [],
    inputSchema: {
      type: 'object',
      required: ['videoPath'],
      additionalProperties: false,
      properties: {
        videoPath: { type: 'string' },
        title: { type: 'string' },
        pythonPath: { type: 'string' },
        modelPath: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['ok', 'title', 'duration', 'segments', 'transcriptMarkdown'],
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        title: { type: 'string' },
        duration: { type: 'number' },
        segments: {
          type: 'array',
          items: {
            type: 'object',
            required: ['start', 'end', 'text'],
            additionalProperties: false,
            properties: {
              start: { type: 'number' },
              end: { type: 'number' },
              text: { type: 'string' },
            },
          },
        },
        transcriptMarkdown: { type: 'string' },
        error: { type: 'string' },
      },
    },
    resourcePolicy: { maxConcurrent: 2, queueLimit: 8, timeoutMs: 180_000 },
    execute: async ({ input, signal }: ModuleExecutionContext) => {
      const parsedInput = input as VideoAnalysisInput
      return await analyzeVideo(ctx.subprocess, scriptPath, parsedInput, signal)
    },
  }

  const ref = ctx.moduleScheduler.registry.register(definition)
  ctx.effect(() => () => { ctx.moduleScheduler.registry.unregister(ref) }, 'video-analyzer: registration')
}
