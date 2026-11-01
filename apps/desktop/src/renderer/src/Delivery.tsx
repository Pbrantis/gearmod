import React, { useState } from 'react'
import type { Card, ProjectSource } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { Checkbox } from './Checkbox'
import { useT } from './i18n'

/**
 * Em quais repositórios o card trabalha: só eles ganham worktree. Mostra só os marcados, como etiquetas; o lápis abre a lista para marcar.
 * Nenhum marcado = todos (como era antes). `bare` = sem título, para ficar dentro do bloco de branch e worktree.
 */
export function RepoChooser({ card, sources, changed, bare = false }: { card: Card; sources: ProjectSource[]; changed(card: Card): void; bare?: boolean }): React.JSX.Element {
  const t = useT().board.delivery
  const [error, setError] = useState(''), [editing, setEditing] = useState(false), chosen = card.repoIds ?? []
  const toggle = async (id: string): Promise<void> => {
    const next = chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id]
    try { changed(await window.agentboard.invoke('cards:set-repos', { cardId: card.id, sourceIds: next.length ? next : null })); setError('') } catch (reason) { setError(plainError(reason)) }
  }
  const marked = sources.filter((source) => chosen.includes(source.id))
  const body = <>
    <div className="repochips">
      {marked.length ? marked.map((source) => <span key={source.id} className="repochip">{source.name}</span>) : <span className="repochip all" data-tip={t.noneMarkedTip}>{t.allRepos}</span>}
      <button type="button" className="repochip edit tip" data-tip={editing ? t.closeList : t.chooseRepos} aria-label={t.chooseRepos} aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? '×' : '✎'}</button>
    </div>
    {editing && <div className="cx-repos">{sources.map((source) => <label key={source.id} className="ck-line"><Checkbox checked={chosen.includes(source.id)} onChange={() => void toggle(source.id)} /> {source.name}</label>)}
      <small className="cx-muted">{chosen.length ? t.onlyMarked : t.noneMarkedTip}</small></div>}
    {error && <small className="cx-warn">{error}</small>}
  </>
  return bare ? <div className="repobare">{body}</div> : <div className="f"><span>{t.cardRepos}</span>{body}</div>
}
