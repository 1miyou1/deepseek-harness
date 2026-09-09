/** Register the bounded document organizer and its fixed documentation checks. */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyDocumentOrganizer, type DocumentOrganizerConfig, type DocumentOrganizerRuntime } from './document-organizer.ts'

export const name = 'document-organizer'
export const inject = ['moduleScheduler', 'sandbox', 'subprocess']
/** Loader configuration for document, model, process, and output bounds. */
export type Config = DocumentOrganizerConfig
export const Config: z<Config> = z.object({
  maxFiles: z.number().default(20),
  maxInputBytes: z.number().default(200_000),
  maxPlanBytes: z.number().default(500_000),
  maxSteps: z.number().default(8),
  maxTokensPerStep: z.number().default(8_192),
  totalTimeoutMs: z.number().default(180_000),
  maxOutputBytes: z.number().default(65_536),
  graceMs: z.number().default(1_000),
})

type Runtime = {
  sandbox: { confine(argv: readonly string[], policy: { mode: 'read-only' | 'workspace-write'; workspaceRoot: string }): { argv: string[] } }
  subprocess: { spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: { stdin: 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
    graceMs: number
    signal: AbortSignal
  }): {
    collected: { stdout?: { readFrom(offset: number): { text: string } }; stderr?: { readFrom(offset: number): { text: string } } }
    done: Promise<{ exitCode: number | null }>
  } }
}

function checks(root: string, runtime: Runtime, config: Config): DocumentOrganizerRuntime {
  const maxOutputBytes = Math.floor((config.maxOutputBytes ?? 65_536) / 6)
  const graceMs = config.graceMs ?? 1_000
  return {
    runChecks: async (paths, signal) => {
      const declared = new Set(paths)
      const pairSources = paths.filter((path) => {
        const counterpart = path.replace(/\.md$/u, '.zh.md')
        const sidecar = path.replace(/\.md$/u, '.i18n.yaml')
        return path.endsWith('.md') && !path.endsWith('.zh.md')
          && declared.has(counterpart) && declared.has(sidecar)
          && existsSync(resolve(root, path)) && existsSync(resolve(root, counterpart)) && existsSync(resolve(root, sidecar))
      })
      const commands: Array<{ name: string; script: string; args?: string[]; mode: 'read-only' | 'workspace-write' }> = [
        ...pairSources.length === 0 ? [] : [{
          name: 'translation-pairing-record', script: resolve(root, 'scripts/verify-translation-pairing.ts'),
          args: ['--write', ...pairSources], mode: 'workspace-write' as const,
        }],
        { name: 'agent-note-format', script: resolve(root, 'scripts/verify-agent-note-format.ts'), mode: 'read-only' },
        { name: 'translation-pairing', script: resolve(root, 'scripts/verify-translation-pairing.ts'), mode: 'read-only' },
        { name: 'markdown-links', script: resolve(root, 'scripts/verify-md-links.ts'), mode: 'read-only' },
      ]
      const results = []
      for (const command of commands) {
        const argv = [process.execPath, '--import', 'tsx/esm', command.script, ...command.args ?? []]
        const confined = runtime.sandbox.confine(argv, { mode: command.mode, workspaceRoot: root })
        const handle = runtime.subprocess.spawn({
          argv: confined.argv, cwd: root,
          stdio: { stdin: 'ignore', stdout: { maxBytes: maxOutputBytes }, stderr: { maxBytes: maxOutputBytes } },
          graceMs, signal,
        })
        const outcome = await handle.done
        const output = `${handle.collected.stdout?.readFrom(0).text ?? ''}${handle.collected.stderr?.readFrom(0).text ?? ''}`
          .slice(-maxOutputBytes)
        results.push({ name: command.name, ok: outcome.exitCode === 0, output })
        if (outcome.exitCode !== 0) break
      }
      return results
    },
  }
}

/** Register the organizer with repository-local fixed documentation checks. */
export function apply(ctx: Context, config: Config): void {
  const runtime = ctx as Context & Runtime
  applyDocumentOrganizer(ctx, checks(process.cwd(), runtime, config), config)
}
