import { readFileSync } from 'node:fs'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export interface ModuleTestView {
  modules: unknown[]
  runs: unknown[]
}

export interface ModuleTestScheduler {
  remoteView: (sessionId: string) => ModuleTestView
  remoteStart: (sessionId: string, request: { taskId: string; moduleRef: string; input: JsonValue }) => unknown
  remoteCancel: (sessionId: string, runId: string) => unknown
}

type ModuleTestCommand =
  | { command: 'list' | 'view'; sessionId: string }
  | { command: 'start'; sessionId: string; taskId: string; moduleRef: string; input: JsonValue }
  | { command: 'cancel'; sessionId: string; runId: string }

function required(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag)
  const value = index >= 0 ? args[index + 1] : undefined
  if (!value || value.startsWith('--')) throw new Error(`missing-${flag.slice(2)}`)
  return value
}

function inputValue(args: readonly string[]): JsonValue {
  const fileIndex = args.indexOf('--input-file')
  if (fileIndex >= 0) {
    const file = args[fileIndex + 1]
    if (!file || file.startsWith('--')) throw new Error('missing-input-file')
    try { return JSON.parse(readFileSync(file, 'utf8')) as JsonValue } catch { throw new Error('input-json-invalid') }
  }
  try { return JSON.parse(required(args, '--input')) as JsonValue } catch { throw new Error('input-json-invalid') }
}

export function parseModuleTestCommand(args: readonly string[]): ModuleTestCommand {
  const [rawCommand, ...rest] = args
  if (rawCommand !== 'list' && rawCommand !== 'view' && rawCommand !== 'start' && rawCommand !== 'cancel') {
    throw new Error('module-test-command-invalid')
  }
  const command = rawCommand
  const sessionId = required(rest, '--session')
  if (command === 'list' || command === 'view') return { command, sessionId }
  if (command === 'cancel') {
    const [runId] = rest
    if (!runId || runId.startsWith('--')) throw new Error('missing-run')
    return { command, sessionId, runId }
  }
  const [moduleRef] = rest
  if (!moduleRef || moduleRef.startsWith('--')) throw new Error('missing-module')
  const input = inputValue(rest)
  return { command, sessionId, taskId: required(rest, '--task'), moduleRef, input }
}

export function moduleTestExitCode(value: unknown): number {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === false ? 1 : 0
}

export function executeModuleTestCommand(scheduler: ModuleTestScheduler, command: ModuleTestCommand): unknown {
  switch (command.command) {
    case 'list': return { ok: true, value: scheduler.remoteView(command.sessionId).modules }
    case 'view': return { ok: true, value: scheduler.remoteView(command.sessionId) }
    case 'start': return scheduler.remoteStart(command.sessionId, { taskId: command.taskId, moduleRef: command.moduleRef, input: command.input })
    case 'cancel': return scheduler.remoteCancel(command.sessionId, command.runId)
  }
}
