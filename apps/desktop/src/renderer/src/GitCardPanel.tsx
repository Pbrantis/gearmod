import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentProfile, GitCard, GitCardRepo, GitCommitFile, GitRequest } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { gitIcons, GitCheck, FileRow } from './GitPage'
import { laneColor, ruleLabel, ruleNote, shortAgo } from './gitView'
import { GitDiffEditor } from './editor/GitDiffEditor'
import { CodeEditor } from './editor/CodeEditor'
import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { openInEditor } from './openInEditor'
import { plainError } from './NoticeDialog'
import { Delivery } from './Delivery'
import { Select } from './Select'
import { useAsk } from './useAsk'
import { useT } from './i18n'

/** Pedidos de commit do agente deste card (pendentes e os últimos decididos); recarrega quando o card muda. */
export function useGitRequests(cardId: string): { items: GitRequest[]; reload(): Promise<void> } {
  const [items, setItems] = useState<GitRequest[]>([])
  const reload = useCallback(async (): Promise<void> => { if (!cardId) return setItems([]); try { setItems(await window.agentboard.invoke('git:requests', { cardId })) } catch { /* o chat segue sem o aviso */ } }, [cardId])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (['agentboard/card-updated', 'agentboard/run-completed'].includes(event.eventType)) void reload() }), [reload])
  return { items, reload }
}

/** Pedido de commit do agente: autorizar, editar a mensagem ou recusar. Aparece no chat de implementação e no painel Git do card. */
export function CommitAsk({ request, agent, branch, ruleWhy, onDecided, openGit, variant }: { request: GitRequest; agent?: AgentProfile; branch?: string | null; ruleWhy?: string; onDecided(request: GitRequest): void; openGit?(): void; variant: 'chat' | 'panel' }): React.JSX.Element {
  const t = useT().git.cardPanel
  const [editing, setEditing] = useState(false), [message, setMessage] = useState(request.message), [error, setError] = useState(request.error ?? ''), [busy, setBusy] = useState(false)
  const decide = async (decision: 'allow' | 'deny'): Promise<void> => {
    setBusy(true); setError('')
    try { onDecided(await window.agentboard.invoke('git:request-decide', { requestId: request.id, decision, message: decision === 'allow' && message.trim() !== request.message ? message.trim() : undefined })) } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) }
  }
  return <div className={variant === 'chat' ? 'cask' : 'cgprop'}>
    <div className="cgprop-h">{agent && <AgentIcon profile={agent} size="sm" tip={false} />}<b>{variant === 'chat' ? t.wantsCommit(branch) : t.agentWantsCommit(agent?.label ?? t.theAgent)}</b><small>{variant === 'chat' ? t.asksPermission(ruleWhy ?? t.projectRule) : shortAgo(request.createdAt)}</small></div>
    {editing ? <textarea className="autogrow" value={message} onChange={(e) => setMessage(e.target.value)} aria-label={t.commitMessage} /> : <p className="cgprop-msg">{request.message}</p>}
    <div className="cgnote">{t.filesInRepo(request.files.length, request.repoName, request.files.slice(0, 4).map((file) => file.split('/').pop()).join(', ') + (request.files.length > 4 ? '…' : ''))}</div>
    {error && <p className="error">{error}</p>}
    <div className="cgrow"><button type="button" className="mini" disabled={busy || !message.trim()} onClick={() => void decide('allow')}>{t.authorizeCommit}</button>
      {!editing && <button type="button" className="mini secondary" onClick={() => setEditing(true)}>{t.editMessage}</button>}
      {openGit && <button type="button" className="mini secondary" onClick={openGit}>{t.seeInGit}</button>}<span className="grow1" />
      <button type="button" className="mini secondary" disabled={busy} onClick={() => void decide('deny')}>{t.deny}</button></div></div>
}

