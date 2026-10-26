import React, { useEffect } from 'react'

export function ConfirmDialog({ eyebrow, title, text, ok, danger = false, okDisabled = false, extra, cancel, confirm }: { eyebrow: string; title: string; text: string; ok: string; danger?: boolean; okDisabled?: boolean; extra?: React.ReactNode; cancel(): void; confirm(): void }): React.JSX.Element {
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); cancel() } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [cancel])
  return <div className="overlay top" role="alertdialog" aria-label={title}><div className="modal" style={{ width: 'min(430px,100%)' }}><header><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div></header><p style={{ fontSize: 13, lineHeight: 1.5, color: '#cbd3cd' }}>{text}</p>{extra}<div className="actions"><button type="button" className="secondary" onClick={cancel}>Cancelar</button><button type="button" className={danger ? 'danger solid' : ''} disabled={okDisabled} onClick={confirm}>{ok}</button></div></div></div>
}
