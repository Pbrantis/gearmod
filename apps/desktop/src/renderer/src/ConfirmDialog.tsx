import React from 'react'

export function ConfirmDialog({ eyebrow, title, text, ok, danger = false, cancel, confirm }: { eyebrow: string; title: string; text: string; ok: string; danger?: boolean; cancel(): void; confirm(): void }): React.JSX.Element {
  return <div className="overlay top" role="alertdialog" aria-label={title}><div className="modal confirm"><header><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></header><p>{text}</p><div className="actions"><button type="button" className="secondary" onClick={cancel}>Cancelar</button><button type="button" className={danger ? 'dangerButton solid' : ''} onClick={confirm}>{ok}</button></div></div></div>
}
