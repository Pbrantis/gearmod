import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Card } from '@agentboard/contracts'
import { ChatIcon, EyeIcon, TrashIcon } from './icons'

interface Item { key: string; label: string; hint: string; icon: React.ReactNode; danger?: boolean; run(): void }

/** Menu do botão direito no card: abrir, ir para o chat e excluir, com atalho por letra (A, C, E). */
export function CardContextMenu({ x, y, card, open, chat, remove, close }: { x: number; y: number; card: Card; open(): void; chat(): void; remove(): void; close(): void }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null), [pos, setPos] = useState({ left: x, top: y }), [active, setActive] = useState(0)
  const items: Item[] = [
    { key: 'a', label: 'Abrir card', hint: 'A', icon: <EyeIcon />, run: open },
    { key: 'c', label: 'Ir para o chat do card', hint: 'C', icon: <ChatIcon />, run: chat },
    { key: 'e', label: 'Excluir card', hint: 'E', icon: <TrashIcon />, danger: true, run: remove }
  ]
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect(); if (!box) return
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) })
  }, [x, y])
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => (value + 1) % items.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => (value + items.length - 1) % items.length); return }
      if (event.key === 'Enter') { event.preventDefault(); items[active]!.run(); return }
      const hit = items.find((item) => item.key === event.key.toLowerCase()); if (hit && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); hit.run() }
    }
    const away = (event: MouseEvent): void => { if (!root.current?.contains(event.target as Node)) close() }
    document.addEventListener('keydown', key, true); document.addEventListener('mousedown', away); window.addEventListener('blur', close); window.addEventListener('resize', close)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', away); window.removeEventListener('blur', close); window.removeEventListener('resize', close) }
  })
  return <div className="ctxmenu" ref={root} role="menu" aria-label={`Ações do card ${card.title || 'Novo card'}`} style={pos} onContextMenu={(event) => event.preventDefault()}>
    <div className="ctxtitle">{card.title || 'Novo card'}</div>
    {items.map((item, index) => <React.Fragment key={item.key}>
      {item.danger && <div className="ctxsep" />}
      <button type="button" role="menuitem" className={`ctxitem ${item.danger ? 'danger' : ''} ${index === active ? 'on' : ''}`} onMouseEnter={() => setActive(index)} onClick={item.run}>{item.icon}<span>{item.label}</span><kbd>{item.hint}</kbd></button>
    </React.Fragment>)}
  </div>
}
