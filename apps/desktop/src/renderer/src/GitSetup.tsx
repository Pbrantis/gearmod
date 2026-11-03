import React, { useEffect, useState } from 'react'
import type { GitRepo } from '@gearmod/contracts'
import { plainError } from './NoticeDialog'
import { Select } from './Select'
import { useEscape } from './useEscape'
import { useT } from './i18n'

/** Avisa o app inteiro que o cadastro de repositórios do projeto mudou (o quadro recarrega o projeto). */
export const gitChangedEvent = 'gearmod:git-changed'

/** Diálogo único (Git do quadro e Configurar projeto → Git): iniciar o Git do zero ou vincular uma origin SSH/HTTPS. */
export function GitSetupDialog({ projectId, close, done }: { projectId: string; close(): void; done(repos: GitRepo[]): void }): React.JSX.Element {
  const { common, git: { setup: t } } = useT()
  const [targets, setTargets] = useState<Array<{ sourceId: string; name: string; path: string }>>(), [sourceId, setSourceId] = useState(''), [mode, setMode] = useState<'init' | 'origin'>('init'), [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { void window.gearmod.invoke('git:setup-targets', { projectId }).then((items) => { setTargets(items); setSourceId((current) => current || items[0]?.sourceId || '') }).catch((reason: unknown) => setError(plainError(reason))) }, [projectId])
  useEscape(close, !busy)
  const target = targets?.find((item) => item.sourceId === sourceId)
  const submit = async (): Promise<void> => {
    if (!target) return
    setBusy(true); setError('')
    try { const repos = await window.gearmod.invoke('git:setup', { projectId, sourceId: target.sourceId, mode, url: mode === 'origin' ? url.trim() : undefined }); window.dispatchEvent(new Event(gitChangedEvent)); done(repos) }
    catch (reason) { setError(plainError(reason)); setBusy(false) }
  }
  return <div className="overlay top" role="dialog" aria-label={t.addGit}><div className="modal" style={{ width: 'min(480px,100%)' }}>
    <header><div><div className="eyebrow">Git</div><h2>{t.addGit}</h2></div></header>
    <div className="stack" style={{ gap: 12 }}>
      {targets && !targets.length ? <p className="hint">{t.allHaveGit}</p> : <>
        <div className="stack" style={{ gap: 4 }}>
          {targets && targets.length > 1 ? <div className="f"><span>{t.folderTitle}</span><Select label={t.folderTitle} value={sourceId} onChange={setSourceId} options={targets.map((item) => ({ value: item.sourceId, label: item.name }))} /></div> : null}
          {target && <small className="hint">{t.willConfigureA}<b>{target.path}</b>{t.willConfigureB}</small>}
        </div>
        <div className="stack" style={{ gap: 8 }} role="radiogroup" aria-label={t.howToSetup}>
          <label className={`ck-line pickrow ${mode === 'init' ? 'on' : ''}`}><input type="radio" name="gitmode" checked={mode === 'init'} onChange={() => setMode('init')} /><span className="t">{t.initTitle}<small>{t.initHint}</small></span></label>
          <label className={`ck-line pickrow ${mode === 'origin' ? 'on' : ''}`}><input type="radio" name="gitmode" checked={mode === 'origin'} onChange={() => setMode('origin')} /><span className="t">{t.originTitle}<small>{t.originHint}</small></span></label>
          {mode === 'origin' && <label className="f">{t.originUrl}<input className="in" autoFocus value={url} spellCheck={false} placeholder={t.originPlaceholder} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit() }} /></label>}
        </div></>}
      {error && <p className="error">{error}</p>}
    </div>
    <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={close}>{common.cancel}</button><button type="button" disabled={busy || !target || (mode === 'origin' && !url.trim())} onClick={() => void submit()}>{busy ? t.configuring : mode === 'init' ? t.startGit : t.linkOrigin}</button></div>
  </div></div>
}

/** Estado vazio simples: projeto ou pasta sem repositório Git, com o botão centralizado que abre o diálogo. */
export function GitEmpty({ projectId, done }: { projectId: string; done(repos: GitRepo[]): void }): React.JSX.Element {
  const t = useT().git.setup
  const [open, setOpen] = useState(false)
  return <div className="gitempty">
    <p>{t.noGitYet}</p>
    <button type="button" onClick={() => setOpen(true)}>{t.addGit}</button>
    {open && <GitSetupDialog projectId={projectId} close={() => setOpen(false)} done={(repos) => { setOpen(false); done(repos) }} />}
  </div>
}

/** Pergunta com qual remoto/branch a branch atual faz pull e push (quando ela ainda não está ligada a nenhuma). */
export function GitUpstreamDialog({ sourceId, cardId, branch, remotes, close, done }: { sourceId: string; cardId: string | null; branch: string; remotes: string[]; close(): void; done(): void }): React.JSX.Element {
  const { common, git: { setup: t } } = useT()
  const [remote, setRemote] = useState(remotes.includes('origin') ? 'origin' : remotes[0] ?? ''), [name, setName] = useState(branch), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEscape(close, !busy)
  const submit = async (): Promise<void> => {
    if (!name.trim() || !remote) return
    setBusy(true); setError('')
    try { await window.gearmod.invoke('git:set-upstream', { sourceId, cardId, remote, branch: name.trim() }); done() } catch (reason) { setError(plainError(reason)); setBusy(false) }
  }
  return <div className="overlay top" role="dialog" aria-label={t.upstreamAria}><form className="modal" style={{ width: 'min(520px,100%)' }} onSubmit={(event) => { event.preventDefault(); void submit() }}>
    <header><div><div className="eyebrow">Pull</div><h2>{t.upstreamTitle}</h2></div></header>
    <div className="stack" style={{ gap: 10 }}>
      <p className="hint" style={{ margin: 0 }}>{t.upstreamTextA}<b>{branch}</b>{t.upstreamTextB}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: '0 0 130px', minWidth: 0 }}><Select label={t.remote} value={remote} onChange={setRemote} options={remotes.map((item) => ({ value: item, label: item }))} /></div>
        <span aria-hidden="true">/</span>
        <input className="in" aria-label={t.remoteBranch} autoFocus value={name} spellCheck={false} onChange={(event) => setName(event.target.value)} style={{ flex: 1 }} />
      </div>
      {error && <p className="error">{error}</p>}
    </div>
    <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={close}>{common.cancel}</button><button type="submit" disabled={busy || !name.trim() || !remote}>{busy ? t.linking : t.confirmAndPull}</button></div>
  </form></div>
}
