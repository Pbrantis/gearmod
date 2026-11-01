import React, { useEffect, useState } from 'react'
import type { CodeIndexStatus, Project } from '@agentboard/contracts'
import { Switch } from './Switch'
import { plainError } from './NoticeDialog'
import { shortAgo } from './gitView'
import { dateLocale, useT } from './i18n'

const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** Seção da tela do projeto: liga ou desliga o índice de código e mostra o estado de cada pasta indexada. */
export function ProjectCodeIndex({ project }: { project: Project }): React.JSX.Element {
  const t = useT().settings.codeIndex
  const [status, setStatus] = useState<CodeIndexStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    void window.agentboard.invoke('code-index:status', { projectId: project.id, cardId: null }).then((value) => { if (alive) setStatus(value) }).catch((reason) => { if (alive) setError(plainError(reason)) })
    return () => { alive = false }
  }, [project.id])
  const run = async (action: () => Promise<CodeIndexStatus>): Promise<void> => {
    setBusy(true); setError('')
    try { setStatus(await action()) } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) }
  }
  const toggle = (enabled: boolean): void => { setStatus((current) => current ? { ...current, enabled } : current); void run(() => window.agentboard.invoke('code-index:set-enabled', { projectId: project.id, enabled })) }
  const reindex = (): void => { void run(() => window.agentboard.invoke('code-index:reindex', { projectId: project.id })) }
  const indexed = (root: CodeIndexStatus['roots'][number]): string => {
    if (!root.indexedAt) return t.notIndexed
    const recent = Date.now() - root.indexedAt < 60_000, seconds = root.ms === null ? null : (root.ms / 1000).toLocaleString(dateLocale(), { maximumFractionDigits: 1 })
    return `${t.summary(root.files, root.symbols)} · ${t.indexedAgo(recent ? null : shortAgo(new Date(root.indexedAt).toISOString()), seconds)}`
  }
  return <div className="stack" style={{ gap: 8 }}><span className="sectitle">{t.title}</span>
    <small className="hint">{t.hint}</small>
    {!status ? <small className="hint">{error || t.loading}</small> : <>
      <Switch checked={status.enabled} disabled={busy} onChange={toggle}>{t.toggle}</Switch>
      {!status.enabled ? <small className="hint">{t.off}</small>
        : <ul className="cidx-roots">{status.roots.map((root) => <li key={root.root} data-tip={root.root}><b>{folderName(root.root)}</b><span>{indexed(root)}</span></li>)}</ul>}
      {status.enabled && <button type="button" className="mini secondary" style={{ justifySelf: 'start' }} disabled={busy} onClick={reindex}>{busy ? t.reindexing : t.reindex}</button>}
    </>}
    {status && error && <p className="error">{error}</p>}
  </div>
}
