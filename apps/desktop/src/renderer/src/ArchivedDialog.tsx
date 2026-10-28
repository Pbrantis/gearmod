import React, { useEffect, useState } from 'react'
import type { Card } from '@agentboard/contracts'

/** Lista dos cards arquivados do projeto, com Restaurar. Abre pelo botão "Arquivados" da página de chats. */
export function ArchivedDialog({ cards, close, restore }: { cards: Card[]; close(): void; restore(card: Card): Promise<void> }): React.JSX.Element {
  const [query, setQuery] = useState(''), [busy, setBusy] = useState<string>()
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); close() } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [close])
  const shown = cards.filter((card) => (card.title || 'Sem título').toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="overlay top" role="dialog" aria-label="Cards arquivados" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <div className="modal" style={{ width: 'min(560px,100%)' }}>
      <header><div><div className="eyebrow">Quadro</div><h2>Arquivados ({cards.length})</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
      {cards.length > 6 && <input className="in" type="search" placeholder="Buscar arquivado…" aria-label="Buscar arquivado" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />}
      <div className="archlist">
        {!cards.length && <div className="emptyBox">Nenhum card arquivado.</div>}
        {cards.length > 0 && !shown.length && <div className="emptyBox">Nenhum card encontrado.</div>}
        {shown.map((card) => <div className="archrow" key={card.id}><span title={card.title}>{card.title || 'Sem título'}</span><button type="button" className="mini secondary" disabled={busy === card.id} onClick={() => { setBusy(card.id); void restore(card).finally(() => setBusy(undefined)) }}>Restaurar</button></div>)}
      </div>
    </div>
  </div>
}
