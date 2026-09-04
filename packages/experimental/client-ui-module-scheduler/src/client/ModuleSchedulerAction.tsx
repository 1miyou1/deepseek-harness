import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  BrowserModuleRunRequest, ModuleCancelResult, ModuleSchedulerView, ModuleStartResult,
} from '@deepseek-ai/dsh-experimental-module-scheduler'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCloseOutline16, IconCodeOutline16, IconRefreshOutline14, StateDot, useAnchoredPosition,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS, type ModuleSchedulerKey } from './locales.ts'
import css from './ModuleSchedulerAction.module.css'

/** Generated Remote result consumed directly by the Module Scheduler UI. */
export type ModuleSchedulerRemoteResult<T> = RemoteResult<T>

/** Business actions injected by the browser plugin. */
export interface ModuleSchedulerActionInjected {
  load: (sessionId: SessionId) => Promise<ModuleSchedulerRemoteResult<ModuleSchedulerView>>
  start: (
    sessionId: SessionId,
    request: BrowserModuleRunRequest,
  ) => Promise<ModuleSchedulerRemoteResult<ModuleStartResult>>
  cancel: (sessionId: SessionId, runId: string) => Promise<ModuleSchedulerRemoteResult<ModuleCancelResult>>
}

/** Full props of the Module Scheduler conversation-header action. */
export type ModuleSchedulerActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & ModuleSchedulerActionInjected
  & PropsLocale<typeof NS>

