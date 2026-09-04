// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ModuleSchedulerView } from '@deepseek-ai/dsh-experimental-module-scheduler'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ModuleSchedulerAction,
  type ModuleSchedulerActionInjected,
  type ModuleSchedulerActionProps,
  type ModuleSchedulerRemoteResult,
} from '../src/client/ModuleSchedulerAction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SESSION = 'session-1' as SessionId
const NEXT_SESSION = 'session-2' as SessionId
const runnable = {
  ref: 'echo@1', id: 'echo', version: '1', description: 'Echo input', tools: [],
  inputSchema: { type: 'object' as const }, runnableFromBrowser: true,
}
const assisted = {
  ref: 'search@1', id: 'search', version: '1', description: 'Needs tools', tools: ['web_search'],
  inputSchema: { type: 'object' as const }, runnableFromBrowser: false,
}
const view: ModuleSchedulerView = {
  modules: [runnable, assisted],
  runs: [{
    runId: 'run-1', taskId: 'task-1', moduleRef: runnable.ref, status: 'succeeded',
    output: { content: 'verified summary', sources: [], truncated: false },
  }],
}

function remoteFailure<T>(message: string): ModuleSchedulerRemoteResult<T> {
  return { ok: false, error: new RemoteError('gateway/internal', message, {}) }
}

function actions(overrides: Partial<ModuleSchedulerActionInjected> = {}): ModuleSchedulerActionInjected {
  return {
    load: () => Promise.resolve({ ok: true, value: view }),
    start: () => Promise.resolve({ ok: true, value: { ok: true, value: view.runs[0]! } }),
    cancel: () => Promise.resolve({ ok: true, value: { ok: true, value: true } }),
    ...overrides,
  }
}

function props(injected: ModuleSchedulerActionInjected, sessionId: SessionId = SESSION): ModuleSchedulerActionProps {
  return { sessionId, ...injected, t: makeTranslate(zh) } as unknown as ModuleSchedulerActionProps
}

function open(injected = actions()) {
  render(<ModuleSchedulerAction {...props(injected)} />)
  fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
}

describe('ModuleSchedulerAction', () => {
  it('opens, refreshes, closes, and renders an empty module catalog', async () => {
    const load = vi.fn().mockResolvedValue({ ok: true, value: { modules: [], runs: [] } })
    open(actions({ load }))
    expect(screen.getByRole('button', { name: zh.trigger }).getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText(zh.emptyModules)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: zh.trigger })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
    fireEvent.click(screen.getByRole('button', { name: zh.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('portals the panel outside the conversation layout', async () => {
    const rendered = render(<ModuleSchedulerAction {...props(actions())} />)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    const dialog = await screen.findByRole('dialog', { name: zh.trigger })
    expect(rendered.container.contains(dialog)).toBe(false)
    expect(dialog.parentElement).toBe(document.body)
  })

  it('reports invalid JSON without starting a module', async () => {
    const start = vi.fn()
    open(actions({ start }))
    await screen.findByRole('option', { name: /echo/u })
    fireEvent.change(screen.getByLabelText(zh.taskId), { target: { value: 'task-json' } })
    fireEvent.change(screen.getByLabelText(zh.input), { target: { value: '{' } })
    fireEvent.click(screen.getByRole('button', { name: zh.start }))
    expect((await screen.findByRole('alert')).textContent).toBe(zh.invalidJson)
    expect(start).not.toHaveBeenCalled()
  })

  it('disables modules requiring tools', async () => {
    open()
    const option = await screen.findByRole<HTMLOptionElement>('option', { name: /search/u })
    expect(option.disabled).toBe(true)
  })

  it('starts a selected module and refreshes current-session runs', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { modules: [runnable], runs: [] } })
      .mockResolvedValueOnce({ ok: true, value: view })
    const start = vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: view.runs[0] } })
    open(actions({ load, start }))
    await screen.findByRole('option', { name: /echo/u })
    fireEvent.change(screen.getByLabelText(zh.taskId), { target: { value: ' task-1 ' } })
    fireEvent.change(screen.getByLabelText(zh.input), { target: { value: '{"message":"hi"}' } })
    fireEvent.click(screen.getByRole('button', { name: zh.start }))
    await waitFor(() => {
      expect(start).toHaveBeenCalledWith(SESSION, {
        taskId: 'task-1', moduleRef: runnable.ref, input: { message: 'hi' },
      })
    })
    expect(await screen.findByText('run-1')).toBeTruthy()
    expect(screen.getByText(/verified summary/u)).toBeTruthy()
  })

  it('cancels created and running runs but not terminal runs', async () => {
    const withRuns: ModuleSchedulerView = {
      modules: [runnable],
      runs: [
        { runId: 'created', taskId: 'one', moduleRef: runnable.ref, status: 'created' },
        { runId: 'running', taskId: 'two', moduleRef: runnable.ref, status: 'running' },
        { runId: 'done', taskId: 'three', moduleRef: runnable.ref, status: 'succeeded' },
      ],
    }
    const cancel = vi.fn().mockResolvedValue({ ok: true, value: { ok: true, value: true } })
    open(actions({ load: () => Promise.resolve({ ok: true, value: withRuns }), cancel }))
    await screen.findByText('created')
    const buttons = screen.getAllByRole('button', { name: zh.cancel })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1]!)
    await waitFor(() => { expect(cancel).toHaveBeenCalledWith(SESSION, 'running') })
  })

  it('shows Remote and business failures as alerts', async () => {
    const first = render(<ModuleSchedulerAction {...props(actions({ load: () => Promise.resolve(remoteFailure('offline')) }))} />)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    expect((await screen.findByRole('alert')).textContent).toBe('offline (gateway/internal)')
    first.unmount()

    open(actions({ start: () => Promise.resolve({
      ok: true, value: { ok: false, error: { code: 'input-schema-invalid', message: 'bad input' } },
    }) }))
    await screen.findByRole('option', { name: /echo/u })
    fireEvent.change(screen.getByLabelText(zh.taskId), { target: { value: 'task' } })
    fireEvent.click(screen.getByRole('button', { name: zh.start }))
    expect((await screen.findByRole('alert')).textContent).toBe('bad input (input-schema-invalid)')
  })

  it('clears state and ignores stale asynchronous responses after a session switch', async () => {
    const stale = Promise.withResolvers<ModuleSchedulerRemoteResult<ModuleSchedulerView>>()
    const load = vi.fn((sessionId: SessionId) => sessionId === SESSION
      ? stale.promise
      : Promise.resolve({ ok: true as const, value: { modules: [], runs: [] } }))
    const injected = actions({ load })
    const rendered = render(<ModuleSchedulerAction {...props(injected)} />)
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    await waitFor(() => { expect(load).toHaveBeenCalledWith(SESSION) })
    rendered.rerender(<ModuleSchedulerAction {...props(injected, NEXT_SESSION)} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.trigger }))
    expect(await screen.findByText(zh.emptyModules)).toBeTruthy()
    stale.resolve({ ok: true, value: view })
    await Promise.resolve()
    expect(screen.queryByText('run-1')).toBeNull()
  })
})
