import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentPurpose, Card, Chat, ProjectBoard } from '@agentboard/contracts'

const stepLabel: Record<AgentPurpose, string> = { planning: 'Planejamento', execution: 'Implementação', test: 'Teste' }

/** Lista de todos os chats do projeto: os livres (sem chip) e os de cada card (com o chip do card). Abre pelo botão ao lado da configuração. */
export function ChatsPanel({ board, close, openCard, openFree }: { board: ProjectBoard; close(): void; openCard(card: Card, purpose: AgentPurpose): void; openFree(chat?: Chat): void }): React.JSX.Element {
  const [chats, setChats] = useState<Chat[]>([]), root = useRef<HTMLDivElement>(null)
  const load = useCallback(async () => { try { setChats(await window.agentboard.invoke('chats:list', { projectId: board.project.id })) } catch { /* lista é informativa */ } }, [board.project.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (event.eventType === 'agentboard/run-started' || event.eventType === 'agentboard/run-completed') void load() }), [load])
  useEffect(() => {
    const away = (event: MouseEvent): void => { const target = event.target as HTMLElement; if (!root.current?.contains(target) && !target.closest('.chatsbtn')) close() }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key) }
  }, [close])
  const rows = chats.map((chat) => ({ chat, card: chat.cardId ? board.cards.find((item) => item.id === chat.cardId) : undefined })).filter(({ chat, card }) => chat.purpose === 'free' || card)
    .sort((a, b) => Number(b.chat.busy) - Number(a.chat.busy) || b.chat.updatedAt.localeCompare(a.chat.updatedAt))
  return <div className="chatspop" ref={root} role="dialog" aria-label="Chats">
    <div className="cphead"><span className="sectitle">Chats</span><button type="button" className="mini" onClick={() => openFree()}>＋ Novo chat livre</button></div>
    <div className="cplist">
      {rows.map(({ chat, card }) => <button type="button" className="cprow" key={chat.id} onClick={() => (chat.purpose === 'free' ? openFree(chat) : card && openCard(card, chat.purpose))}>
        <span className="cpt"><b>{chat.purpose === 'free' ? chat.title || 'Conversa livre' : stepLabel[chat.purpose]}</b><em className={`cpchip ${card ? '' : 'free'}`}>{card ? card.title || 'Novo card' : 'Chat livre'}</em></span>
        {chat.busy && <span className="spin sm" aria-label="Executando" />}
      </button>)}
      {!rows.length && <p className="hint" style={{ padding: 10 }}>Nenhum chat ainda. Comece um chat livre ou abra o chat de um card.</p>}
    </div>
  </div>
}
