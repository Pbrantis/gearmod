import React, { useEffect, useState } from 'react'
import { useEscape } from './useEscape'
import { plainError } from './NoticeDialog'
import { useT } from './i18n'

interface Candidate { cardId: string; title: string; branch: string; path: string }

/** Choose another card's worktree for this one to use (see its Changes and Git, and work there), instead of creating a new one. */
export function LinkWorktreeDialog({ cardId, close, linked }: { cardId: string; close(): void; linked(): void }): React.JSX.Element {
  const { board: t, common } = useT()
  const [items, setItems] = useState<Candidate[]>(), [error, setError] = useState(''), [busy, setBusy] = useState<string>()
  useEffect(() => { void window.gearmod.invoke('worktrees:candidates', { cardId }).then(setItems).catch(() => setItems([])) }, [cardId])
  useEscape(close)
  const pick = (item: Candidate): void => {
    setBusy(item.cardId); setError('')
    void window.gearmod.invoke('worktrees:link', { cardId, fromCardId: item.cardId }).then(() => { window.dispatchEvent(new Event('gearmod:board-changed')); linked() }).catch((reason: unknown) => { setError(plainError(reason)); setBusy(undefined) })
  }
  return <div className="overlay top" role="dialog" aria-label={t.linkWorktree.title} onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <div className="modal" style={{ width: 'min(520px,100%)' }}>
      <header><div><div className="eyebrow">Worktree</div><h2>{t.linkWorktree.heading}</h2></div><button className="x" onClick={close} aria-label={common.close}>×</button></header>
      <p className="hint" style={{ marginTop: 0 }}>{t.linkWorktree.hint}</p>
      <div className="archlist">
        {items === undefined && <div className="emptyBox">{common.loading}</div>}
        {items?.length === 0 && <div className="emptyBox">{t.linkWorktree.none}</div>}
        {items?.map((item) => <div className="archrow" key={item.cardId}><span data-tip={item.path}><b>{item.title || t.untitled}</b><br /><small className="hint">{item.branch}</small></span><button type="button" className="mini secondary" disabled={Boolean(busy)} onClick={() => pick(item)}>{busy === item.cardId ? t.linkWorktree.linking : t.linkWorktree.useThis}</button></div>)}
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
    </div>
  </div>
}
