import { useEffect, useState } from 'react'
import { useT } from './i18n'
import { useEscape } from './useEscape'
import { plainError } from './NoticeDialog'

/** A user request went over the simultaneous runs limit and was queued: asks whether to run anyway, wait or change the limit. */
export function RunLimitPrompt({ openSettings }: { openSettings(): void }): React.JSX.Element | null {
  const t = useT(), tr = t.settings.dialog.runLimit
  const [queued, setQueued] = useState<{ runId: string; active: number; limit: number }>(), [error, setError] = useState('')
  useEffect(() => window.gearmod.onRunEvent((event) => {
    if (event.eventType !== 'gearmod/run-queued') return
    setError(''); setQueued({ runId: event.runId, active: Number(event.payload.active), limit: Number(event.payload.limit) })
  }), [])
  // If the queue moved on its own (a run finished), the question no longer makes sense.
  useEffect(() => window.gearmod.onRunEvent((event) => { if (queued && event.runId === queued.runId && event.eventType === 'gearmod/run-started') setQueued(undefined) }), [queued])
  const dismiss = (): void => setQueued(undefined)
  useEscape(dismiss, Boolean(queued))
  if (!queued) return null
  const runNow = (): void => { void window.gearmod.invoke('agents:run-now', { runId: queued.runId }).then(dismiss).catch((reason: unknown) => setError(plainError(reason))) }
  return <div className="overlay top" role="alertdialog" aria-label={tr.title}><div className="modal" style={{ width: 'min(460px,100%)' }}>
    <header><div><div className="eyebrow">{tr.eyebrow}</div><h2>{tr.title}</h2></div></header>
    <p className="dialog-text">{tr.text(queued.active, queued.limit)}</p>
    {error && <p className="error">{error}</p>}
    <div className="actions"><button type="button" className="secondary" onClick={dismiss}>{tr.keepQueued}</button><button type="button" className="secondary" onClick={() => { dismiss(); openSettings() }}>{tr.changeLimit}</button><button type="button" onClick={runNow}>{tr.runNow}</button></div>
  </div></div>
}
