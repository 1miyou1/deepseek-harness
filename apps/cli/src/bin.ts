#!/usr/bin/env node
/**
 * Command-line entry for dsh.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { parseDshArgs } from './args.ts'
import type { ModuleTestScheduler } from './module-test.ts'

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

function isSuccessfulStart(value: unknown): value is { ok: true; value: { runId: string } } {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === true
    && 'value' in value && typeof value.value === 'object' && value.value !== null
    && 'runId' in value.value && typeof value.value.runId === 'string'
}

function isTerminalStatus(status: unknown): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'blocked' || status === 'cancelled' || status === 'timed_out'
}

async function waitForTerminal(scheduler: ModuleTestScheduler, sessionId: string, runId: string): Promise<unknown> {
  const deadline = Date.now() + 130_000
  while (Date.now() < deadline) {
    const runs = scheduler.remoteView(sessionId).runs as Array<{ runId: string; status: string }>
    const run = runs.find(candidate => candidate.runId === runId)
    if (run !== undefined && isTerminalStatus(run.status)) return run
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('module-test-timeout')
}

const invocation = parseDshArgs(process.argv.slice(2), readVersion())

switch (invocation.mode) {
  case 'profile': {
    const { runProfile } = await import('./profile-boot.ts')
    await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: invocation.profile,
      patchFiles: invocation.patches,
      args: invocation.args,
    })
    break
  }
  case 'module-test': {
    const { runProfile } = await import('./profile-boot.ts')
    const { parseModuleTestCommand, executeModuleTestCommand, moduleTestExitCode } = await import('./module-test.ts')
    const environment = loadLayeredEnv('dsh')
    const previousHome = process.env.DSH_HOME
    const isolatedHome = mkdtempSync(join(tmpdir(), 'dsh-module-test-'))
    process.env.DSH_HOME = isolatedHome
    let shutdown: { shutdown: (code: number) => Promise<void> } | undefined
    try {
      const booted = await runProfile({
        environment,
        profile: invocation.profile,
        patchFiles: invocation.patches,
        args: ['--no-open'],
      })
      const { ctx } = booted
      shutdown = booted.shutdown
      const scheduler = ctx.get('moduleScheduler') as ModuleTestScheduler | undefined
      if (scheduler === undefined) throw new Error('module-scheduler-unavailable')
      const command = parseModuleTestCommand(invocation.args)
      const result = executeModuleTestCommand(scheduler, command)
      if (command.command !== 'start' || !isSuccessfulStart(result)) {
        process.stdout.write(`${JSON.stringify(result)}\n`)
        process.exitCode = moduleTestExitCode(result)
      } else {
        const terminal = await waitForTerminal(scheduler, command.sessionId, result.value.runId)
        const terminalResult = { ok: true, value: terminal }
        process.stdout.write(`${JSON.stringify(terminalResult)}\n`)
        process.exitCode = moduleTestExitCode(terminalResult)
      }
      await shutdown.shutdown(0)
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: error instanceof Error ? error.message : 'module-test-failed' } })}\n`)
      if (shutdown !== undefined) await shutdown.shutdown(1)
      process.exitCode = 1
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      rmSync(isolatedHome, { recursive: true, force: true })
    }
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
