import React, { useState } from 'react'
import type { Card, GitCard, ProjectSource } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { Checkbox } from './Checkbox'

/**
 * Em quais repositórios o card trabalha: só eles ganham worktree. Mostra só os marcados, como etiquetas; o lápis abre a lista para marcar.
 * Nenhum marcado = todos (como era antes). `bare` = sem título, para ficar dentro do bloco de branch e worktree.
 */
export function RepoChooser({ card, sources, changed, bare = false }: { card: Card; sources: ProjectSource[]; changed(card: Card): void; bare?: boolean }): React.JSX.Element {
  const [error, setError] = useState(''), [editing, setEditing] = useState(false), chosen = card.repoIds ?? []
  const toggle = async (id: string): Promise<void> => {
    const next = chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id]
    try { changed(await window.agentboard.invoke('cards:set-repos', { cardId: card.id, sourceIds: next.length ? next : null })); setError('') } catch (reason) { setError(plainError(reason)) }
  }
  const marked = sources.filter((source) => chosen.includes(source.id))
  const body = <>
    <div className="repochips">
      {marked.length ? marked.map((source) => <span key={source.id} className="repochip">{source.name}</span>) : <span className="repochip all" title="Nenhum marcado: a worktree é criada em todos os repositórios do projeto.">todos os repositórios</span>}
      <button type="button" className="repochip edit tip" data-tip={editing ? 'Fechar a lista' : 'Escolher repositórios'} aria-label="Escolher repositórios" aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? '×' : '✎'}</button>
    </div>
    {editing && <div className="cx-repos">{sources.map((source) => <label key={source.id} className="ck-line"><Checkbox checked={chosen.includes(source.id)} onChange={() => void toggle(source.id)} /> {source.name}</label>)}
      <small className="cx-muted">{chosen.length ? 'A worktree só é criada nos marcados; o agente pode incluir outro durante a execução.' : 'Nenhum marcado: a worktree é criada em todos os repositórios do projeto.'}</small></div>}
    {error && <small className="cx-warn">{error}</small>}
  </>
  return bare ? <div className="repobare">{body}</div> : <div className="f"><span>Repositórios do card</span>{body}</div>
}

const stateLabel = { active: 'pronto', failed: 'falhou', missing: 'pasta sumiu' } as const

/**
 * Entrega por repositório (worktrees coordenados): estado de cada worktree, o que falta para o card estar entregue e um PR por repositório.
 * A entrega não é atômica: um repositório com falha não desfaz os outros, mas o card não vai para Done até ele ficar pronto.
 */
export function Delivery({ cardId, data, reload }: { cardId: string; data: GitCard; reload(): Promise<void> }): React.JSX.Element | null {
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
    <div className="cx-dhead"><b>Entrega por repositório</b><span className={`cx-status ${data.delivery.complete ? 'approved' : 'proposed'}`}>{data.delivery.complete ? 'tudo pronto' : 'pendente'}</span></div>
    <ul>{touched.map((repo) => <li key={repo.sourceId}><span className={`cx-dot ${repo.state === 'active' ? 'simple' : 'complex'}`} /><b>{repo.name}</b> <small>{stateLabel[repo.state]} · {repo.ahead} commit{repo.ahead === 1 ? '' : 's'}{repo.files.length ? ` · ${repo.files.length} sem commit` : ''}</small>{repo.prUrl && <> · PR {link(repo.prUrl)}</>}{repo.error && <div className="cx-warn">{repo.error}</div>}</li>)}</ul>
    {!touched.length && <div className="cx-muted">O card ainda não mexeu em nenhum repositório.</div>}
    {untouched > 0 && touched.length > 0 && <div className="cx-muted">{untouched} {untouched === 1 ? 'repositório sem alterações' : 'repositórios sem alterações'} não aparece{untouched === 1 ? '' : 'm'} aqui.</div>}
    {data.delivery.pending.length > 0 && <div className="cx-muted">Falta: {data.delivery.pending.join(' · ')}</div>}
    <div className="cx-actions"><button type="button" className="mini secondary" disabled={busy || !withCommits.length} onClick={() => setConfirming(true)}>{busy ? 'Abrindo PRs…' : `Abrir PR${withCommits.length > 1 ? 's' : ''} (rascunho)`}</button></div>
    {results.length > 0 && <ul className="cx-muted">{results.map((item) => <li key={item.repo}>{item.repo}: {item.url ? link(item.url) : item.error}</li>)}</ul>}
    {error && <div className="cx-error">{error}</div>}
    {confirming && <ConfirmDialog eyebrow="Pull requests" title={`Publicar e abrir ${withCommits.length} PR${withCommits.length > 1 ? 's' : ''}?`} text={`A branch ${data.branch ?? ''} será enviada ao origin de ${withCommits.map((repo) => repo.name).join(', ')} e um PR em rascunho será aberto em cada um (GitHub pelo gh, GitLab pelo glab). Repositórios sem commits ficam de fora.`} ok="Publicar e abrir" cancel={() => setConfirming(false)} confirm={() => void open()} />}
  </div>
}