/** No chat de implementação: os pedidos pendentes e o resultado dos que o usuário acabou de decidir. */
export function CommitAsks({ cardId, branch, profiles, openGit }: { cardId: string; branch?: string | null; profiles: AgentProfile[]; openGit(): void }): React.JSX.Element | null {
  const t = useT().git.cardPanel
  const { items, reload } = useGitRequests(cardId), [results, setResults] = useState<GitRequest[]>([])
  const pending = items.filter((item) => item.status === 'pending')
  if (!pending.length && !results.length) return null
  return <>{results.map((item) => <div className="msg sys" key={item.id}>{item.status === 'done' ? t.commitAuthorized(item.message.split('\n')[0] ?? '') : item.status === 'failed' ? t.commitNotDone(item.error ?? undefined) : t.commitDenied}</div>)}
    {pending.map((item) => <CommitAsk key={item.id} request={item} variant="chat" branch={branch} agent={profiles.find((profile) => profile.id === item.agentProfileId)} onDecided={(done) => { setResults((current) => [...current, done]); void reload() }} openGit={openGit} />)}</>
}

/** Origem deste repositório: cada um tem a sua. Ao escolher outra, os commits do card passam a ser contados a partir dela. */
function BaseSelect({ repo, cardId, base, reload }: { repo: GitCardRepo; cardId: string; base: string; reload(): Promise<void> }): React.JSX.Element {
  const t = useT().git.cardPanel
  const [options, setOptions] = useState<string[]>([]), [error, setError] = useState('')
  const load = (): void => { if (!options.length) void window.agentboard.invoke('git:base-options', { sourceId: repo.sourceId }).then(setOptions).catch(() => undefined) }
  const change = async (value: string): Promise<void> => { try { await window.agentboard.invoke('git:set-base', { cardId, sourceId: repo.sourceId, baseRef: value }); setError(''); await reload() } catch (reason) { setError(plainError(reason)) } }
  const list = options.includes(base) ? options : [base, ...options]
  return <span className="basepick" onMouseEnter={load} onFocus={load}><Select label={t.originOf(repo.name)} className="ghostsel" value={base} options={list.map((name) => ({ value: name, label: name }))} onChange={(value) => void change(value)} />{error && <small className="cx-warn">{error}</small>}</span>
}

const editOptions = { wrap: true, tabSize: 2, indentWithTab: true, whitespace: false, guides: false, scrollPastEnd: false }
export type DiffTarget = { sourceId: string; path: string; hash?: string }

/** Painel do arquivo alterado, à esquerda do chat: o diff (do commit ou ainda sem commit) com seleção de linhas para a IA. */
export function DiffPane({ cardId, target, close, ask, style }: { cardId: string; target: DiffTarget; close(): void; ask(prompt: string): boolean | Promise<boolean>; style?: React.CSSProperties }): React.JSX.Element {
  const { common, git: { cardPanel: t, page: tp } } = useT()
  const { sourceId, path, hash } = target, [error, setError] = useState(''), [version, setVersion] = useState(0)
  const [draft, setDraft] = useState<string>(), [original, setOriginal] = useState(''), [saving, setSaving] = useState(false), [loadingFile, setLoadingFile] = useState(false)
  useEffect(() => { setDraft(undefined) }, [sourceId, path, hash])
  useEffect(() => { setError('') }, [sourceId, cardId, path, hash, version])
  const edit = (): void => {
    setLoadingFile(true); setError('')
    void window.agentboard.invoke('git:file-read', { sourceId, cardId, path }).then((out) => { setOriginal(out.content); setDraft(out.content) }).catch((reason: unknown) => setError(plainError(reason))).finally(() => setLoadingFile(false))
  }
  const save = (): void => {
    if (draft === undefined) return
    setSaving(true); setError('')
    void window.agentboard.invoke('git:file-write', { sourceId, cardId, path, content: draft }).then(() => { setDraft(undefined); setVersion((value) => value + 1) }).catch((reason: unknown) => setError(plainError(reason))).finally(() => setSaving(false))
  }
  const editing = draft !== undefined, dirty = editing && draft !== original
  const saveRef = useRef(save); saveRef.current = () => { if (dirty) save() }
  const saveKeys = useMemo<Extension[]>(() => [Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => { saveRef.current(); return true } }]))], [])
  const { ask: confirmAsk, dialog: askDialog } = useAsk()
  const leave = async (): Promise<void> => { if (dirty && !(await confirmAsk({ eyebrow: t.editFileEyebrow, title: t.discardEditsTitle, text: t.discardEditsText(path), ok: tp.discard, danger: true }))) return; setDraft(undefined) }
  return <aside className="fview gdiffpane" style={style} aria-label={tp.changesOf(path)}>{askDialog}
    <div className="fv-head"><div className="fv-path" data-tip={path}>{path}</div>{hash && <small className="fv-size">{tp.commitHash(hash.slice(0, 7))}</small>}
      <button type="button" className="fv-toggle" data-tip={tp.openCurrentTip} disabled={editing} onClick={() => void openInEditor({ sourceId, cardId, path }).then(() => close()).catch((reason: unknown) => setError(plainError(reason)))}>{tp.openInEditor}</button>
      {!hash && (editing ? <><button type="button" className="fv-toggle" disabled={saving} onClick={() => void leave()}>{common.cancel}</button><button type="button" className="fv-toggle on" disabled={saving || !dirty} onClick={save}>{saving ? common.saving : common.save}</button></>
        : <button type="button" className="fv-toggle" disabled={loadingFile} onClick={edit}>{t.editFile}</button>)}
      <button type="button" className="x" aria-label={common.close} onClick={() => { if (editing) void leave(); if (!dirty) close() }}>×</button></div>
    <div className="fv-body">{error && <p className="fv-note err">{error}</p>}
      {editing ? <div className="fv-editorbox"><CodeEditor value={draft} path={path} options={editOptions} extensions={saveKeys} ariaLabel={t.editPath(path)} onChange={setDraft} /></div>
        : <GitDiffEditor sourceId={sourceId} cardId={cardId} path={path} hash={hash} review={{ path, send: ask }} reloadKey={version} />}</div>
  </aside>
}

