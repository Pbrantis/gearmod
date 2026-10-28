import React, { useEffect, useState } from 'react'

interface Candidate { cardId: string; title: string; branch: string; path: string }

/** Escolher a worktree de outro card para este usar (ver Alterações e Git dela, e trabalhar lá), em vez de criar uma nova. */
export function LinkWorktreeDialog({ cardId, close, linked }: { cardId: string; close(): void; linked(): void }): React.JSX.Element {
  const [items, setItems] = useState<Candidate[]>(), [error, setError] = useState(''), [busy, setBusy] = useState<string>()
  useEffect(() => { void window.agentboard.invoke('worktrees:candidates', { cardId }).then(setItems).catch(() => setItems([])) }, [cardId])
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); close() } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [close])
  const pick = (item: Candidate): void => {
    setBusy(item.cardId); setError('')
    void window.agentboard.invoke('worktrees:link', { cardId, fromCardId: item.cardId }).then(() => { window.dispatchEvent(new Event('agentboard:board-changed')); linked() }).catch((reason: unknown) => { setError(String(reason).replace(/^Error: /, '')); setBusy(undefined) })
  }
  return <div className="overlay top" role="dialog" aria-label="Usar worktree de outro card" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <div className="modal" style={{ width: 'min(520px,100%)' }}>
      <header><div><div className="eyebrow">Worktree</div><h2>Usar a worktree de outro card</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
      <p className="hint" style={{ marginTop: 0 }}>Este card passa a ver e a trabalhar na pasta de outro card (Alterações, Git e testes). A worktree continua sendo do card dono: a limpeza e o merge dela não mudam.</p>
      <div className="archlist">
        {items === undefined && <div className="emptyBox">Carregando…</div>}
        {items?.length === 0 && <div className="emptyBox">Nenhum outro card deste projeto tem uma worktree ativa.</div>}
        {items?.map((item) => <div className="archrow" key={item.cardId}><span title={item.path}><b>{item.title || 'Sem título'}</b><br /><small className="hint">{item.branch}</small></span><button type="button" className="mini secondary" disabled={Boolean(busy)} onClick={() => pick(item)}>{busy === item.cardId ? 'Vinculando…' : 'Usar esta'}</button></div>)}
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  </div>
}
