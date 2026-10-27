import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Chat } from '@agentboard/contracts'
import { TrashIcon } from './icons'

/** Menu do botão direito de chats sem card. O backend também impede excluir qualquer chat que pertença a um card. */
export function ChatContextMenu({ x, y, chat, remove, close }: { x: number; y: number; chat: Chat; remove(): void; close(): void }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null), [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect(); if (!box) return
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) })
  }, [x, y])
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      else if (event.key === 'Enter' || event.key.toLowerCase() === 'a') { event.preventDefault(); remove() }
    }
    const away = (event: MouseEvent): void => { if (!root.current?.contains(event.target as Node)) close() }
    document.addEventListener('keydown', key, true); document.addEventListener('mousedown', away); window.addEventListener('blur', close); window.addEventListener('resize', close)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', away); window.removeEventListener('blur', close); window.removeEventListener('resize', close) }
  }, [close, remove])
  return <div className="ctxmenu" ref={root} role="menu" aria-label={`Ações do chat ${chat.title || 'Conversa livre'}`} style={pos} onContextMenu={(event) => event.preventDefault()}>
    <div className="ctxtitle">{chat.title || (chat.purpose === 'constitution' ? 'Constituição do projeto' : 'Conversa livre')}</div>
    <button type="button" role="menuitem" className="ctxitem danger on" onClick={remove}><TrashIcon /><span>Apagar chat</span><kbd>A</kbd></button>
  </div>
}
