import React, { useEffect, useRef, useState } from 'react'
import { useFitInView } from './useFitInView'

export type LayoutPosition = 'left' | 'right' | 'top' | 'bottom'
const labels: Record<LayoutPosition, string> = { left: 'Esquerda', right: 'Direita', top: 'Em cima', bottom: 'Embaixo' }
export function WindowIcon(): React.JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2.5" /><path d="M3 7h14M5 5h.1M7 5h.1" /></svg>
}
/** Mesmo desenho e mesmas opções para posicionar painéis e janelas. Maximizar e restaurar ficam por conta do botão do sistema. */
export function WindowLayoutMenu({ move, detach, detachDisabled = false, closeWindow, className = '' }: { move(position: LayoutPosition): void; detach?(): void; detachDisabled?: boolean; closeWindow?(): void; className?: string }): React.JSX.Element {
  const [open, setOpen] = useState(false), box = useRef<HTMLSpanElement>(null), menu = useRef<HTMLDivElement>(null)
  useFitInView(menu, open)
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent): void => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key) }
  }, [open])
  const run = (action: () => void): void => { setOpen(false); action() }
  return <span className={`popwrap windowlayout ${className}`} ref={box}>
    <button type="button" className="ibtn tip" data-tip="Mover e organizar janela" aria-label="Janelas" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><WindowIcon /></button>
    {open && <div className="popmenu" ref={menu} role="menu" aria-label="Mover e organizar">
      <div className="pm-label">Mover</div><div className="pm-row">{(Object.keys(labels) as LayoutPosition[]).map((position) => <button type="button" role="menuitem" key={position} className="pm-ic tip" data-tip={labels[position]} aria-label={labels[position]} onClick={() => run(() => move(position))}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2.5" /><rect x={position === 'right' ? 11 : 3} y={position === 'bottom' ? 11 : 4} width={position === 'left' || position === 'right' ? 6 : 14} height={position === 'top' || position === 'bottom' ? 5 : 12} rx="1.5" fill="currentColor" /></svg></button>)}</div>
      {(detach || closeWindow) && <div className="pm-sep" />}
      {detach && <button type="button" role="menuitem" className="pm-item pm-ico" disabled={detachDisabled} onClick={() => run(detach)}><WindowIcon />Abrir em nova janela</button>}
      {closeWindow && <button type="button" role="menuitem" className="pm-item" onClick={() => run(closeWindow)}>Fechar esta janela</button>}
    </div>}
  </span>
}
