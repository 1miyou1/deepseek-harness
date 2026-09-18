import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { evaluateQuickToolCall, parseQuickTask, type QuickTaskState } from './policy.ts'

export * from './policy.ts'
export const name = 'quick-task-governor'
export const inject = []
const SOURCE = { kind: 'plugin' as const, plugin: name }

function messageText(message: UserMessage): string {
  return message.content.filter(block => block.type === 'text').map(block => block.text).join(String.fromCharCode(10))
}

function successfulModuleOutput(result: Readonly<ToolExecutionResult>): Record<string, unknown> | undefined {
  if (result.isError || result.value === null || typeof result.value !== 'object' || Array.isArray(result.value)) return undefined
  const run = result.value as Record<string, unknown>
  if (run.status !== 'succeeded' || run.validated !== true) return undefined
  return run.output !== null && typeof run.output === 'object' && !Array.isArray(run.output)
    ? run.output as Record<string, unknown>
    : undefined
}

export function apply(ctx: Context): void {
  const states = new WeakMap<Agent, QuickTaskState>()
  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    const request = parseQuickTask(messageText(message))
    if (!request.active) return
    states.set(agent, { ...request, implementAttempts: 0, leasedPaths: [], implemented: false, tested: false, escalated: false })
    agent.inject(createUserMessage({
      source: SOURCE,
      content: [{ type: 'text', text: [
        'Quick task mode is enforced by the host.',
        'Do not call write, edit, or pwsh directly.',
        'Use code-implementer@1.0.0 for scoped writes and test-runner@1.0.0 for checks.',
        'At most three declared paths and two implementation attempts are allowed.',
        'If the task crosses those limits, report needsEscalation with evidence.',
      ].join(' ') }],
    }))
  })
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.agent === undefined) return next()
    const state = states.get(exec.agent)
    if (state === undefined) return next()
    const args = exec.arguments as Readonly<Record<string, unknown>>
    const decision = evaluateQuickToolCall(state, String(exec.name), args)
    if (!decision.allowed) return { kind: 'deny', reason: decision.reason }
    if (exec.name === 'module_run' && args.moduleRef === 'code-implementer@1.0.0') {
      state.implementAttempts += 1
      const input = args.input !== null && typeof args.input === 'object' ? args.input as Record<string, unknown> : {}
      const writePaths = Array.isArray(input.writePaths)
        ? input.writePaths.filter((path): path is string => typeof path === 'string')
        : []
      state.leasedPaths = [...new Set([...state.leasedPaths, ...writePaths])]
    }
    return next()
  })
  ctx.on('tools/post-execute', async (exec, result, next) => {
    if (exec.agent === undefined) return next()
    const state = states.get(exec.agent)
    if (state === undefined || exec.name !== 'module_run') return next()
    const args = exec.arguments as Readonly<Record<string, unknown>>
    const output = successfulModuleOutput(result)
    if (args.moduleRef === 'code-implementer@1.0.0' && output?.ok === true) {
      state.implemented = true
      state.tested = false
    }
    if (args.moduleRef === 'test-runner@1.0.0') {
      if (output?.ok === true) state.tested = true
      else if (state.implementAttempts >= 2) state.escalated = true
    }
    return next()
  })
  ctx.on('agent/turn-stopping', ({ agent }) => {
    const state = states.get(agent)
    if (state === undefined || state.escalated) return
    const missing = [
      ...(state.allowedPaths.length > 0 && !state.implemented ? ['successful code-implementer result'] : []),
      ...(state.allowedPaths.length > 0 && state.checksRequired && !state.tested ? ['successful test-runner result'] : []),
    ]
    if (missing.length === 0) return
    agent.steer(createUserMessage({
      source: SOURCE,
      content: [{ type: 'text', text: 'Quick task completion gate is closed. Missing: ' + missing.join(', ')
        + '. Continue within scope, or report needsEscalation after the repair budget is exhausted.' }],
    }))
  })
}
