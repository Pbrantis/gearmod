import React, { useState } from 'react'
import type { Card, GitCard, ProjectSource } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { ConfirmDialog } from './ConfirmDialog'
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

/**
 * Entrega por repositório (worktrees coordenados): estado de cada worktree, o que falta para o card estar entregue e um PR por repositório.
 * A entrega não é atômica: um repositório com falha não desfaz os outros, mas o card não vai para Done até ele ficar pronto.
 */
export function Delivery({ cardId, data, reload }: { cardId: string; data: GitCard; reload(): Promise<void> }): React.JSX.Element | null {
  const t = useT().board.delivery
  const [busy, setBusy] = useState(false), [confirming, setConfirming] = useState(false), [results, setResults] = useState<Array<{ repo: string; url: string | null; error: string | null }>>([]), [error, setError] = useState('')
  if (!data.repos.length) return null
  // Só entram os repositórios em que o card mexeu (commits, alterações, PR ou problema); os intocados ficam de fora.
  const touched = data.repos.filter((repo) => repo.ahead > 0 || repo.files.length > 0 || repo.prUrl || repo.state !== 'active'), untouched = data.repos.length - touched.length
  const withCommits = data.repos.filter((repo) => repo.ahead > 0 && repo.state === 'active')
  const open = async (): Promise<void> => {
    setConfirming(false); setBusy(true); setError('')
    try { setResults((await window.agentboard.invoke('git:create-prs', { cardId, draft: true })).results); await reload() } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) }
  }
  const link = (url: string): React.JSX.Element => <button type="button" className="ghost" onClick={() => { void window.agentboard.invoke('git:open-pr', { cardId, url }).catch((reason) => setError(plainError(reason))) }}>{url.replace(/^https?:\/\//, '')}</button>
  return <div className="cx-delivery">
    <div className="cx-dhead"><b>{t.title}</b><span className={`cx-status ${data.delivery.complete ? 'approved' : 'proposed'}`}>{data.delivery.complete ? t.allReady : t.pending}</span></div>
    <ul>{touched.map((repo) => <li key={repo.sourceId}><span className={`cx-dot ${repo.state === 'active' ? 'simple' : 'complex'}`} /><b>{repo.name}</b> <small>{t.repoState[repo.state]} · {t.commitCount(repo.ahead)}{repo.files.length ? ` · ${t.uncommitted(repo.files.length)}` : ''}</small>{repo.prUrl && <> · PR {link(repo.prUrl)}</>}{repo.error && <div className="cx-warn">{repo.error}</div>}</li>)}</ul>
    {!touched.length && <div className="cx-muted">{t.noRepoTouched}</div>}
    {untouched > 0 && touched.length > 0 && <div className="cx-muted">{t.untouchedNote(untouched)}</div>}
    {data.delivery.pending.length > 0 && <div className="cx-muted">{t.missing(data.delivery.pending.join(' · '))}</div>}
    <div className="cx-actions"><button type="button" className="mini secondary" disabled={busy || !withCommits.length} onClick={() => setConfirming(true)}>{busy ? t.openingPrs : t.openPrs(withCommits.length)}</button></div>
    {results.length > 0 && <ul className="cx-muted">{results.map((item) => <li key={item.repo}>{item.repo}: {item.url ? link(item.url) : item.error}</li>)}</ul>}
    {error && <div className="cx-error">{error}</div>}
    {confirming && <ConfirmDialog eyebrow={t.confirmEyebrow} title={t.confirmTitle(withCommits.length)} text={t.confirmText(data.branch ?? '', withCommits.map((repo) => repo.name).join(', '))} ok={t.publishAndOpen} cancel={() => setConfirming(false)} confirm={() => void open()} />}
  </div>
}
