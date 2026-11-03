import React, { useCallback, useEffect, useState } from 'react'
import type { GitAccountInfo, GitAccountsState } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { Select } from './Select'
import { toast } from './toasts'
import { useT } from './i18n'

type Host = GitAccountsState['hosts'][number]
type Target = { host: string; sourceId?: string; provider: 'github' | 'gitlab' }
export const gitAccountsChangedEvent = 'agentboard:git-accounts-changed'

/** Quem é a conta do token: nome, usuário e e-mail, mais as 4 últimas letras. O token em si nunca volta para a tela. */
function Who({ info }: { info: GitAccountInfo }): React.JSX.Element {
  const t = useT().git.accounts
  return <span className="gacc-who">{info.invalid && <i className="gacc-dot" aria-hidden="true" />}<b>{info.name}</b> <span className="cx-muted">@{info.login}{info.email ? ` · ${info.email}` : ''} · {info.hint}</span>{info.invalid && <small className="cx-warn"> {t.invalid}</small>}</span>
}

/** Contas Git do projeto: um token por servidor (vale para todos os repositórios dele) e, se quiser, um token próprio por repositório. */
export function GitAccountsPanel({ projectId }: { projectId: string }): React.JSX.Element {
  const { git: { accounts: t }, common } = useT()
  const [state, setState] = useState<GitAccountsState>(), [error, setError] = useState(''), [edit, setEdit] = useState<Target | null>(null), [token, setToken] = useState(''), [busy, setBusy] = useState(false), [removing, setRemoving] = useState<{ host: string; sourceId?: string; label: string } | null>(null)
  const load = useCallback(async (): Promise<void> => { try { setState(await window.agentboard.invoke('git-accounts:state', { projectId })); setError('') } catch (reason) { setError(plainError(reason)) } }, [projectId])
  useEffect(() => { void load() }, [load])
  const changed = (next: GitAccountsState): void => { setState(next); window.dispatchEvent(new CustomEvent(gitAccountsChangedEvent, { detail: { projectId } })) }
  const open = (target: Target): void => { setEdit(target); setToken(''); setError('') }
  const save = async (): Promise<void> => {
    if (!edit || !token.trim()) return
    setBusy(true); setError('')
    try { changed(await window.agentboard.invoke('git-accounts:set', { projectId, sourceId: edit.sourceId, provider: edit.provider, host: edit.host, token: token.trim() })); setEdit(null); setToken(''); toast.success(t.saved) } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) }
  }
  const remove = async (): Promise<void> => {
    if (!removing) return
    const target = removing; setRemoving(null)
    try { changed(await window.agentboard.invoke('git-accounts:remove', { projectId, sourceId: target.sourceId, host: target.host })); toast.success(t.removed) } catch (reason) { setError(plainError(reason)) }
  }
  const form = (host: Host, target: Target): React.JSX.Element => <div className="gacc-form">
    {!host.provider && !target.sourceId && <Select label={t.provider} value={target.provider} options={[{ value: 'gitlab', label: 'GitLab' }, { value: 'github', label: 'GitHub' }]} onChange={(value) => setEdit({ ...target, provider: value as 'github' | 'gitlab' })} />}
    <input className="in" type="password" autoComplete="off" spellCheck={false} autoFocus value={token} placeholder={t.tokenPlaceholder} aria-label={t.token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEdit(null) }} />
    <small className="hint">{target.provider === 'github' ? t.helpGithub : t.helpGitlab}</small>
    {error && <p className="error">{error}</p>}
    <div className="cgrow"><button type="button" className="mini" disabled={busy || !token.trim()} onClick={() => void save()}>{busy ? t.checking : t.save}</button><button type="button" className="mini secondary" disabled={busy} onClick={() => setEdit(null)}>{common.cancel}</button></div></div>
  const editing = (target: Target): boolean => edit?.host === target.host && edit.sourceId === target.sourceId
  return <div className="stack gacc">
    <div className="sectitle">{t.title}</div>
    <small className="hint">{t.hint}</small>
    {error && !edit && <p className="error">{error}</p>}
    {!state ? <small className="hint">{common.loading}</small> : !state.hosts.length ? <small className="hint">{t.noRemotes}</small> : state.hosts.map((host) => {
      const provider = host.provider ?? 'gitlab', projectTarget: Target = { host: host.host, provider }
      return <section className="cx-wfcard gacc-host" key={host.host}>
        <h4>{host.host}<small className="cx-muted"> · {provider === 'github' ? 'GitHub' : 'GitLab'}</small></h4>
        <div className="gacc-row"><span className="cx-muted">{t.projectToken}</span>{host.project ? <Who info={host.project} /> : <span className="cx-muted">{t.none}</span>}
          <span className="grow1" />
          <button type="button" className="mini secondary" onClick={() => open(projectTarget)}>{host.project ? t.replace : t.add}</button>
          {host.project && <button type="button" className="mini secondary" onClick={() => setRemoving({ host: host.host, label: host.host })}>{t.remove}</button>}</div>
        {editing(projectTarget) && form(host, edit!)}
        {host.repos.length > 0 && <div className="gacc-repos">{host.repos.map((repo) => {
          const target: Target = { host: host.host, sourceId: repo.sourceId, provider: host.project?.provider ?? provider }
          return <div key={repo.sourceId}><div className="gacc-row"><b>{repo.name}</b>
            {repo.own ? <Who info={repo.own} /> : <span className="cx-muted">{repo.using === 'project' ? (host.project?.invalid ? t.projectInvalid : t.usesProject) : t.noToken}</span>}
            <span className="grow1" />
            <button type="button" className="mini secondary" onClick={() => open(target)}>{repo.own ? t.replace : t.ownToken}</button>
            {repo.own && <button type="button" className="mini secondary" onClick={() => setRemoving({ host: host.host, sourceId: repo.sourceId, label: repo.name })}>{t.remove}</button>}</div>
            {editing(target) && form(host, edit!)}</div>
        })}</div>}
      </section>
    })}
    {removing && <ConfirmDialog eyebrow={t.title} title={t.removeTitle(removing.label)} text={t.removeText} ok={t.remove} danger cancel={() => setRemoving(null)} confirm={() => void remove()} />}
  </div>
}