/** Arquivos de um commit do card; cada um abre o diff. */
function CommitFiles({ sourceId, hash, pick }: { sourceId: string; hash: string; pick(path: string): void }): React.JSX.Element {
  const common = useT().common
  const [files, setFiles] = useState<GitCommitFile[]>()
  useEffect(() => { void window.agentboard.invoke('git:commit-detail', { sourceId, hash }).then((out) => setFiles(out.files)).catch(() => setFiles([])) }, [sourceId, hash])
  return <div className="cgcfiles gfiles">{!files ? <small>{common.loading}</small> : files.map((file) => <FileRow key={file.path} file={file} onOpen={() => pick(file.path)} />)}</div>
}

function RepoSection({ repo, cardId, base, profiles, excluded, setExcluded, reload, openGraph, decided, diff, setDiff }: { repo: GitCardRepo; cardId: string; base: string; profiles: AgentProfile[]; excluded: string[]; setExcluded(value: string[]): void; reload(): Promise<void>; openGraph(): void; decided(request: GitRequest): void; diff?: DiffTarget; setDiff(value: DiffTarget | undefined): void }): React.JSX.Element {
  const t = useT().git.cardPanel
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [openCommit, setOpenCommit] = useState<string>()
  const paths = useMemo(() => [...new Set(repo.files.map((file) => file.path))], [repo.files])
  const quiet = !repo.commits.length && !paths.length
  if (quiet) return <></>
  const color = laneColor(1)
  const push = async (): Promise<void> => { setBusy(true); setError(''); try { await window.agentboard.invoke('git:sync', { sourceId: repo.sourceId, cardId, action: 'push' }); await reload() } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) } }
  return <section className="cgrepo"><header>{gitIcons.repo}{repo.name}<span className="cnts">{repo.ahead > 0 && <span className="pillg up">↑ {repo.ahead}</span>}{repo.behind > 0 && <span className="pillg down">↓ {repo.behind}</span>}{paths.length > 0 && <span className="pillg down">{t.uncommitted(paths.length)}</span>}{repo.published && <span className="pillg ok">{t.published}</span>}</span></header>
    <div className="cgbody"><div className="cgnote" style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}>{repo.worktreePath}</div>
      <div><div className="cglabel" style={{ marginBottom: 4 }}>{t.cardCommits}</div>{repo.commits.length ? <div className="cgcommits" style={{ '--lc': color } as React.CSSProperties}>
        {repo.commits.map((commit) => { const agent = profiles.find((profile) => profile.id === commit.agentProfileId); return <React.Fragment key={commit.hash}><div className="cgc"><i /><button type="button" className="cgfile" data-tip={t.seeCommitFiles} onClick={() => setOpenCommit(openCommit === commit.hash ? undefined : commit.hash)} style={{ flex: 1, textAlign: 'left' }}>{commit.subject}</button><code>{agent ? `${agent.label} · ` : `${t.you} · `}{commit.short}</code></div>{openCommit === commit.hash && <CommitFiles sourceId={repo.sourceId} hash={commit.hash} pick={(path) => setDiff({ sourceId: repo.sourceId, path, hash: commit.hash })} />}</React.Fragment> })}
        <div className="cgc basec"><i className="base" /><span>{t.baseLabel} <BaseSelect repo={repo} cardId={cardId} base={base} reload={reload} />{repo.behind ? ` · ${t.newOnBase(repo.behind, base)}` : ''}</span><code /></div></div> : <div className="cgnote">{t.noCommitsYet}</div>}</div>
      {repo.request && <CommitAsk request={repo.request} variant="panel" agent={profiles.find((profile) => profile.id === repo.request!.agentProfileId)} onDecided={decided} />}
      {paths.length > 0 && <div className="cgform"><div className="cglabel">{t.uncommittedFiles(paths.length)}</div>
        {paths.map((path) => { const file = repo.files.find((item) => item.path === path)!; const on = !excluded.includes(path)
          return <label className="cgck" key={path}><GitCheck checked={on} label={path} onChange={(value) => setExcluded(value ? excluded.filter((item) => item !== path) : [...excluded, path])} /><span className={`st ${file.status}`} style={{ fontWeight: 800, fontFamily: 'var(--sans)' }}>{file.status}</span>
            <button type="button" className="cgfile" data-tip={t.seeChanges} onClick={(e) => { e.preventDefault(); setDiff(diff?.path === path && !diff.hash && diff.sourceId === repo.sourceId ? undefined : { sourceId: repo.sourceId, path }) }}>{path}</button><span className="nums"><span className="p">+{repo.files.filter((item) => item.path === path).reduce((sum, item) => sum + item.additions, 0)}</span> <span className="m">−{repo.files.filter((item) => item.path === path).reduce((sum, item) => sum + item.deletions, 0)}</span></span></label> })}</div>}
      {error && <p className="error">{error}</p>}
      <div className="cgrow">{repo.hasRemote && repo.ahead > 0 && <button type="button" className="mini secondary" disabled={busy} onClick={() => void push()}>{repo.published ? t.push : t.publishBranch}</button>}<span className="grow1" /><button type="button" className="mini secondary" onClick={openGraph}>{t.seeInGraph}</button></div></div></section>
}

