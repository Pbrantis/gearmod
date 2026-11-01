import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { IpcOutput } from '@agentboard/contracts'
import { DiffEditor } from './editor/DiffEditor'
import { usePreferences } from './editor/preferences'
import { plainError } from './NoticeDialog'
import { useEscape } from './useEscape'
import { useT } from './i18n'

export function CardConstitution({ projectId, cardId, close, openGit }: { projectId: string; cardId: string; close(): void; openGit(): void }): React.JSX.Element {
  const { board: tb, common } = useT(), t = tb.cardConstitution
  const [details, setDetails] = useState<IpcOutput<'constitution:card-details'>>(), [content, setContent] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [preferences] = usePreferences()
  useEscape(close)
  const options = useMemo(() => ({ wrap: preferences.wrap, tabSize: preferences.tabSize, indentWithTab: preferences.indent, whitespace: preferences.whitespace, guides: preferences.guides, scrollPastEnd: preferences.beyond }), [preferences])
  const load = useCallback(async () => { const data = await window.agentboard.invoke('constitution:card-details', { projectId, cardId }); setDetails(data); setContent(data.view.content ?? '') }, [projectId, cardId])
  useEffect(() => { void load().catch((e) => setError(plainError(e))) }, [load])
  const save = async (): Promise<void> => { if (!details) return; setBusy(true); setError(''); try { await window.agentboard.invoke('constitution:write', { projectId, cardId, content, expectBlobSha: details.view.blobSha }); await load() } catch (e) { setError(plainError(e)) } finally { setBusy(false) } }
  return <div className="overlay" role="dialog" aria-label={t.title}><div className="modal" style={{ width: 'min(1000px,100%)', maxHeight: '90vh', overflow: 'auto' }}>
    <header><div><div className="eyebrow">{t.eyebrow}</div><h2>{t.title}</h2></div><button className="x" onClick={close} aria-label={common.close}>×</button></header>
    {error && <p className="error">{error}</p>}
    {!details ? <p>{common.loading}</p> : <>
      <p><b>{t.repository}:</b> {details.location.repo} · <b>{t.file}:</b> {details.view.path}</p>
      <p><b>{t.base}:</b> {details.baseRef} · <b>Branch:</b> {details.location.worktreeBranch ?? details.baseRef} · <b>{t.baseHash}:</b> {details.view.baseBlobSha ?? t.absent} · <b>{t.fileHash}:</b> {details.view.blobSha ?? t.absent} · <b>{t.state}:</b> {details.view.state}</p>
      {details.view.state === 'behind' && <p className="cx-note warn">{t.behindNote}</p>}
      <div className="actions"><button type="button" className="secondary" onClick={openGit}>{t.bringFromBase}</button><button type="button" disabled={busy || content === (details.view.content ?? '')} onClick={() => void save()}>{busy ? common.saving : t.saveToWorktree}</button></div>
      <div className="wf-diffview" style={{ height: 380 }}><DiffEditor before={details.baseContent} after={content} path={details.view.path} layout={preferences.diffLayout} editable onChange={setContent} options={options} title={t.compareWith(details.baseRef)} /></div>
      <details><summary>{t.gitHistory}</summary><pre>{details.history || t.noCommits}</pre></details>
    </>}
  </div></div>
}
