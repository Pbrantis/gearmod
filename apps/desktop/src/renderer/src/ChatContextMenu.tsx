import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Chat } from '@agentboard/contracts'
import { BoardIcon, TrashIcon } from './icons'

/** Chats vinculados ao card fazem parte do histórico e não podem ser apagados isoladamente. */
export function ChatContextMenu({ x, y, chat, cardTitle, openCard, remove, close }: { x: number; y: number; chat: Chat; cardTitle?: string; openCard?(): void; remove(): void; close(): void }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null), [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect(); if (!box) return
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) })
    root.current?.focus()
  }, [x, y])
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      else if (chat.cardId && openCard && (event.key === 'Enter' || event.key.toLowerCase() === 'c')) { event.preventDefault(); openCard() }
      else if (!chat.cardId && (event.key === 'Enter' || event.key.toLowerCase() === 'a')) { event.preventDefault(); remove() }
    }
    const away = (event: MouseEvent): void => { if (!root.current?.contains(event.target as Node)) close() }
    document.addEventListener('keydown', key, true); document.addEventListener('mousedown', away); window.addEventListener('blur', close); window.addEventListener('resize', close)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', away); window.removeEventListener('blur', close); window.removeEventListener('resize', close) }
  }, [close, remove, openCard, chat.cardId])
  return <div className="ctxmenu" ref={root} role="menu" tabIndex={-1} aria-label={`Ações do chat ${cardTitle || chat.title || 'Conversa livre'}`} style={pos} onContextMenu={(event) => event.preventDefault()}>
    <div className="ctxtitle">{cardTitle || chat.title || (chat.purpose === 'constitution' ? 'Constituição do projeto' : 'Conversa livre')}</div>
    {chat.cardId && openCard && <button type="button" role="menuitem" className="ctxitem on" onClick={openCard}><BoardIcon /><span>Abrir card</span><kbd>C</kbd></button>}
    <button type="button" role="menuitem" className={`ctxitem danger ${chat.cardId ? '' : 'on'}`} disabled={Boolean(chat.cardId)} title={chat.cardId ? 'Chats de cards fazem parte do histórico e não podem ser apagados separadamente.' : undefined} onClick={remove}><TrashIcon /><span>Apagar chat</span>{!chat.cardId && <kbd>A</kbd>}</button>
    {chat.cardId && <p className="chat-menu-note">Este chat faz parte do histórico do card e não pode ser apagado separadamente.</p>}
  </div>
}