/** Painel Git do card (botão Chat | Git): a branch de origem e a do card, uma seção por repositório e o commit fixo no rodapé. */
export function GitCardPanel({ cardId, profiles, openRules, openGraph, diff, setDiff }: { cardId: string; profiles: AgentProfile[]; openRules(): void; openGraph(cardId: string): void; diff?: DiffTarget; setDiff(value: DiffTarget | undefined): void }): React.JSX.Element {
  const t = useT().git.cardPanel
  const [data, setData] = useState<GitCard>(), [error, setError] = useState(''), [excluded, setExcluded] = useState<Record<string, string[]>>({}), [message, setMessage] = useState(''), [target, setTarget] = useState<string>(), [busy, setBusy] = useState(false), [done, setDone] = useState('')
  const alive = useRef(true)
  const load = useCallback(async (): Promise<void> => { try { const next = await window.agentboard.invoke('git:card', { cardId }); if (alive.current) { setData(next); setError('') } } catch (reason) { if (alive.current) setError(plainError(reason)) } }, [cardId])
  useEffect(() => { alive.current = true; void load(); const timer = window.setInterval(() => void load(), 5000); return () => { alive.current = false; window.clearInterval(timer) } }, [load])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (['agentboard/card-updated', 'agentboard/run-completed', 'agentboard/tool-activity'].includes(event.eventType)) void load() }), [load])
  if (error && !data) return <div className="cgwrap"><div className="cgit"><p className="error">{error}</p></div></div>
  if (!data) return <div className="cgwrap"><div className="cgit"><div className="cgnote">{t.loadingCardGit}</div></div></div>
  if (!data.branch) return <div className="cgwrap"><div className="cgit"><div className="cgsum"><div className="br">{gitIcons.branch}<em>{t.noBranchYet}</em></div><p className="cgnote">{t.noBranchA}<b>agentboard/…</b>{t.noBranchB}</p></div></div></div>
  const withFiles = data.repos.filter((repo) => repo.files.length > 0)
  const targetRepo = withFiles.find((repo) => repo.sourceId === target) ?? withFiles[0]
  const pathsOf = (repo: GitCardRepo): string[] => [...new Set(repo.files.map((file) => file.path))].filter((path) => !(excluded[repo.sourceId] ?? []).includes(path))
  const commit = async (): Promise<void> => {
    if (!targetRepo) return
    const paths = pathsOf(targetRepo)
    if (!message.trim()) return setError(t.writeMessage)
    if (!paths.length) return setError(t.checkOneFile)
    setBusy(true); setError(''); setDone('')
    try { const out = await window.agentboard.invoke('git:commit', { sourceId: targetRepo.sourceId, cardId, message: message.trim(), paths }); setMessage(''); setDone(t.commitCreated(out.hash.slice(0, 7))); await load() } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) }
  }
  const { rule } = data
  return <div className="cgwrap"><div className="cgit">
    <div className="cgsum"><div className="br"><span className="bchip base" data-tip={t.baseBranchTip}>{gitIcons.branch}<span>{data.baseBranch ?? '—'}</span></span><span className="barrow" data-tip={t.originatedTip}>→</span><span className="bchip cur" data-tip={t.cardBranchTip}>{gitIcons.branch}<span>{data.branch}</span></span></div>
      <small>{t.sameBranchNote}</small>
      <div className={`cgpol pol-${rule.rule}`}><span className="pd" /><span><span>{t.agentCommit} <b>{ruleLabel(rule.rule)}</b> · {ruleNote(rule.rule)}</span><small>{rule.why}</small></span><button type="button" className="ghost" onClick={openRules}>{t.rules}</button></div></div>
    {!data.repos.some((repo) => repo.commits.length || repo.files.length) && <div className="cgnote">{t.noReposChanged}</div>}
    <Delivery cardId={cardId} data={data} reload={load} />
    {data.repos.map((repo) => <RepoSection key={repo.sourceId} repo={repo} cardId={cardId} base={repo.baseRef} profiles={profiles} excluded={excluded[repo.sourceId] ?? []} setExcluded={(value) => setExcluded({ ...excluded, [repo.sourceId]: value })} reload={load} openGraph={() => openGraph(cardId)} decided={() => void load()} diff={diff} setDiff={setDiff} />)}
  </div>
  {targetRepo && <div className="cgfoot"><div className="cglabel">{withFiles.length > 1 ? t.yourCommitIn : t.yourCommit}{withFiles.length > 1 ? ' ' : ''}{withFiles.length > 1 && <Select className="cg-repo-select" label={t.commitRepo} value={targetRepo.sourceId} onChange={setTarget} options={withFiles.map((repo) => ({ value: repo.sourceId, label: repo.name }))} />}</div>
    <textarea className="autogrow" placeholder={t.yourCommitMessage} aria-label={t.yourCommitMessage} value={message} onChange={(e) => setMessage(e.target.value)} />
    {error && <p className="error">{error}</p>}{done && <div className="cgnote">{done}</div>}
    <div className="cgrow"><span className="grow1" /><button type="button" className="mini" disabled={busy} onClick={() => void commit()}>{t.commit}</button></div></div>}
  </div>
}
