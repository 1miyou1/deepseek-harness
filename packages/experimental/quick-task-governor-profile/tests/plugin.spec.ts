import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

interface FakeAgent {
  readonly injected: unknown[]
  readonly steered: unknown[]
  inject(message: unknown): void
  steer(message: unknown): void
}

type ClaimedHandler = (payload: { agent: FakeAgent; message: ReturnType<typeof createUserMessage> }) => void
type PreHandler = (exec: Readonly<Record<string, unknown>>, next: () => Promise<unknown>) => Promise<unknown>
type PostHandler = (
  exec: Readonly<Record<string, unknown>>,
  result: Readonly<Record<string, unknown>>,
  next: () => Promise<unknown>,
) => Promise<unknown>
type StoppingHandler = (payload: { agent: FakeAgent }) => void

function harness(): { handlers: Map<string, unknown>; agent: FakeAgent } {
  const handlers = new Map<string, unknown>()
  const ctx = { on(name: string, handler: unknown) { handlers.set(name, handler); return () => undefined } }
  apply(ctx as unknown as Context)
  const agent: FakeAgent = {
    injected: [],
    steered: [],
    inject(message) { this.injected.push(message) },
    steer(message) { this.steered.push(message) },
  }
  return { handlers, agent }
}

function successfulModule(output: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { isError: false, value: { status: 'succeeded', validated: true, output }, content: [] }
}

describe('quick task governor plugin', () => {
  it('enforces module-only writes and keeps the completion gate closed until tests pass', async () => {
    const { handlers, agent } = harness()
    const claimed = handlers.get('agent/inbox/claimed') as ClaimedHandler
    const pre = handlers.get('tools/pre-execute') as PreHandler
    const post = handlers.get('tools/post-execute') as PostHandler
    const stopping = handlers.get('agent/turn-stopping') as StoppingHandler
    const next = async () => ({ kind: 'allow' })
    const message = createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: ['/quick', '允许范围：src/a.ts, src/lib', '验收：tests'].join(String.fromCharCode(10)) }],
    })

    claimed({ agent, message })
    expect(agent.injected).toHaveLength(1)
    await expect(pre({ agent, name: 'write', arguments: {} }, next)).resolves.toMatchObject({ kind: 'deny' })

    const implement = { agent, name: 'module_run', arguments: {
      moduleRef: 'code-implementer@1.0.0', input: { writePaths: ['src/a.ts', 'src/lib/b.ts'] },
    } }
    await expect(pre(implement, next)).resolves.toEqual({ kind: 'allow' })
    await post(implement, successfulModule({ ok: true, changedFiles: ['src/a.ts', 'src/lib/b.ts'] }), next)
    stopping({ agent })
    expect(agent.steered).toHaveLength(1)

    const test = { agent, name: 'module_run', arguments: { moduleRef: 'test-runner@1.0.0', input: {} } }
    await post(test, successfulModule({ ok: true, total: 1, passed: 1, failed: 0 }), next)
    stopping({ agent })
    expect(agent.steered).toHaveLength(1)

    await expect(pre({ agent, name: 'module_run', arguments: {
      moduleRef: 'code-implementer@1.0.0', input: { writePaths: ['src/lib/c.ts', 'src/lib/d.ts'] },
    } }, next)).resolves.toMatchObject({ kind: 'deny' })
  })
})
