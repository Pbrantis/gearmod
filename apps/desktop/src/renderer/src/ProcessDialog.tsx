import React from 'react'
import { useTasks } from './backgroundTasks'
import { useEscape } from './useEscape'
import { useT } from './i18n'

/**
 * Progress dialog for a long process. While it runs, "Follow in the background" closes the dialog and the process continues
 * in the title bar list; when it finishes, it shows the result and the close button.
 */
export function ProcessDialog({ taskId, title, log, background, close }: { taskId: string; title: string; log?: string; background(): void; close(): void }): React.JSX.Element | null {
  const t = useT(), task = useTasks().find((item) => item.id === taskId)
  useEscape(() => { if (task?.state === 'running') background(); else close() })
  if (!task) return null
  const tail = (log ?? '').trim().split(/\r?\n/).slice(-10).join('\n')
  return <div className="overlay top" role="alertdialog" aria-label={title}><div className="modal" style={{ width: 'min(520px,100%)' }}>
    <header><div><div className="eyebrow">{task.state === 'running' ? t.shell.process.running : task.state === 'done' ? t.shell.process.done : t.shell.process.failed}</div><h2>{title}</h2></div></header>
    <div className="stack" style={{ gap: 10 }}>
      <div className={`proc-state ${task.state}`}>{task.state === 'running' ? <><span className="spin" /> <span>{t.shell.process.runningText(task.detail)}</span></> : task.state === 'done' ? <span>{t.shell.process.allGood(task.detail)}</span> : <span className="error">{task.error ?? t.shell.process.couldNotFinish}</span>}</div>
      {tail && <pre className="proc-log" aria-label={t.shell.process.lastLines}>{tail}</pre>}
    </div>
    <div className="actions">{task.state === 'running' ? <button type="button" onClick={background}>{t.shell.process.followInBackground}</button> : <button type="button" onClick={close}>{t.common.close}</button>}</div>
  </div></div>
}
