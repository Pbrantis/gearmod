import React, { useEffect } from 'react'

/** Aviso na frente de tudo (um botão só): para explicar por que uma ação não foi feita, ou o que aconteceu por baixo dos panos. */
export function NoticeDialog({ eyebrow, title, text, ok = 'Entendi', close }: { eyebrow: string; title: string; text: string; ok?: string; close(): void }): React.JSX.Element {
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape' || event.key === 'Enter') { event.stopPropagation(); close() } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [close])
  return <div className="overlay top" role="alertdialog" aria-label={title} style={{ zIndex: 90 }}><div className="modal" style={{ width: 'min(430px,100%)' }}><header><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div></header><p style={{ fontSize: 13, lineHeight: 1.5, color: '#cbd3cd' }}>{text}</p><div className="actions"><button type="button" autoFocus onClick={close}>{ok}</button></div></div></div>
}

/** Tira o prefixo técnico do Electron das mensagens de erro do main. */
export const plainError = (reason: unknown): string => String(reason).replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, '')
