import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { AgentPurpose, Card, Chat, ProjectBoard } from '@agentboard/contracts'
import { ChatIcon, SparkIcon } from './icons'

const stepLabel: Record<AgentPurpose, string> = { planning: 'Planejamento', execution: 'Implementação', test: 'Teste' }

const ago = (iso: string): string => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.round(hours / 24)
  return days === 1 ? 'ontem' : `há ${days} dias`
}

/** Página de chats do projeto (no lugar do quadro): busca, novo chat e a lista de todos os chats, livres e de cada card. */
export function ChatsPage({ board, openCard, openFree, current }: { board: ProjectBoard; openCard(card: Card, purpose: AgentPurpose): void; openFree(chat?: Chat): void; current?: string }): React.JSX.Element {
  const [chats, setChats] = useState<Chat[]>([]), [query, setQuery] = useState(''), [filter, setFilter] = useState<'all' | 'free' | 'card'>('all'), [loaded, setLoaded] = useState(false)
  const load = useCallback(async () => { try { setChats(await window.agentboard.invoke('chats:list', { projectId: board.project.id })) } catch { /* lista é informativa */ } finally { setLoaded(true) } }, [board.project.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (['agentboard/run-started', 'agentboard/run-completed', 'agentboard/tool-activity'].includes(event.eventType)) void load() }), [load])
  const rows = useMemo(() => chats.map((chat) => ({ chat, card: chat.cardId ? board.cards.find((item) => item.id === chat.cardId) : undefined }))
    .filter(({ chat, card }) => (chat.purpose === 'free' || card) && (filter === 'all' || (filter === 'free') === (chat.purpose === 'free')))
    .filter(({ chat, card }) => { const text = `${chat.title ?? ''} ${card?.title ?? ''} ${chat.purpose === 'free' ? 'chat livre' : stepLabel[chat.purpose]}`.toLowerCase(); return text.includes(query.trim().toLowerCase()) })
    .sort((a, b) => Number(b.chat.busy) - Number(a.chat.busy) || b.chat.updatedAt.localeCompare(a.chat.updatedAt)), [chats, board.cards, query, filter])
  return <section className="chatspage" aria-label="Chats do projeto">
    <div className="cptools">
      <input className="in cpsearch" type="search" placeholder="Buscar chat…" aria-label="Buscar chat" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <div className="tabs" role="tablist">{([['all', 'Todos'], ['free', 'Livres'], ['card', 'De cards']] as const).map(([value, label]) => <button type="button" key={value} role="tab" aria-selected={filter === value} className={`tab ${filter === value ? 'on' : ''}`} onClick={() => setFilter(value)}>{label}</button>)}</div>
      <button type="button" className="cpnew" onClick={() => openFree()}><SparkIcon />Novo chat</button>
    </div>
    <div className="cplistpage">
      {rows.map(({ chat, card }) => <button type="button" className={`cpitem ${current === chat.id ? 'on' : ''}`} key={chat.id} onClick={() => (chat.purpose === 'free' ? openFree(chat) : card && openCard(card, chat.purpose))}>
        <span className="cpico"><ChatIcon /></span>
        <span className="cpmain"><b>{chat.purpose === 'free' ? chat.title || 'Conversa livre' : card?.title || 'Novo card'}</b>
          <span className="cpmeta"><em className={`cpchip ${card ? '' : 'free'}`}>{chat.purpose === 'free' ? 'Chat livre' : stepLabel[chat.purpose]}</em>{!!card && chat.purpose !== 'free' && <span>{board.columns.find((column) => column.id === card.columnId)?.label}</span>}<span>{ago(chat.updatedAt)}</span></span></span>
        {chat.busy && <span className="spin sm" aria-label="Executando" />}
      </button>)}
      {loaded && !rows.length && <div className="emptyBox cpempty">{query || filter !== 'all' ? 'Nenhum chat encontrado.' : 'Nenhum chat ainda. Comece uma conversa solta com “Novo chat” ou abra o chat de um card.'}</div>}
    </div>
  </section>
}