function parseJsonValue(value: string): JsonValue {
  const parsed: unknown = JSON.parse(value)
  if (parsed === null || typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean') return parsed
  if (Array.isArray(parsed)) return parsed.map(parseJsonValue)
  if (typeof parsed === 'object') {
    return Object.fromEntries(Object.entries(parsed).map(([key, child]) => [key, parseJsonValue(JSON.stringify(child))]))
  }
  throw new Error('invalid-json-value')
}

function failureText(error: { readonly code: string; readonly message: string }): string {
  return `${error.message} (${error.code})`
}

type ModuleRun = ModuleSchedulerView['runs'][number]

const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

function statusKey(status: ModuleRun['status']): ModuleSchedulerKey {
  return `status.${status}`
}

function isCancellable(run: ModuleRun): boolean {
  return run.status === 'created' || run.status === 'running'
}

/** Render browser-runnable modules and current-session run controls. */
export function ModuleSchedulerAction({
  sessionId, load, start, cancel, t,
}: ModuleSchedulerActionProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<ModuleSchedulerView | null>(null)
  const [moduleRef, setModuleRef] = useState('')
  const [taskId, setTaskId] = useState('')
  const [input, setInput] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const sessionRef = useRef(sessionId)
  const generationRef = useRef(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelPosition = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    panelRef,
    side: 'bottom',
    gap: 8,
    margin: 12,
  })
  sessionRef.current = sessionId

  useEffect(() => {
    generationRef.current += 1
    setOpen(false)
    setLoading(false)
    setView(null)
    setModuleRef('')
    setTaskId('')
    setInput('{}')
    setError(null)
    setPending(null)
  }, [sessionId])

  const refresh = useCallback(async (): Promise<boolean> => {
    const requestedSession = sessionId
    const generation = ++generationRef.current
    setLoading(true)
    const result = await load(requestedSession)
    if (sessionRef.current !== requestedSession || generationRef.current !== generation) return false
    setLoading(false)
    if (!result.ok) {
      setError(failureText(result.error))
      return false
    }
    setView(result.value)
    setModuleRef(current => result.value.modules.some(module => module.ref === current && module.runnableFromBrowser)
      ? current
      : (result.value.modules.find(module => module.runnableFromBrowser && module.tools.length === 0)?.ref ?? ''))
    setError(null)
    return true
  }, [load, sessionId])

  const runStart = async (): Promise<void> => {
    const normalizedTaskId = taskId.trim()
    if (normalizedTaskId === '' || moduleRef === '') return
    let parsed: JsonValue
    try {
      parsed = parseJsonValue(input)
    } catch {
      setError(t('invalidJson'))
      return
    }
    const requestedSession = sessionId
    generationRef.current += 1
    setLoading(false)
    setPending('start')
    const result = await start(requestedSession, {
      taskId: normalizedTaskId,
      moduleRef,
      input: parsed,
    })
    if (sessionRef.current !== requestedSession) return
    setPending(null)
    if (!result.ok) {
      setError(failureText(result.error))
      return
    }
    if (!result.value.ok) {
      setError(failureText(result.value.error))
      return
    }
    setError(null)
    await refresh()
  }

  const runCancel = async (runId: string): Promise<void> => {
    const requestedSession = sessionId
    generationRef.current += 1
    setLoading(false)
    setPending(runId)
    const result = await cancel(requestedSession, runId)
    if (sessionRef.current !== requestedSession) return
    setPending(null)
    if (!result.ok) {
      setError(failureText(result.error))
      return
    }
    if (!result.value.ok) {
      setError(failureText(result.value.error))
      return
    }
    setError(null)
    await refresh()
  }

  return (
    <div className={css.root} data-module-scheduler-action>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        onClick={() => {
          const next = !open
          setOpen(next)
          if (next) void refresh()
        }}
      >
        <IconCodeOutline16 size={14} />
        <span>{t('trigger')}</span>
      </button>
      {open && createPortal((
        <div
          ref={panelRef}
          className={css.panel}
          role="dialog"
          aria-label={t('trigger')}
          style={panelPosition ?? MEASURE_STYLE}
        >
          <div className={css.toolbar}>
            <strong>{t('trigger')}</strong>
            <span className={css.spacer} />
            <button type="button" className={css.iconButton} aria-label={t('refresh')} onClick={() => { void refresh() }}>
              <IconRefreshOutline14 />
            </button>
            <button type="button" className={css.iconButton} aria-label={t('close')} onClick={() => { setOpen(false) }}>
              <IconCloseOutline16 size={14} />
            </button>
          </div>
          {error !== null && <div className={css.error} role="alert">{error}</div>}
          {loading && view === null && <div className={css.notice}>{t('loading')}</div>}
          {view !== null && (
            <>
              <section className={css.form}>
                {view.modules.length === 0
                  ? <div className={css.notice}>{t('emptyModules')}</div>
                  : (
                    <>
                      <label htmlFor="module-scheduler-module">{t('module')}</label>
                      <select
                        id="module-scheduler-module"
                        value={moduleRef}
                        onChange={(event) => { setModuleRef(event.target.value) }}
                      >
                        {view.modules.map(module => (
                          <option
                            key={module.ref}
                            value={module.ref}
                            disabled={!module.runnableFromBrowser}
                          >
                            {module.id} {module.version} — {module.description}
                            {module.tools.length > 0 ? ` · ${t('requiresTools')}` : ''}
                          </option>
                        ))}
                      </select>
                      <label htmlFor="module-scheduler-task">{t('taskId')}</label>
                      <input
                        id="module-scheduler-task"
                        value={taskId}
                        onChange={(event) => { setTaskId(event.target.value) }}
                      />
                      <label htmlFor="module-scheduler-input">{t('input')}</label>
                      <textarea
                        id="module-scheduler-input"
                        value={input}
                        onChange={(event) => { setInput(event.target.value) }}
                      />
                      <button
                        type="button"
                        className={css.primaryButton}
                        disabled={pending !== null || moduleRef === '' || taskId.trim() === ''}
                        onClick={() => { void runStart() }}
                      >
                        {pending === 'start' ? t('starting') : t('start')}
                      </button>
                    </>
                  )}
              </section>
              <section>
                <h3>{t('runs')}</h3>
                {view.runs.length === 0 && <div className={css.notice}>{t('emptyRuns')}</div>}
                <div className={css.runs}>
                  {view.runs.map(run => (
                    <article key={run.runId} className={css.run}>
                      <div className={css.runTitle}>
                        <StateDot state={run.status === 'running' || run.status === 'created' ? 'ongoing' : run.status === 'succeeded' ? 'done' : 'error'} />
                        <strong>{run.runId}</strong>
                        <span>{t(statusKey(run.status))}</span>
                      </div>
                      <div className={css.meta}>{run.taskId} · {run.moduleRef}</div>
                      {run.reason !== undefined && <div className={css.reason}>{t('reason')}: {run.reason}</div>}
                      {run.output !== undefined && (
                        <pre className={css.output} aria-label={t('result')}>{JSON.stringify(run.output, null, 2)}</pre>
                      )}
                      {isCancellable(run) && (
                        <button
                          type="button"
                          className={css.smallButton}
                          disabled={pending !== null}
                          onClick={() => { void runCancel(run.runId) }}
                        >
                          {pending === run.runId ? t('cancelling') : t('cancel')}
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      ), document.body)}
    </div>
  )
}
