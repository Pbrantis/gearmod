import React from 'react'
import { useEscape } from './useEscape'
import { useT } from './i18n'

export function ConfirmDialog({ eyebrow, title, text, ok, danger = false, okDisabled = false, extra, secondary, cancel, confirm }: { eyebrow: string; title: string; text: string; ok: string; danger?: boolean; okDisabled?: boolean; extra?: React.ReactNode; secondary?: { label: string; run(): void }; cancel(): void; confirm(): void }): React.JSX.Element {
  const t = useT()
  useEscape(cancel)
  return <div className="overlay top" role="alertdialog" aria-label={title}><div className="modal" style={{ width: 'min(430px,100%)' }}><header><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div></header><p className="dialog-text">{text}</p>{extra}<div className="actions"><button type="button" className="secondary" onClick={cancel}>{t.common.cancel}</button>{secondary && <button type="button" className="secondary" onClick={secondary.run}>{secondary.label}</button>}<button type="button" className={danger ? 'danger solid' : ''} disabled={okDisabled} onClick={confirm}>{ok}</button></div></div></div>
}
