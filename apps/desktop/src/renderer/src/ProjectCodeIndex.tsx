import React, { useEffect, useState } from 'react'
import type { CodeIndexStatus, Project } from '@gearmod/contracts'
import { Switch } from './Switch'
import { plainError } from './NoticeDialog'
import { shortAgo } from './gitView'
import { dateLocale, useT } from './i18n'

const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** Seção da tela do projeto: liga ou desliga o índice de código e mostra o estado de cada pasta indexada. */
export function ProjectCodeIndex({ project }: { project: Project }): React.JSX.Element {
  const t = useT().settings.codeIndex
  const [status, setStatus] = useState<CodeIndexStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [queue, setQueue] = useState<{ roots: string[]; done: number } | null>(null)
  useEffect(() => {
    let alive = true
    void window.gearmod.invoke('code-index:status', { projectId: project.id, cardId: null }).then((value) => { if (alive) setStatus(value) }).catch((reason) => { if (alive) setError(plainError(reason)) })
    return () => { alive = false }
  }, [project.id])
  const run = async (action: () => Promise<CodeIndexStatus>): Promise<void> => {
    setBusy(true); setError('')
    try { setStatus(await action()) } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) }
  }
  const toggle = (enabled: boolean): void => { setStatus((current) => current ? { ...current, enabled } : current); void run(() => window.gearmod.invoke('code-index:set-enabled', { projectId: project.id, enabled })) }
  /** Indexa as pastas uma por vez para a tela mostrar quem está indexando, quem espera e quantas já terminaram. */
  const reindex = async (): Promise<void> => {
    if (!status) return
    const roots = status.roots.map((root) => root.root)
    setBusy(true); setError(''); setQueue({ roots, done: 0 })
    try {
      for (const [index, root] of roots.entries()) {
        setQueue({ roots, done: index })
        setStatus(await window.gearmod.invoke('code-index:reindex', { projectId: project.id, root }))
      }
    } catch (reason) { setError(plainError(reason)) } finally { setBusy(false); setQueue(null) }
  }
  /** Estado de cada pasta durante a indexação em fila: terminada, indexando agora ou esperando. */
  const phase = (root: string): 'done' | 'running' | 'queued' | 'idle' => {
    if (queue) { const at = queue.roots.indexOf(root); return at < queue.done ? 'done' : at === queue.done ? 'running' : 'queued' }
    return busy ? 'running' : 'idle'
  }
  const overall = queue ? queue.done / queue.roots.length : 0
  const renderRoot = (root: CodeIndexStatus['roots'][number]): React.JSX.Element => {
    const state = phase(root.root), percent = root.expected > 0 ? Math.min(100, Math.floor((root.files / root.expected) * 100)) : root.indexedAt ? 100 : 0
    const done = Boolean(root.indexedAt) && percent >= 100, indexing = state === 'running', health = indexing ? 'working' : done ? 'ok' : state === 'queued' ? 'waiting' : 'missing'
    const recent = root.indexedAt !== null && Date.now() - root.indexedAt < 60_000
    const seconds = root.ms === null ? null : (root.ms / 1000).toLocaleString(dateLocale(), { maximumFractionDigits: 2 })
    return <li key={root.root} className={`cidx-root cidx-${state} cidx-${health}`} data-tip={root.indexedAt && !done ? t.missing(root.expected - root.files) : root.root}>
      <div className="cidx-head"><b>{folderName(root.root)}</b>
        <span className="cidx-pct">{state === 'queued' ? t.queued : indexing ? t.running : `${percent}%`}</span></div>
      <div className="cidx-bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: indexing ? undefined : `${percent}%` }} /></div>
      {root.indexedAt ? <div className="cidx-chips">
        <span className="cidx-chip">{t.files(root.files)}</span><span className="cidx-chip">{t.symbols(root.symbols)}</span>
        <span className="cidx-chips-end">{seconds && <span className="cidx-chip">{t.took(seconds)}</span>}<span className="cidx-chip">{t.indexedAgo(recent ? null : shortAgo(new Date(root.indexedAt).toISOString()))}</span></span>
      </div> : <small className="cidx-none">{t.notIndexed}</small>}
    </li>
  }
  return <div className="stack" style={{ gap: 8 }}><div className="cidx-title"><span className="sectitle">{t.title}</span>{status?.enabled && <button type="button" className="mini secondary" disabled={busy} onClick={() => { void reindex() }}>{busy ? t.reindexing : status.roots.some((root) => root.indexedAt) ? t.reindexAgain : t.reindex}</button>}</div>
    <small className="hint">{t.hint}</small>
    {!status ? <small className="hint">{error || t.loading}</small> : <>
      <Switch checked={status.enabled} disabled={busy} onChange={toggle}>{t.toggle}</Switch>
      {!status.enabled ? <small className="hint">{t.off}</small>
        : <>
          {queue && <div className="cidx-overall"><div className="cidx-head"><b>{t.progress(queue.done, queue.roots.length)}</b></div><div className="cidx-bar"><i style={{ width: `${Math.round(overall * 100)}%` }} /></div></div>}
          <ul className="cidx-roots">{status.roots.map(renderRoot)}</ul>
        </>}
    </>}
    {status && error && <p className="error">{error}</p>}
  </div>
}
