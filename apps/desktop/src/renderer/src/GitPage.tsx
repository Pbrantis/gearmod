import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorCodeOf, withoutErrorCode, type AgentProfile, type GitChange, type GitCommitFile, type GitGraph, type GitRepo, type GitRow, type ProjectBoard } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { GitSide } from './GitSide'
import { PrPanel } from './PrPanel'
import type { PullRequestsState } from './usePullRequests'
import { GitMenu, branchItems, commitItems, stashItems, type BranchAction, type CommitMenuAction, type StashMenuAction } from './BranchMenu'
import { ConfirmDialog } from './ConfirmDialog'
import { PushRejectedDialog } from './PushRejectedDialog'
import { ConflictsView, operationLabel, type ConflictTarget } from './ConflictsView'
import { GitDiffEditor } from './editor/GitDiffEditor'
import { openInEditor } from './openInEditor'
import { toast } from './toasts'
import { GitEmpty, GitUpstreamDialog as UpstreamDialog, gitChangedEvent } from './GitSetup'
import { plainError } from './NoticeDialog'
import { agoLabel, ghostChip, graphEdges, initials, isWip, laneColor, laneSpacing, laneX, refChips, rowHeight, shortAgo, splitPath, type RefChip } from './gitView'
import { Checkbox } from './Checkbox'
import { WorktreeDeleteDialog } from './WorktreeDelete'
import { FileContextMenu, type FileMenuItem } from './FileContextMenu'
import { useAsk } from './useAsk'
import { useEscape } from './useEscape'
import { useT } from './i18n'
import { gravatarEnabled } from './gravatarSetting'
import { branchNameProblem } from './branchName'

const I = (children: React.ReactNode): React.JSX.Element => <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
export const gitIcons = {
  branch: I(<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10" /><path d="M18 9c0 5-12 3-12 8" /></>),
  repo: I(<><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" /><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" /></>),
  cloud: I(<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.2 4.5 4.5 0 0 0 7 18z" />),
  pc: I(<><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></>),
  folder: I(<path d="M3.5 6.8c0-1 .8-1.8 1.8-1.8h4l2 2h7.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8z" />),
  stash: I(<><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M10 13h4" /></>),
  fetch: I(<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>),
  pull: I(<><path d="M12 4v12" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></>),
  push: I(<><path d="M12 20V8" /><path d="m7 13 5-5 5 5" /><path d="M5 4h14" /></>),
  graph: I(<><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 8v8" /><path d="M8 6c6 0 8 2 8 4" /></>),
  head: I(<path d="m5 12.5 4.5 4.5L19 7.5" />),
  pen: I(<path d="M4 20h4L19 9l-4-4L4 16z" />),
  trash: I(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></>),
  tree: I(<><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-4h12v4" /></>),
  tag: I(<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1" /></>),
  card: I(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h5" /></>)
}

/** Ícone do card no canto do detalhe: ao clicar mostra título, branch e as ações do card num balão, sem ocupar o painel. */
function CardButton({ cardId, title, branch, focus, setFocus, openCardGit }: { cardId: string; title: string; branch?: string | null; focus: string | null; setFocus(id: string | null): void; openCardGit(cardId: string): void }): React.JSX.Element {
  const T = useT(), t = T.git.page
  const [open, setOpen] = useState(false), box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (event: MouseEvent): void => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const esc = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [open])
  const on = focus === cardId
  return <div ref={box} className="gcardbtnwrap">
    <button type="button" className={`gcardbtn ${on ? 'on' : ''}`} data-tip={title} aria-label={`${T.common.card}: ${title}`} aria-expanded={open} onClick={() => setOpen(!open)}>{gitIcons.card}</button>
    {open && <div className="gcardpop" role="dialog" aria-label={T.common.card}><small>{T.common.card}</small><b>{title}</b>{branch && <span className="gcardpopbr" data-tip={branch}>{branch}</span>}
      <div className="cgrow"><button type="button" className="mini" onClick={() => { setOpen(false); openCardGit(cardId) }}>{t.openCardGit}</button><button type="button" className="mini secondary" onClick={() => setFocus(on ? null : cardId)}>{on ? t.showAllCommits : t.onlyThisCard}</button></div></div>}
  </div>
}

/** Caixa de seleção do app (mesma marcação das outras telas). */
export function GitCheck({ checked, onChange, label }: { checked: boolean; onChange(value: boolean): void; label?: string }): React.JSX.Element {
  return <Checkbox checked={checked} onChange={onChange} label={label} />
}

export function FileCounts({ files }: { files: Array<{ additions: number; deletions: number }> }): React.JSX.Element {
  const add = files.reduce((sum, file) => sum + file.additions, 0), del = files.reduce((sum, file) => sum + file.deletions, 0)
  return <span className="nums"><span className="p">+{add}</span> <span className="m">−{del}</span></span>
}

export function FileRow({ file, onOpen }: { file: GitCommitFile | GitChange; onOpen?(): void }): React.JSX.Element {
  return <div className={`gfile ${onOpen ? 'click' : ''}`} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen} onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } } : undefined}><span className={`st ${file.status}`}>{file.status}</span><span className="pth" data-tip={file.path}>{file.path}</span><span className="nums"><span className="p">+{file.additions}</span> <span className="m">−{file.deletions}</span></span></div>
}

function Chip({ chip, worktrees = [], remotes = [], pick, open }: { chip: RefChip; worktrees?: GitGraph['worktrees']; remotes?: string[]; pick?(): void; open?(): void }): React.JSX.Element {
  const t = useT().git.page
  // Na lista que abre ao passar o mouse o nome já aparece inteiro e a dica do sistema só atrapalha, por isso sem `title` quando é clicável.
  const label = [chip.name, chip.local && t.chipLocal, chip.remote && (remotes.length ? remotes.join(', ') : t.chipRemote), chip.tag && t.chipTag, ...worktrees.map((wt) => t.chipWorktree(wt.title, wt.path))].filter(Boolean).join(' · ')
  const props = pick ? { role: 'button', tabIndex: 0, 'aria-label': label, title: label, onClick: (event: React.MouseEvent) => { event.stopPropagation(); pick() }, onDoubleClick: (event: React.MouseEvent) => { event.stopPropagation(); open?.() }, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter') { event.stopPropagation(); open?.() } } } : { title: label }
  return <span className={`rchip ${chip.head ? 'head' : ''} ${pick ? 'pick' : ''}`} {...props}>
    {chip.head && gitIcons.head}<span className="rn">{chip.name}</span>{chip.tag && gitIcons.tag}{chip.local && gitIcons.pc}{chip.remote && gitIcons.cloud}{worktrees.length > 0 && gitIcons.tree}</span>
}

function RefsCell({ row, ghost, spacing, worktrees, act }: { row: GitRow; ghost: RefChip | null; spacing: number; worktrees: GitGraph['worktrees']; act(kind: 'local' | 'remote', name: string, open: boolean): void }): React.JSX.Element {
  const chips = refChips(row.refs), style = { '--lc': laneColor(row.lane), '--lx': `${laneX(row.lane, spacing) - 12}px` } as React.CSSProperties
  const details = (chip: RefChip): { worktrees: GitGraph['worktrees']; remotes: string[] } => ({ worktrees: chip.local && !chip.tag ? worktrees.filter((wt) => wt.branch === chip.name) : [], remotes: row.refs.filter((ref) => ref.kind === 'remote' && ref.name.replace(/^[^/]+\//, '') === chip.name).map((ref) => ref.name.split('/')[0]!) })
  if (!chips.length) return ghost ? <span className="grefs ghost" style={style}><span className="grefs-in"><Chip chip={ghost} /></span></span> : <span className="grefs" />
  return <span className={`grefs ${chips.length > 1 ? 'multi' : ''}`} style={style}><span className="grefs-in">{chips.map((chip) => <Chip key={chip.name} chip={chip} {...details(chip)} />)}</span>
    <span className="gstack">{chips.map((chip) => {
      // Etiquetas (tags) não são branches; as demais abrem a local, ou a remota quando só existe ela.
      const remote = row.refs.find((ref) => ref.kind === 'remote' && ref.name.replace(/^[^/]+\//, '') === chip.name)?.name
      const target = chip.tag ? null : chip.local ? { kind: 'local' as const, name: chip.name } : remote ? { kind: 'remote' as const, name: remote } : null
      return <Chip key={chip.name} chip={chip} {...details(chip)} {...(target ? { pick: () => act(target.kind, target.name, false), open: () => act(target.kind, target.name, true) } : {})} />
    })}</span>{chips.length > 1 && <span className="rmore">+{chips.length - 1}</span>}</span>
}

/** Foto do autor no Gravatar (o mesmo serviço que o GitKraken usa): só o hash do e-mail sai do app; sem foto cadastrada, ficam as iniciais. */
const gravatars = new Map<string, Promise<string | null>>()
function gravatarUrl(email: string): Promise<string | null> {
  const key = email.trim().toLowerCase()
  if (!key || !globalThis.crypto?.subtle) return Promise.resolve(null)
  let found = gravatars.get(key)
  if (!found) {
    found = crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)).then((buffer) => {
      const hash = Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const url = `https://gravatar.com/avatar/${hash}?s=64&d=404`
      return new Promise<string | null>((resolve) => { const image = new Image(); image.onload = () => resolve(url); image.onerror = () => resolve(null); image.src = url })
    }).catch(() => null)
    gravatars.set(key, found)
  }
  return found
}
function useGravatar(email: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true; setUrl(null)
    void gravatarEnabled().then((enabled) => enabled ? gravatarUrl(email) : null).then((value) => { if (alive) setUrl(value) })
    return () => { alive = false }
  }, [email])
  return url
}

function Dot({ row, profiles, spacing }: { row: GitRow; profiles: AgentProfile[]; spacing: number }): React.JSX.Element {
  const t = useT().git.page
  const style = { left: laneX(row.lane, spacing), '--lc': laneColor(row.lane) } as React.CSSProperties
  if (isWip(row)) return <span className="gdot wip" style={style} />
  if (row.stash) return <span className="gdot gstashdot" style={style} data-tip={row.stash.ref}>{gitIcons.stash}</span>
  const agent = profiles.find((profile) => profile.id === row.agentProfileId), photo = useGravatar(row.email)
  return <span className="gdot tip" style={style} data-tip={row.email ? `${row.author} · ${row.email}` : row.author}>{photo ? <img className="gphoto" src={photo} alt="" /> : <b>{initials(row.author)}</b>}{agent && <span className="gdotag tip" data-tip={t.commitBy(agent.label)}><AgentIcon profile={agent} size="sm" tip={false} /></span>}</span>
}

function Who({ row, profiles }: { row: GitRow; profiles: AgentProfile[] }): React.JSX.Element {
  const t = useT().git.page
  const agent = profiles.find((profile) => profile.id === row.agentProfileId)
  const photo = useGravatar(row.email)
  return <><span className="me tip" data-tip={row.author}>{photo ? <img className="gphoto" src={photo} alt="" /> : initials(row.author)}</span><span className="gname">{row.author}</span>{agent && <span className="gvia tip" data-tip={t.commitBy(agent.label)}><AgentIcon profile={agent} size="sm" tip={false} /></span>}</>
}

/** Detalhe do WIP, como no GitKraken: arquivos não preparados e preparados (stage) e o commit embaixo. */
function WipForm({ row, graph, summary, setSummary, changed, openDiff }: { row: GitRow; graph: GitGraph; summary: string; setSummary(value: string): void; changed(): void; openDiff(file: GitChange): void }): React.JSX.Element {
  const t = useT().git.page
  const sourceId = graph.repo.sourceId, cardId = row.cardId
  const [files, setFiles] = useState<GitChange[]>([]), [last, setLast] = useState(''), [description, setDescription] = useState(''), [amend, setAmend] = useState(false)
  const [closed, setClosed] = useState<{ un?: boolean; on?: boolean }>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [split, setSplit] = useState(50), listsRef = useRef<HTMLDivElement>(null)
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; file: GitChange }>(), [pending, setPending] = useState<{ kind: 'discard' | 'stash'; paths: string[] }>()
  const [sectionMenu, setSectionMenu] = useState<{ x: number; y: number }>()
  const resizeLists = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent): void => {
      const bounds = listsRef.current?.getBoundingClientRect()
      if (bounds?.height) setSplit(Math.max(10, Math.min(90, (e.clientY - bounds.top) / bounds.height * 100)))
    }
    const finish = (): void => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', finish); handle.removeEventListener('pointercancel', finish) }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish)
  }
  const load = useCallback(async () => { try { const state = await window.agentboard.invoke('git:changes', { sourceId, cardId }); setFiles(state.files); setLast(state.lastMessage) } catch (reason) { setError(plainError(reason)) } }, [sourceId, cardId])
  useEffect(() => { void load() }, [load, row.wip?.modified, row.wip?.added, row.wip?.deleted, row.wip?.staged])
  useEffect(() => { const refresh = (): void => { void load() }; window.addEventListener(gitChangedEvent, refresh); return () => window.removeEventListener(gitChangedEvent, refresh) }, [load])
  const unstaged = files.filter((file) => !file.staged), staged = files.filter((file) => file.staged)
  const stage = async (paths: string[], value: boolean): Promise<void> => {
    try { setError(''); const state = await window.agentboard.invoke('git:stage', { sourceId, cardId, paths, stage: value }); setFiles(state.files); changed() } catch (reason) { setError(plainError(reason)) }
  }
  const perform = async (action: 'discard' | 'stash', paths: string[]): Promise<void> => {
    try { setError(''); const state = action === 'discard' ? await window.agentboard.invoke('git:discard-unstaged', { sourceId, cardId, paths }) : await window.agentboard.invoke('git:stash-file', { sourceId, cardId, path: paths[0]! }); setFiles(state.files); changed() } catch (reason) { setError(plainError(reason)) }
  }
  const ignore = async (path: string, kind: 'file' | 'directory' | 'extension'): Promise<void> => {
    try { const state = await window.agentboard.invoke('git:ignore-file', { sourceId, cardId, path, kind }); setFiles(state.files); changed(); toast.info(t.ignoreAdded) } catch (reason) { setError(plainError(reason)) }
  }
  const menuItems = (file: GitChange): FileMenuItem[] => {
    const { dir, name } = splitPath(file.path), extension = /\.[^.]+$/.exec(name)?.[0]
    const external = async (target: 'explorer'): Promise<void> => { try { const found = await window.agentboard.invoke('git:file-path', { sourceId, cardId, path: file.path }); await window.agentboard.invoke('workspace:external', { ...found, cardId, target }) } catch (reason) { setError(plainError(reason)) } }
    const edit = async (): Promise<void> => { try { const found = await window.agentboard.invoke('git:file-path', { sourceId, cardId, path: file.path }); await window.agentboard.invoke('windows:open', { kind: 'file', projectId: found.projectId, cardId: cardId ?? undefined, path: found.path, placement: 'new' }) } catch (reason) { setError(plainError(reason)) } }
    return [
      { label: file.staged ? t.unstageFile : t.stageFile, action: () => void stage([file.path], !file.staged) },
      ...(!file.staged ? [{ label: t.discardChanges, action: () => setPending({ kind: 'discard' as const, paths: [file.path] }) }] : []),
      { label: t.ignoreMenu, children: [{ label: t.ignoreName(name), action: () => void ignore(file.path, 'file') }, { label: t.ignoreExtension(extension), disabled: !extension, action: () => void ignore(file.path, 'extension') }, { label: t.ignoreFolder(dir), disabled: !dir, action: () => void ignore(file.path, 'directory') }] },
      { label: t.stashFile, action: () => setPending({ kind: 'stash', paths: [file.path] }) },
      { label: t.openInFiles, separator: true, action: () => void openInEditor({ sourceId, cardId, path: file.path }).catch((reason: unknown) => setError(plainError(reason))) },
      { label: t.editFile, action: () => void edit() },
      { label: t.copyFilePath, action: () => void navigator.clipboard.writeText(file.path).catch(() => toast.error(t.copyFailed, t.clipboardDenied)) },
      { label: t.showInFolder, action: () => void external('explorer') }
    ]
  }
  const commit = async (): Promise<void> => {
    setBusy(true); setError('')
    try { await window.agentboard.invoke('git:commit', { sourceId, cardId, message: summary.trim(), description: description.trim() || undefined, amend }); setSummary(''); setDescription(''); setAmend(false); await load(); changed() } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) }
  }
  const lines = (list: GitChange[], isStaged: boolean): React.JSX.Element => <>{list.map((file) => {
    const { dir, name } = splitPath(file.path), key = `${isStaged ? 's' : 'u'}:${file.path}`
    return <React.Fragment key={key}><div className="gwrow" data-tip={file.path} onContextMenu={(event) => { event.preventDefault(); setFileMenu({ x: event.clientX, y: event.clientY, file }) }}><span className={`st ${file.status}`}>{file.status === 'M' ? gitIcons.pen : file.status === 'A' ? '+' : '−'}</span>
      <button type="button" className="gwp" onClick={() => openDiff(file)}>{dir && <span className="dir">{dir}</span>}<b>{name}</b></button>
      <button type="button" className={`gwbtn ${isStaged ? 'un' : ''}`} onClick={() => void stage([file.path], !isStaged)}>{isStaged ? t.unstageShort : t.stageShort}</button></div>
      </React.Fragment>
  })}{!list.length && <div className="gwempty">{t.nothingHere}</div>}</>
  const section = (id: 'un' | 'on', title: string, list: GitChange[], isStaged: boolean): React.JSX.Element => <div className={`gwsec ${closed[id] ? 'closed' : ''}`} style={{ flexGrow: closed[id] ? 0 : closed[id === 'un' ? 'on' : 'un'] ? 1 : id === 'un' ? split : 100 - split }}><div className="gwsech" onContextMenu={!isStaged && list.length ? (event) => { event.preventDefault(); setSectionMenu({ x: event.clientX, y: event.clientY }) } : undefined}>
    <button type="button" className="gwtog" onClick={() => setClosed({ ...closed, [id]: !closed[id] })}>{closed[id] ? '▸' : '▾'} {title} ({list.length})</button>
    {list.length > 0 && <span className="gwsection-actions">{!isStaged && <button type="button" className="gwdiscard" data-tip={t.discardAllTip} aria-label={t.discardAllTip} onClick={() => setPending({ kind: 'discard', paths: list.map((file) => file.path) })}>{gitIcons.trash}</button>}<button type="button" className={`gwall ${isStaged ? 'un' : ''}`} onClick={() => void stage([], !isStaged)}>{isStaged ? t.unstageAll : t.stageAll}</button></span>}</div>
    {!closed[id] && <div className="gwlist">{lines(list, isStaged)}</div>}</div>
  const toggleAmend = (value: boolean): void => { setAmend(value); if (value && !summary.trim()) setSummary(last); else if (!value && summary === last) setSummary('') }
  const ready = staged.length > 0 || amend, count = Array.from(new Set(staged.map((file) => file.path))).length
  return <div className="gwform"><div className="gwtop"><span>{t.filesChangedIn(new Set(files.map((file) => file.path)).size)} <code>{row.wip?.branch}</code></span></div>
    <div className="gwlists" ref={listsRef}>{section('un', t.unstagedTitle, unstaged, false)}{!closed.un && !closed.on && <div className="gwresize" role="separator" aria-label={t.resizeLists} aria-orientation="horizontal" aria-valuemin={10} aria-valuemax={90} aria-valuenow={Math.round(split)} tabIndex={0} onPointerDown={resizeLists} onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setSplit((value) => Math.max(10, Math.min(90, value + (event.key === 'ArrowUp' ? -5 : 5)))) } }} />}{section('on', t.stagedTitle, staged, true)}</div>
    <div className="gwcommit"><label className="gwamend"><GitCheck checked={amend} onChange={toggleAmend} label={t.amend} /> {t.amendWithHint}</label>
      <div className="gwmsg"><div className="gwsumrow"><input maxLength={120} placeholder={t.summaryPlaceholder} value={summary} onChange={(e) => setSummary(e.target.value)} /><span className={`gwcount ${summary.length > 72 ? 'over' : ''}`}>{72 - summary.length}</span></div>
        <textarea className="autogrow" placeholder={t.descriptionPlaceholder} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      {error && <p className="error">{error}</p>}
      <button type="button" className="gwgo" disabled={!ready || busy || (!amend && !summary.trim())} onClick={() => void commit()}>{amend ? t.amend : staged.length ? t.commitFiles(count) : t.stageFirst}</button></div>
    {fileMenu && <FileContextMenu x={fileMenu.x} y={fileMenu.y} items={menuItems(fileMenu.file)} close={() => setFileMenu(undefined)} />}
    {sectionMenu && <FileContextMenu x={sectionMenu.x} y={sectionMenu.y} label={t.unstagedActions} items={[{ label: t.stageAll, action: () => void stage([], true) }, { label: t.discardAll, action: () => setPending({ kind: 'discard', paths: unstaged.map((file) => file.path) }) }]} close={() => setSectionMenu(undefined)} />}
    {pending && <ConfirmDialog eyebrow={pending.kind === 'stash' ? t.stashFile : t.discardChanges} title={pending.kind === 'stash' ? t.stashTitle(pending.paths[0]!) : pending.paths.length === 1 ? t.discardTitleOne(pending.paths[0]!) : t.discardTitleMany(pending.paths.length)} text={pending.kind === 'stash' ? t.stashText : t.discardText} ok={pending.kind === 'stash' ? t.stashOk : t.discardChanges} danger={pending.kind === 'discard'} cancel={() => setPending(undefined)} confirm={() => { const action = pending; setPending(undefined); void perform(action.kind, action.paths) }} />}</div>
}

function CommitDetail({ row, graph, profiles, board, focus, setFocus, openCardGit, openFile, editMessage }: { row: GitRow; graph: GitGraph; profiles: AgentProfile[]; board: ProjectBoard; focus: string | null; setFocus(id: string | null): void; openCardGit(cardId: string): void; openFile(file: GitCommitFile): void; editMessage?(): void }): React.JSX.Element {
  const t = useT().git.page
  const [detail, setDetail] = useState<{ body: string; files: GitCommitFile[] }>(), [error, setError] = useState(''), [moreBody, setMoreBody] = useState(false)
  useEffect(() => { setDetail(undefined); setError(''); setMoreBody(false); void window.agentboard.invoke('git:commit-detail', { sourceId: graph.repo.sourceId, hash: row.hash }).then(setDetail).catch((reason: unknown) => setError(plainError(reason))) }, [graph.repo.sourceId, row.hash])
  const card = board.cards.find((item) => item.id === row.cardId), branch = graph.worktrees.find((item) => item.cardId === row.cardId)?.branch
  const files = detail?.files ?? []
  return <>
    {card && <CardButton cardId={card.id} title={card.title} branch={branch} focus={focus} setFocus={setFocus} openCardGit={openCardGit} />}
    <div className="gmeta"><span>{t.commitWord} <code>{row.short}</code>{row.parents.length > 1 ? t.mergeSuffix : ''}</span></div>{editMessage ? <button type="button" className="gstashname" data-tip={t.editLastMessageTip} onClick={editMessage}>{row.subject} {gitIcons.pen}</button> : <h3>{row.subject}</h3>}
    <div className="gmeta"><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Who row={row} profiles={profiles} /> · {shortAgo(row.date)}</span>{row.parents.length > 0 && <span>{t.parent} <code>{row.parents.map((hash) => hash.slice(0, 7)).join(', ')}</code></span>}</div>
    {detail?.body && detail.body !== row.subject && (() => { const text = detail.body.replace(row.subject, '').trim(), long = text.length > 180 || text.split('\n').length > 3; return <><p className={`gbody ${long && !moreBody ? 'short' : ''}`}>{text}</p>{long && <button type="button" className="gmore" aria-expanded={moreBody} onClick={() => setMoreBody(!moreBody)}>{moreBody ? t.seeLess : t.seeMore}</button>}</> })()}
    {!card && <div className="cgnote">{t.noCardCommit}</div>}
    {error ? <p className="error">{error}</p> : <><div className="cglabel">{t.filesCount(files.length)} · <FileCounts files={files} /></div><div className="gfiles">{files.map((file) => <FileRow key={file.path} file={file} onOpen={() => openFile(file)} />)}</div></>}
  </>
}

function StashDetail({ row, sourceId, cardId, busy, action, rename }: { row: GitRow; sourceId: string; cardId: string | null; busy: boolean; action(action: StashMenuAction, ref: string): void; rename(): void }): React.JSX.Element {
  const t = useT().git.page
  const [files, setFiles] = useState<GitCommitFile[]>(), [error, setError] = useState('')
  const stash = row.stash!
  useEffect(() => { let alive = true; setFiles(undefined); setError(''); void window.agentboard.invoke('git:stash-detail', { sourceId, cardId, ref: stash.ref, commit: stash.commit }).then((result) => { if (alive) setFiles(result.files) }).catch((reason: unknown) => { if (alive) setError(plainError(reason)) }); return () => { alive = false } }, [sourceId, cardId, stash.ref, stash.commit])
  return <><div className="gmeta"><span>{t.stashDetail(stash.ref)}</span></div><button type="button" className="gstashname" data-tip={t.editStashNameTip} onClick={rename}>{row.subject} {gitIcons.pen}</button><div className="gmeta"><span>{t.stashBase(row.parents[0]?.slice(0, 7))}</span></div><div className="cgrow">{stashItems().map((item) => <button type="button" className="mini secondary" key={item.key} disabled={busy} onClick={() => action(item.key, stash.ref)}>{item.label}</button>)}</div>{error ? <p className="error">{error}</p> : files ? <><div className="cglabel">{t.filesCount(files.length)} · <FileCounts files={files} /></div><div className="gfiles">{files.map((file) => <FileRow key={file.path} file={file} />)}</div></> : <p className="gmeta">{t.loadingFiles}</p>}</>
}

/** Código do arquivo alterado (diff) na área do grafo: abre ao clicar num arquivo do WIP. */
function DiffView({ viewer, close, changed }: { viewer: { sourceId: string; cardId: string | null; hash?: string; file: GitChange }; close(): void; changed(): void }): React.JSX.Element {
  const { common, git: { page: t } } = useT()
  const { sourceId, cardId, file, hash } = viewer
  const [error, setError] = useState(''), [discard, setDiscard] = useState(false)
  const act = async (action: 'stage' | 'discard'): Promise<void> => { try { if (action === 'stage') await window.agentboard.invoke('git:stage', { sourceId, cardId, paths: [file.path], stage: !file.staged }); else await window.agentboard.invoke('git:discard-unstaged', { sourceId, cardId, paths: [file.path] }); window.dispatchEvent(new Event(gitChangedEvent)); changed(); close() } catch (reason) { setError(plainError(reason)) } }
  return <section className="gdiffview" style={{ gridColumn: '1 / span 2' }} aria-label={t.changesOf(file.path)}><header><span className={`st ${file.status}`}>{file.status}</span><b data-tip={file.path}>{file.path}</b><small>{hash ? t.commitHash(hash.slice(0, 7)) : file.staged ? t.staged : t.notStaged}</small><span className="gdstat"><span className="p">+{file.additions}</span> <span className="m">−{file.deletions}</span></span><span className="grow1" /><button type="button" className="fv-toggle" data-tip={t.openCurrentTip} onClick={() => void openInEditor({ sourceId, cardId, path: file.path }).then(close).catch((reason: unknown) => setError(plainError(reason)))}>{t.openInEditor}</button><button type="button" className="x" onClick={close} aria-label={common.close}>×</button></header>
    {!hash && <div className="gdiff-actions">{!file.staged && <button type="button" className="gwdiscard" data-tip={t.discardChanges} aria-label={t.discardChanges} onClick={() => setDiscard(true)}>{gitIcons.trash}</button>}<button type="button" className={`gwall ${file.staged ? 'un' : ''}`} onClick={() => void act('stage')}>{file.staged ? t.unstageFile : t.stageFile}</button></div>}
    <div className="gdiffbody">{error && <p className="error">{error}</p>}<GitDiffEditor sourceId={sourceId} cardId={cardId} path={file.path} hash={hash} mode={file.staged ? 'staged' : 'unstaged'} /></div>{discard && <ConfirmDialog eyebrow={t.discardChanges} title={t.discardTitleOne(file.path)} text={t.discardDiffText} ok={t.discardChanges} danger cancel={() => setDiscard(false)} confirm={() => { setDiscard(false); void act('discard') }} />}</section>
}

type PullMode = 'fetch-all' | 'ff' | 'ff-only' | 'rebase'
const pullModes: PullMode[] = ['fetch-all', 'ff', 'ff-only', 'rebase']
const pullKey = 'agentboard.gitPull'
const loadPull = (): PullMode => { try { const value = localStorage.getItem(pullKey); return pullModes.some((id) => id === value) ? value as PullMode : 'ff' } catch { return 'ff' } }
/** Largura das duas colunas laterais (lateral esquerda e detalhe à direita): arrastáveis, com mínimo e máximo; duplo clique volta ao padrão. */
const paneLimits = { side: { min: 170, max: 420, def: 230 }, detail: { min: 270, max: 620, def: 330 } } as const
const paneKey = 'agentboard.gitPanes'
const loadPanes = (): { side: number; detail: number } => {
  try { const saved = JSON.parse(localStorage.getItem(paneKey) ?? '{}') as Partial<Record<'side' | 'detail', number>>; return { side: clamp(saved.side ?? paneLimits.side.def, 'side'), detail: clamp(saved.detail ?? paneLimits.detail.def, 'detail') } } catch { return { side: paneLimits.side.def, detail: paneLimits.detail.def } }
}
const clamp = (value: number, pane: 'side' | 'detail'): number => Math.max(paneLimits[pane].min, Math.min(paneLimits[pane].max, Math.round(value)))
const graphMin = 36
const colKey = 'agentboard.gitCols'
const loadCols = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(colKey) ?? '{}') as Record<string, number> } catch { return {} } }

function RepoTabs({ repos, selected, select, reorder, alerts, conflicts }: { repos: GitRepo[]; selected?: string; select(id: string): void; reorder(id: string, index: number): void; alerts(sourceId: string): number; conflicts: Array<ConflictTarget & { operation: keyof typeof operationLabel; files: string[] }> }): React.JSX.Element {
  const t = useT().git.page
  const [dragging, setDragging] = useState<string>(), [drop, setDrop] = useState<number>(), geometry = useRef<number[]>([]), dragWidth = useRef(0)
  const position = (x: number): number => { const index = geometry.current.findIndex((center) => x < center); return index < 0 ? geometry.current.length : index }
  let visibleIndex = 0
  const dragged = repos.find((repo) => repo.sourceId === dragging)
  const placeholder = dragged ? <span className="gtab gtab-placeholder" style={{ width: dragWidth.current }} aria-hidden="true">{gitIcons.repo}<span className="gtn">{dragged.name}</span></span> : null
  return <div className="gtabs" role="tablist" aria-label={t.reposAria} onDragOver={(event) => { if (!event.dataTransfer.types.includes('application/x-agentboard-git-repo')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDrop(position(event.clientX)) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(undefined) }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('application/x-agentboard-git-repo'); if (id) reorder(id, drop ?? position(event.clientX)); setDragging(undefined); setDrop(undefined) }}>
    {repos.map((repo) => { const index = repo.sourceId === dragging ? -1 : visibleIndex++; const flagged = conflicts.filter((entry) => entry.sourceId === repo.sourceId), total = flagged.reduce((sum, entry) => sum + entry.files.length, 0); return <React.Fragment key={repo.sourceId}>{index >= 0 && drop === index && placeholder}<button type="button" role="tab" data-repo-tab={repo.sourceId} aria-selected={repo.sourceId === selected} className={`gtab ${repo.sourceId === selected ? 'on' : ''} ${repo.sourceId === dragging ? 'dragging' : ''}`} draggable onDragStart={(event) => { const source = event.currentTarget, rect = source.getBoundingClientRect(), tabs = [...source.parentElement!.querySelectorAll<HTMLElement>('[data-repo-tab]')], sourceIndex = tabs.indexOf(source); dragWidth.current = Math.round(rect.width); geometry.current = tabs.filter((tab) => tab !== source).map((tab, i) => { const box = tab.getBoundingClientRect(); return box.left + box.width / 2 - (i >= sourceIndex ? rect.width + 4 : 0) }); window.setTimeout(() => { setDragging(repo.sourceId); setDrop(sourceIndex) }, 0); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-agentboard-git-repo', repo.sourceId) }} onDragEnd={() => { setDragging(undefined); setDrop(undefined); geometry.current = [] }} data-tip={`${repo.path}${repo.head ? ` · ${repo.head}` : ''}`} onClick={() => select(repo.sourceId)}>{gitIcons.repo}<span className="gtn">{repo.name}</span>{alerts(repo.sourceId) > 0 && <i className="ydot" data-tip={t.prsWithNews(alerts(repo.sourceId))} />}{flagged.length > 0 && <span className="gtab-conflict" data-tip={t.repoConflictOps(flagged.length)}>{t.conflictTab}{total ? ` · ${total}` : ''}</span>}</button></React.Fragment> })}
    {dragging && drop === visibleIndex && placeholder}
  </div>
}

const reposCacheKey = (projectId: string): string => `agentboard.gitRepos.${projectId}`
/** Última lista de repositórios do projeto: as abas aparecem na hora e a detecção atualiza por baixo dos panos. */
function cachedRepos(projectId: string): GitRepo[] | undefined {
  try { const value: unknown = JSON.parse(localStorage.getItem(reposCacheKey(projectId)) ?? 'null'); const list = Array.isArray(value) ? value.filter((item): item is GitRepo => typeof item === 'object' && item !== null && typeof (item as GitRepo).sourceId === 'string' && typeof (item as GitRepo).name === 'string') : []; return list.length ? list : undefined } catch { return undefined }
}
/** Aba Git do quadro: um repositório por vez, branches/worktrees/stashes na lateral, grafo no centro e o detalhe do commit à direita. */
export function GitPage({ board, prs, profiles, openCardGit, focusRequest }: { board: ProjectBoard; prs: PullRequestsState; profiles: AgentProfile[]; openCardGit(cardId: string): void; focusRequest?: { cardId: string; at: number } }): React.JSX.Element {
  const T = useT(), t = T.git.page, common = T.common
  const projectId = board.project.id
  const [repos, setRepos] = useState<GitRepo[] | undefined>(() => cachedRepos(projectId)), [repoId, setRepoId] = useState<string | undefined>(() => { const list = cachedRepos(projectId); if (!list) return undefined; try { const saved = localStorage.getItem(`agentboard.gitRepo.${projectId}`); return list.find((item) => item.sourceId === saved)?.sourceId ?? list[0]?.sourceId } catch { return list[0]?.sourceId } }), [graph, setGraph] = useState<GitGraph>(), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('')
  const repoOrderKey = `agentboard.gitRepoOrder.${projectId}`
  const sortRepos = (items: GitRepo[]): GitRepo[] => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(repoOrderKey) ?? '[]'); if (!Array.isArray(saved)) return items; const order = new Map(saved.filter((id): id is string => typeof id === 'string').map((id, index) => [id, index])); return [...items].sort((a, b) => (order.get(a.sourceId) ?? Infinity) - (order.get(b.sourceId) ?? Infinity)) } catch { return items }
  }
  const dropRepo = (source: string, index: number): void => {
    if (!repos) return
    const item = repos.find((repo) => repo.sourceId === source); if (!item) return
    const next = repos.filter((repo) => repo.sourceId !== source)
    next.splice(Math.max(0, Math.min(index, next.length)), 0, item); setRepos(next)
    try { localStorage.setItem(repoOrderKey, JSON.stringify(next.map((repo) => repo.sourceId))) } catch { /* só vale nesta sessão */ }
  }
  const [worktree, setWorktree] = useState<string | null>(null), [prOpen, setPrOpen] = useState(false)
  const [renameStash, setRenameStash] = useState<{ ref: string; commit: string; message: string }>()
  const [renameCommit, setRenameCommit] = useState<{ hash: string; message: string; confirm: boolean }>()
  const [focus, setFocus] = useState<string | null>(null), [sel, setSel] = useState<string | null>(null), [open, setOpen] = useState(false), [cols, setCols] = useState(loadCols), [summaries, setSummaries] = useState<Record<string, string>>({})
  const list = useRef<HTMLDivElement>(null)
  const [panes, setPanes] = useState(loadPanes), page = useRef<HTMLElement>(null)
  const gripPane = (pane: 'side' | 'detail') => (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const start = event.clientX, w0 = panes[pane], total = page.current?.getBoundingClientRect().width ?? 0, other = pane === 'side' ? panes.detail : panes.side
    // O centro (grafo) nunca fica menor que 320px.
    const room = total ? total - other - 320 : paneLimits[pane].max
    const move = (ev: PointerEvent): void => { const delta = pane === 'side' ? ev.clientX - start : start - ev.clientX; setPanes((current) => ({ ...current, [pane]: Math.min(clamp(w0 + delta, pane), Math.max(paneLimits[pane].min, room)) })) }
    const up = (): void => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.body.classList.remove('gresizing')
      setPanes((current) => { try { localStorage.setItem(paneKey, JSON.stringify(current)) } catch { /* só vale nesta sessão */ } return current })
    }
    document.body.classList.add('gresizing'); document.addEventListener('pointermove', move); document.addEventListener('pointerup', up)
  }
  const resetPane = (pane: 'side' | 'detail') => (): void => setPanes((current) => { const next = { ...current, [pane]: paneLimits[pane].def }; try { localStorage.setItem(paneKey, JSON.stringify(next)) } catch { /* só vale nesta sessão */ } return next })
  const pullOptions = pullModes.map((id) => ({ id, label: t.pullMode[id] }))
  const [pullMode, setPullMode] = useState<PullMode>(loadPull), [pullMenu, setPullMenu] = useState(false), pullBox = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (!pullMenu) return; const out = (e: MouseEvent): void => { if (!pullBox.current?.contains(e.target as Node)) setPullMenu(false) }; document.addEventListener('mousedown', out); return () => document.removeEventListener('mousedown', out) }, [pullMenu])
  const [viewer, setViewer] = useState<{ sourceId: string; cardId: string | null; hash?: string; file: GitChange }>()
  useEffect(() => { if (!viewer) return; const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') setViewer(undefined) }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [viewer])
  useEffect(() => { if (focusRequest) setFocus(focusRequest.cardId) }, [focusRequest])
  const title = (cardId: string | null): string => board.cards.find((card) => card.id === cardId)?.title ?? common.card
  // Rolagem infinita: começa com 100 commits e, ao chegar perto do fim, pede mais 100 (de novo e de novo, até acabar o histórico).
  const pageCommits = 100
  const [limit, setLimit] = useState(pageCommits), [more, setMore] = useState(false)
  const load = useCallback(async (id = repoId): Promise<void> => {
    if (!id) return
    try { setGraph(await window.agentboard.invoke('git:graph', { projectId, sourceId: id, cardId: worktree, limit })); setError('') } catch (reason) { setError(plainError(reason)) } finally { setMore(false) }
  }, [projectId, repoId, limit, worktree])
  useEffect(() => { setLimit(pageCommits) }, [repoId])
  const onListScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    if (!graph?.truncated || more) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) { setMore(true); setLimit((current) => current + pageCommits) }
  }
  useEffect(() => { const cached = cachedRepos(projectId); if (cached) setRepos(sortRepos(cached)) }, [projectId])
  useEffect(() => { void window.agentboard.invoke('git:detect', { projectId }).then(({ repos: items, changed }) => { if (changed) window.dispatchEvent(new Event(gitChangedEvent)); setRepos(sortRepos(items)); try { if (items.length) localStorage.setItem(reposCacheKey(projectId), JSON.stringify(items)); else localStorage.removeItem(reposCacheKey(projectId)) } catch { /* só vale nesta sessão */ } setRepoId((current) => { const saved = (() => { try { return localStorage.getItem(`agentboard.gitRepo.${projectId}`) } catch { return null } })(); return current && items.some((item) => item.sourceId === current) ? current : items.find((item) => item.sourceId === saved)?.sourceId ?? items[0]?.sourceId }) }).catch((reason: unknown) => setError(plainError(reason))) }, [projectId])
  useEffect(() => { setGraph(undefined); setSel(null); setOpen(false); setPicked(undefined) }, [repoId])
  useEffect(() => { void load(repoId) }, [repoId, load])
  // Ao abrir o repositório, atualiza o remoto por baixo dos panos: assim o Push já sabe se está atrás antes de tentar.
  useEffect(() => { if (repoId) void window.agentboard.invoke('git:sync', { sourceId: repoId, cardId: null, action: 'fetch' }).then(() => load(repoId)).catch(() => undefined) }, [repoId])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (['agentboard/card-updated', 'agentboard/run-completed'].includes(event.eventType)) void load() }), [load])
  useEffect(() => { const again = (): void => void load(); window.addEventListener('focus', again); return () => window.removeEventListener('focus', again) }, [load])
  useEffect(() => { if (graph && sel && !graph.rows.some((row) => row.hash === sel)) { setSel(null); setOpen(false) } }, [graph, sel])
  useEffect(() => { const key = (e: KeyboardEvent): void => { if (e.key === 'Escape' && focus && !document.querySelector('.overlay')) setFocus(null) }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [focus])

  const rows = graph?.rows ?? []
  const dimmed = useCallback((row: GitRow): boolean => Boolean(focus) && row.cardId !== focus, [focus])
  const lanes = rows.reduce((max, row) => Math.max(max, row.lane), 0) + 1, autoWidth = Math.max(64, 20 + lanes * laneSpacing)
  // Coluna do grafo estreita: as pistas se aproximam e, no mínimo, viram uma linha só.
  const width = Math.max(graphMin, Math.min(cols.cg ?? autoWidth, autoWidth)), spacing = lanes > 1 ? Math.max(0, Math.min(laneSpacing, (width - 32) / (lanes - 1))) : laneSpacing
  const edges = useMemo(() => graphEdges(rows, dimmed, rowHeight, spacing), [rows, dimmed, spacing])
  const selected = rows.find((row) => row.hash === sel)
  // Cada operação termina com um aviso flutuante (verde se deu certo, vermelho se falhou) e com o texto também guardado em `notice`.
  const opTitle = t.opTitle
  const report = (action: string, ok: boolean | 'warn', text: string, warnTitle?: string): void => {
    setNotice(text)
    const name = opTitle[action] ?? action
    // O repositório e a branch aparecem em letra pequena: com vários repositórios abertos, diz onde a operação rodou.
    const meta = graph ? `${graph.repo.name}${graph.repo.head ? ` · ${graph.repo.head}` : ''}` : undefined
    if (ok === 'warn') toast.warning(warnTitle ?? name, text, { meta }); else if (ok) toast.success(t.opDone(name), text, { meta }); else toast.error(t.opFailed(name), text, { meta })
  }
  const [pushRejected, setPushRejected] = useState(false)
  const sync = async (action: 'fetch' | 'pull' | 'push' | 'stash' | 'pop', pull?: 'ff' | 'ff-only' | 'rebase', force?: boolean): Promise<void> => {
    if (!graph) return
    setBusy(action); setNotice('')
    try { const out = await window.agentboard.invoke('git:sync', { sourceId: graph.repo.sourceId, cardId: worktree, action, pull, force }); if (out.conflicts) report(action, 'warn', out.output, t.stashConflictTitle); else report(action, true, out.output.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? t.done); await load() } catch (reason) {
      const text = plainError(reason)
      // Push recusado (ex.: depois de um amend): em vez de só avisar o erro, oferece Pull ou Forçar push.
      if (action === 'push' && !force && errorCodeOf(text) === 'git-push-rejected') setPushRejected(true); else report(action, false, withoutErrorCode(text))
    } finally { setBusy('') }
  }
  const [picked, setPicked] = useState<string>(), [menu, setMenu] = useState<{ x: number; y: number; kind: 'local' | 'remote' | 'commit' | 'stash'; name: string }>(), [wtMenu, setWtMenu] = useState<{ x: number; y: number; cardId: string; branch: string }>(), [wtDelete, setWtDelete] = useState<{ cardId: string; sourceId?: string }>(), [folderMenu, setFolderMenu] = useState<{ x: number; y: number; folder: string; names: string[] }>(), [allConflicts, setAllConflicts] = useState<Array<ConflictTarget & { operation: keyof typeof operationLabel; files: string[] }>>([]), [resolveTarget, setResolveTarget] = useState<ConflictTarget>(), [ask, setAsk] = useState<{ kind: 'create' | 'delete' | 'delete-folder' | 'delete-remote' | 'commit-branch' | 'commit-tag' | 'reset-hard'; name: string; names?: string[] }>(), [newName, setNewName] = useState(''), [createError, setCreateError] = useState(''), [creating, setCreating] = useState(false)
  const refreshConflicts = useCallback(() => { void window.agentboard.invoke('git:conflicts-all', { projectId }).then(setAllConflicts).catch(() => undefined) }, [projectId])
  useEffect(() => { refreshConflicts() }, [graph, notice, resolveTarget, refreshConflicts])
  const conflictDirty = useRef(false)
  /** Sair da visão de conflitos com edição sem salvar pede confirmação. */
  const { ask: confirmAsk, dialog: confirmDialog } = useAsk()
  useEscape(() => { if (!creating) setAsk(undefined) }, ask?.kind === 'create' || ask?.kind === 'commit-branch' || ask?.kind === 'commit-tag')
  const nameProblem = branchNameProblem(newName.trim())
  const leaveConflicts = async (): Promise<boolean> => !conflictDirty.current || confirmAsk({ eyebrow: t.resolveConflicts, title: t.discardEditTitle, text: t.discardEditText, ok: t.discard, danger: true })
  const resolve = async (entry: ConflictTarget): Promise<void> => { if (resolveTarget && !(await leaveConflicts())) return; setRepoId(entry.sourceId); setViewer(undefined); setResolveTarget(entry) }
  /** Devolve o erro (ou `null` no sucesso) para o diálogo de nome mostrar no lugar e continuar aberto. */
  const branchAction = async (action: Exclude<BranchAction, 'copy'>, name: string, extra?: { newName?: string }): Promise<string | null> => {
    if (!graph) return null
    setBusy(action); setNotice('')
    try { const out = await window.agentboard.invoke('git:branch-action', { sourceId: graph.repo.sourceId, cardId: worktree, action, name, ...extra }); report(action, true, out.output.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? t.done); await load(); return null } catch (reason) { const message = plainError(reason); report(action, false, message); return message } finally { setBusy('') }
  }
  const deleteFolderBranches = async (names: string[]): Promise<void> => {
    if (!graph || !names.length) return
    setBusy('delete'); setNotice('')
    const failed: string[] = []
    for (const name of names) {
      try { await window.agentboard.invoke('git:branch-action', { sourceId: graph.repo.sourceId, cardId: worktree, action: 'delete', name }) } catch { failed.push(name) }
    }
    const deleted = names.length - failed.length
    const text = failed.length ? t.foldersPartial(deleted, failed.length) : t.branchesDeleted(deleted)
    report('delete', !failed.length ? true : deleted ? 'warn' : false, text, t.someBranchesNotDeleted); await load(); setBusy('')
  }
  const openRemoteBranch = async (name: string): Promise<void> => {
    if (!graph || busy) return
    setBusy('checkout'); setNotice('')
    try { const out = await window.agentboard.invoke('git:checkout-remote', { sourceId: graph.repo.sourceId, cardId: worktree, name }); report('checkout', true, out.output) } catch (reason) { report('checkout', false, plainError(reason)) } finally { await load(); setBusy('') }
  }
  const commitAction = async (action: Exclude<CommitMenuAction, 'copy'>, hash: string, name?: string): Promise<string | null> => {
    if (!graph) return null
    setBusy(action); setNotice('')
    try { const out = await window.agentboard.invoke('git:commit-action', { sourceId: graph.repo.sourceId, cardId: worktree, action, hash, name }); report(action, true, out.output); await load(); return null } catch (reason) { const message = plainError(reason); report(action, false, message); return message } finally { setBusy('') }
  }
  const stashAction = async (action: StashMenuAction, ref: string): Promise<void> => {
    if (!graph) return
    setBusy(action); setNotice('')
    try { const out = await window.agentboard.invoke('git:stash-action', { sourceId: graph.repo.sourceId, cardId: worktree, action, ref }); if (out.conflicts) report(action, 'warn', out.output, t.stashConflictTitle); else report(action, true, out.output); await load() } catch (reason) { report(action, false, plainError(reason)) } finally { setBusy('') }
  }
  const beginRenameStash = (ref: string): void => { const row = rows.find((item) => item.stash?.ref === ref); if (row?.stash) setRenameStash({ ref, commit: row.stash.commit, message: row.subject }) }
  const saveStashName = async (): Promise<void> => {
    if (!graph || !renameStash) return
    try { const result = await window.agentboard.invoke('git:stash-rename', { sourceId: graph.repo.sourceId, cardId: worktree, ...renameStash }); const hash = `stash:${result.commit}:${result.ref}`; setRenameStash(undefined); await load(); setSel(hash); setOpen(true); setPicked(`stash:${result.ref}`); toast.info(t.stashRenamed) } catch (reason) { toast.error(t.stashRenameFailed, plainError(reason)) }
  }
  const saveCommitName = async (): Promise<void> => {
    if (!graph || !renameCommit) return
    try { const result = await window.agentboard.invoke('git:rename-commit', { sourceId: graph.repo.sourceId, cardId: worktree, hash: renameCommit.hash, message: renameCommit.message }); setRenameCommit(undefined); await load(); setSel(result.hash); setOpen(true); toast.info(t.commitMessageUpdated) } catch (reason) { toast.error(t.commitMessageFailed, plainError(reason)) }
  }
  const runCommitMenu = (action: CommitMenuAction): void => {
    const current = menu; setMenu(undefined)
    if (!current) return
    if (action === 'copy') { void navigator.clipboard.writeText(current.name).then(() => toast.info(t.shaCopied)).catch(() => toast.error(t.copyFailed, t.clipboardDenied)); return }
    if (action === 'branch' || action === 'tag') { setNewName(''); setCreateError(''); setAsk({ kind: action === 'branch' ? 'commit-branch' : 'commit-tag', name: current.name }); return }
    if (action === 'reset-hard') { setAsk({ kind: 'reset-hard', name: current.name }); return }
    void commitAction(action, current.name)
  }
  const runMenu = (action: BranchAction): void => {
    const current = menu; setMenu(undefined)
    if (!current) return
    if (action === 'copy') { void navigator.clipboard.writeText(current.name).then(() => toast.info(t.nameCopied)).catch(() => toast.error(t.copyFailed, t.clipboardDenied)); return }
    if (action === 'create') { setNewName(''); setCreateError(''); setAsk({ kind: 'create', name: current.name }); return }
    if (action === 'delete') {
      const owner = graph?.branches.local.find((item) => item.name === current.name)?.cardId
      if (owner) { toast.error(t.deleteBranchFailed, t.branchOwnedByCard(current.name, title(owner))); return }
      setAsk({ kind: 'delete', name: current.name }); return
    }
    if (action === 'delete-remote') { setAsk({ kind: 'delete-remote', name: current.name }); return }
    void branchAction(action, current.name)
  }
  // Clicar numa branch da lateral seleciona o commit da ponta dela: o grafo rola até lá e o detalhe abre à direita.
  const pickBranch = (kind: 'local' | 'remote', name: string): void => {
    setPicked(`${kind}:${name}`)
    const row = rows.find((item) => item.refs.some((ref) => ref.name === name && (kind === 'remote' ? ref.kind === 'remote' : ref.kind !== 'remote' && ref.kind !== 'tag')))
    if (!row) { toast.info(t.branchNotInHistory, t.branchNotInHistoryText); return }
    setSel(row.hash); setOpen(true)
    window.requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-hash="${row.hash}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }
  // Bordas das colunas (para as alças de redimensionar que correm por todas as linhas, não só no cabeçalho).
  const [colEdges, setColEdges] = useState<number[]>([])
  useEffect(() => {
    const box = list.current; if (!box) return
    const measure = (): void => {
      const next = Array.from(box.querySelectorAll<HTMLElement>('.ghead > span'), (cell) => Math.round(cell.offsetLeft + cell.offsetWidth))
      setColEdges((current) => current.length === next.length && current.every((value, index) => value === next[index]) ? current : next)
    }
    measure()
    const observer = new ResizeObserver(measure); observer.observe(box); const head = box.querySelector('.ghead'); if (head) observer.observe(head)
    return () => observer.disconnect()
  })
  const clickRow = (row: GitRow): void => { if (open && sel === row.hash) setOpen(false); else { setSel(row.hash); setOpen(true) } }
  const grip = (key: 'cr' | 'cg' | 'cm' | 'cc', min: number, cell: number) => (e: React.PointerEvent<HTMLElement>): void => {
    e.preventDefault(); e.stopPropagation()
    const box = list.current, head = box?.querySelectorAll<HTMLElement>('.ghead > span')[cell]
    if (!head) return
    const start = e.clientX, w0 = head.getBoundingClientRect().width
    document.body.classList.add('gresizing')
    const move = (ev: PointerEvent): void => { const value = Math.max(min, Math.min(key === 'cg' ? autoWidth : Infinity, Math.round(w0 + ev.clientX - start))); if (key !== 'cg') box?.style.setProperty(`--${key}`, `${value}px`); if (key === 'cm') box?.classList.add('fixedcm'); setCols((current) => ({ ...current, [key]: value })) }
    const up = (): void => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.body.classList.remove('gresizing'); setCols((current) => { try { localStorage.setItem(colKey, JSON.stringify(current)) } catch { /* só vale nesta sessão */ } return current }) }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up)
  }

  // Pull sem branch remota ligada: pergunta com qual remoto/branch a branch atual puxa e envia, liga e então puxa.
  // Fica antes do retorno da tela vazia: nenhum hook pode vir depois de um return.
  const [upstreamAsk, setUpstreamAsk] = useState<{ branch: string; remotes: string[]; mode: 'ff' | 'ff-only' | 'rebase' }>()
  if (repos && !repos.length) return <div className="gwrap"><GitEmpty projectId={projectId} done={(items) => { setRepos(items); setRepoId(items[0]?.sourceId) }} /></div>
  const labels = rows.map((row) => agoLabel(row.date))
  const side = <GitSide graph={graph} worktree={worktree} selectWorktree={(id) => { if (id !== worktree) setGraph(undefined); setWorktree(id); setFocus(null); setSel(null); setOpen(false); setViewer(undefined) }} title={title} icons={gitIcons} picked={picked} onPick={pickBranch} onPickStash={(ref) => { const row = rows.find((item) => item.stash?.ref === ref); if (!row) return; setPicked(`stash:${ref}`); setSel(row.hash); setOpen(true); window.requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-hash="${row.hash}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })) }} onOpen={(kind, name, current) => { if (current) toast.info(t.alreadyOn(name)); else void branchAction('checkout', name) }} onMenu={(kind, name, event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, kind, name }) }} onFolderMenu={(_kind, folder, names, event) => setFolderMenu({ x: event.clientX, y: event.clientY, folder, names })} onWorktreeMenu={(cardId, branch, event) => setWtMenu({ x: event.clientX, y: event.clientY, cardId, branch })} />
  const tool = (icon: React.JSX.Element, label: string, action: 'push' | 'stash' | 'pop', remote = true): React.JSX.Element => <button type="button" className="gtool" disabled={Boolean(busy) || (remote && !graph?.repo.hasRemote)} data-tip={remote && !graph?.repo.hasRemote ? T.git.view.noRemote : undefined} onClick={() => { if (action === 'push' && (graph?.branches.local.find((item) => item.head)?.behind ?? 0) > 0) setPushRejected(true); else void sync(action) }}>{icon}{busy === action ? '…' : label}</button>
  // O botão de fora roda o padrão; cada opção do menu roda a sua na hora (sem mudar o padrão).
  const pullNow = (mode: PullMode = pullMode): void => {
    if (mode === 'fetch-all') { void sync('fetch'); return }
    if (!graph) return
    void window.agentboard.invoke('git:upstream', { sourceId: graph.repo.sourceId, cardId: worktree }).then((info) => {
      if (info.branch && !info.upstream && info.remotes.length) setUpstreamAsk({ branch: info.branch, remotes: info.remotes, mode })
      else void sync('pull', mode)
    }).catch(() => { void sync('pull', mode) })
  }
  const pullTool = <span className="gsplit" ref={pullBox}><button type="button" className="gtool" disabled={Boolean(busy) || !graph?.repo.hasRemote} data-tip={graph?.repo.hasRemote ? pullOptions.find((item) => item.id === pullMode)?.label : T.git.view.noRemote} onClick={() => pullNow()}>{gitIcons.pull}{busy === 'pull' || busy === 'fetch' ? '…' : 'Pull'}</button>
    <button type="button" className="gtool gcaret" aria-label={t.pullOptions} aria-expanded={pullMenu} onClick={() => setPullMenu(!pullMenu)}>▾</button>
    {pullMenu && <div className="gpullmenu" role="menu"><p>{t.pullMenuHint}</p>{pullOptions.map((item) => <div className={`gpullrow ${pullMode === item.id ? 'on' : ''}`} key={item.id}>
      <button type="button" role="menuitemradio" aria-checked={pullMode === item.id} className="gpulldef" data-tip={t.setPullDefault} aria-label={t.setPullDefaultOf(item.label)} onClick={() => { setPullMode(item.id); try { localStorage.setItem(pullKey, item.id) } catch { /* só vale nesta sessão */ } }}><i /></button>
      <button type="button" role="menuitem" className="gpullrun" disabled={Boolean(busy) || !graph?.repo.hasRemote} onClick={() => { setPullMenu(false); pullNow(item.id) }}>{item.label}{pullMode === item.id && <small>{t.defaultBadge}</small>}</button></div>)}</div>}</span>
  const colStyle = { '--gw': `${width}px`, ...Object.fromEntries(Object.entries(cols).map(([k, v]) => [`--${k}`, `${v}px`])) } as React.CSSProperties
  const center = <section className="gcenter"><div className="gtools">{pullTool}{tool(gitIcons.push, 'Push', 'push')}{tool(gitIcons.stash, 'Stash', 'stash', false)}{tool(gitIcons.stash, 'Pop', 'pop', false)}<span className="sep" />
    <button type="button" className={`gtool ${prOpen ? 'on' : ''}`} aria-pressed={prOpen} data-tip={t.prsTip} onClick={() => setPrOpen(!prOpen)}>{t.prsButton}{repoId && prs.unread(repoId).length > 0 && <i className="ydot" />}</button><span className="sep" />
    {focus ? <button type="button" className="gonly on" onClick={() => setFocus(null)}>{gitIcons.graph}{t.onlyCard(title(focus))}</button> : <span className="gonly">{gitIcons.graph}{t.allBranches}</span>}
    <span className="gcur">{worktree ? t.worktreeOfIn(title(worktree)) : t.mainFolderIn}<b>{graph?.repo.head ?? '—'}</b></span></div>
    {error && <p className="error" style={{ margin: '10px 14px' }}>{error}</p>}
    <div className={`glist ${cols.cm ? 'fixedcm' : ''}`} style={colStyle} ref={list} onScroll={onListScroll} onClick={(e) => { if (focus && !(e.target as HTMLElement).closest('.grow,.ghead')) setFocus(null) }}>
      <div className="ghead">{t.columns.map((label) => <span key={label}>{label}</span>)}</div>
      {colEdges.length === 4 && ([['cr', 90], ['cg', graphMin], ['cm', 160], ['cc', 120]] as const).map(([key, min], cell) => <i key={key} className="gcolfull" data-tip={t.dragToResize} style={{ left: colEdges[cell]! - 4, height: 28 + rows.length * rowHeight }} onPointerDown={grip(key, min, cell)} />)}
      <svg className="gsvg" width={width} height={rows.length * rowHeight} aria-hidden="true">{edges.map((edge, i) => <path key={i} d={edge.d} stroke={edge.color} strokeWidth={1.5} fill="none" strokeDasharray={edge.wip ? '3 3' : undefined} opacity={edge.dim ? 0.3 : 1} />)}</svg>
      {!graph && !error && <div className="gskel" aria-busy="true" aria-label={t.loadingHistory}>{Array.from({ length: 16 }, (_, index) => <div className="gskel-row" key={index} style={{ '--w': `${46 + ((index * 37) % 44)}%` } as React.CSSProperties}><span className="gskel-chip" /><span className="gskel-dot" /><span className="gskel-bar" /><span className="gskel-tag" /></div>)}</div>}
      {rows.map((row, i) => {
        const last = !rows[i + 1] || labels[i + 1] !== labels[i], wip = row.wip
        const cardTitle = row.cardId ? title(row.cardId) : ''
        return <button type="button" key={row.hash} data-hash={row.hash} className={`grow ${last && rows[i + 1] ? 'gbreak' : ''} ${wip ? 'wip' : ''} ${open && row.hash === sel ? 'on' : ''} ${dimmed(row) ? 'dim' : ''}`} onClick={() => clickRow(row)} onContextMenu={wip ? undefined : (event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, kind: row.stash ? 'stash' : 'commit', name: row.stash?.ref ?? row.hash }) }}>
          <RefsCell row={row} ghost={ghostChip(rows, i, graph?.repo.head ?? null)} spacing={spacing} worktrees={graph?.worktrees ?? []} act={(kind, name, open) => { if (!open) pickBranch(kind, name); else if (kind === 'remote') void openRemoteBranch(name); else if (name === graph?.repo.head) toast.info(t.alreadyOn(name)); else void branchAction('checkout', name) }} /><span className="ggraph"><Dot row={row} profiles={profiles} spacing={spacing} /></span>
          <span className="gmsg">{wip ? <><span className="gwipbox">{summaries[row.hash] || '// WIP'}</span><span className="gwipcnt">{wip.modified > 0 && <span className="m">{gitIcons.pen}{wip.modified}</span>}{wip.added > 0 && <span className="a">+{wip.added}</span>}{wip.deleted > 0 && <span className="d">−{wip.deleted}</span>}</span></> : <span className="t">{row.stash && <b className="gstashlabel">{row.stash.ref} · </b>}{row.subject}</span>}</span>
          <span className="gcardc">{row.cardId && <span className="ctag" role="link" data-tip={t.openCardGitTip} onClick={(e) => { e.stopPropagation(); openCardGit(row.cardId!) }}>{cardTitle}</span>}</span></button>
      })}
      {rows.map((row, i) => (!rows[i + 1] || labels[i + 1] !== labels[i]) ? <span key={`ago-${row.hash}`} className="gago gago2" style={{ top: 28 + (i + 1) * rowHeight }}>{labels[i]}</span> : null)}
      {graph?.truncated && <div className="gempty" style={{ padding: '10px 14px', position: 'absolute', top: 28 + rows.length * rowHeight }}>{more ? t.loadingMoreCommits : t.commitsLoaded(rows.filter((row) => !isWip(row)).length)}</div>}
    </div></section>
  const detail = open && selected && graph ? <aside className="gdetail">
    {isWip(selected) ? <><div className="gmeta"><span>{t.uncommittedChanges}</span></div><h3>{selected.cardId ? t.worktreeChanges : t.mainFolderChanges}</h3>
      {selected.cardId && <CardButton cardId={selected.cardId} title={title(selected.cardId)} branch={selected.wip?.branch} focus={focus} setFocus={setFocus} openCardGit={openCardGit} />}
      <WipForm key={selected.hash} row={selected} graph={graph} summary={summaries[selected.hash] ?? ''} setSummary={(value) => setSummaries((current) => ({ ...current, [selected.hash]: value }))} changed={() => void load()} openDiff={(file) => setViewer({ sourceId: graph.repo.sourceId, cardId: selected.cardId, file })} /></>
      : selected.stash ? <StashDetail row={selected} sourceId={graph.repo.sourceId} cardId={worktree} busy={Boolean(busy)} action={(action, ref) => void stashAction(action, ref)} rename={() => beginRenameStash(selected.stash!.ref)} />
      : <CommitDetail row={selected} graph={graph} profiles={profiles} board={board} focus={focus} setFocus={setFocus} openCardGit={openCardGit} {...(selected.refs.some((ref) => ref.kind === 'head') ? { editMessage: () => setRenameCommit({ hash: selected.hash, message: selected.subject, confirm: false }) } : {})} openFile={(file) => setViewer({ sourceId: graph.repo.sourceId, cardId: selected.cardId, hash: selected.hash, file: { ...file, staged: false } })} />}
  </aside> : null
  const prPane = prOpen && repoId ? <PrPanel sourceId={repoId} repoName={repos?.find((item) => item.sourceId === repoId)?.name ?? ''} branches={graph?.branches.local.map((branch) => branch.name) ?? []} head={graph?.repo.head ?? null} prs={prs} close={() => setPrOpen(false)} /> : null
  const right = prPane ?? detail
  return <div className="gwrap">{confirmDialog}<RepoTabs repos={repos ?? []} selected={repoId} alerts={(id) => prs.unread(id).length} conflicts={allConflicts} reorder={dropRepo} select={async (id) => { if (resolveTarget && !(await leaveConflicts())) return; setRepoId(id); setWorktree(null); setFocus(null); setViewer(undefined); setResolveTarget(undefined); try { localStorage.setItem(`agentboard.gitRepo.${projectId}`, id) } catch { /* só vale nesta sessão */ } }} />{allConflicts.length > 0 && <div className="cfl-banner" role="status"><span>{t.conflictInRepos(allConflicts.length)}{allConflicts.length === 1 ? ` · ${t.operationInProgress(operationLabel[allConflicts[0]!.operation])} · ${allConflicts[0]!.files.length ? t.conflictFiles(allConflicts[0]!.files.length) : t.conflictsResolvedPending}` : ''}</span><span className="cfl-targets">{allConflicts.map((entry) => <button key={`${entry.sourceId}:${entry.cardId ?? ''}`} type="button" className="mini" data-tip={t.conflictTarget(operationLabel[entry.operation], entry.repo, entry.cardTitle)} onClick={() => resolve(entry)}>{entry.repo}{entry.cardTitle ? ` · ${entry.cardTitle}` : ''} · {entry.files.length ? t.resolve : common.continue}</button>)}</span></div>}<section ref={page} className={`gitpage ${right ? '' : 'nodetail'}`} style={{ '--gside': `${panes.side}px`, '--gdetail': `${panes.detail}px` } as React.CSSProperties} aria-label={t.projectGit}>{resolveTarget ? <ConflictsView key={`${resolveTarget.sourceId}:${resolveTarget.cardId ?? ''}`} target={resolveTarget} setDirty={(value) => { conflictDirty.current = value }} changed={() => { void load(); refreshConflicts() }} back={() => { setResolveTarget(undefined); refreshConflicts() }} /> : viewer ? <DiffView viewer={viewer} close={() => setViewer(undefined)} changed={() => void load()} /> : <>{side}{center}</>}{!resolveTarget && right}{!viewer && !resolveTarget && <div className="gpanegrip side" role="separator" aria-orientation="vertical" data-tip={t.dragPaneTip} onPointerDown={gripPane('side')} onDoubleClick={resetPane('side')} />}{right && !resolveTarget && <div className="gpanegrip detail" role="separator" aria-orientation="vertical" data-tip={t.dragPaneTip} onPointerDown={gripPane('detail')} onDoubleClick={resetPane('detail')} />}</section>
    {wtMenu && <GitMenu x={wtMenu.x} y={wtMenu.y} title={wtMenu.branch} label={T.git.worktreeDelete.menuLabel(wtMenu.branch)} items={[{ key: 'one' as const, label: T.git.worktreeDelete.menuOne, danger: true }, { key: 'all' as const, label: T.git.worktreeDelete.menuItem, danger: true }]} run={(kind) => { const id = wtMenu.cardId; setWtMenu(undefined); setWtDelete(kind === 'one' && graph ? { cardId: id, sourceId: graph.repo.sourceId } : { cardId: id }) }} close={() => setWtMenu(undefined)} />}
    {wtDelete && <WorktreeDeleteDialog projectId={projectId} cardId={wtDelete.cardId} sourceId={wtDelete.sourceId} close={() => setWtDelete(undefined)} done={() => { const id = wtDelete.cardId; setWtDelete(undefined); if (worktree === id) { setGraph(undefined); setWorktree(null) } else void load(); window.dispatchEvent(new Event(gitChangedEvent)) }} />}
    {folderMenu && <GitMenu x={folderMenu.x} y={folderMenu.y} title={folderMenu.folder} label={t.folderActions(folderMenu.folder)} items={[{ key: 'delete-folder', label: t.deleteAllBranches(folderMenu.names.length), danger: true }]} run={() => { const current = folderMenu; setFolderMenu(undefined); setAsk({ kind: 'delete-folder', name: current.folder, names: current.names }) }} close={() => setFolderMenu(undefined)} />}
    {menu && (menu.kind === 'commit' ? <GitMenu x={menu.x} y={menu.y} title={menu.name.slice(0, 7)} label={t.commitActions(menu.name.slice(0, 7))} items={commitItems(graph?.repo.head ?? null)} run={runCommitMenu} close={() => setMenu(undefined)} />
      : menu.kind === 'stash' ? <GitMenu x={menu.x} y={menu.y} title={menu.name} label={t.stashActions(menu.name)} items={[...stashItems(), { key: 'rename' as const, label: t.renameStash }]} run={(action) => { const ref = menu.name; setMenu(undefined); if (action === 'rename') beginRenameStash(ref); else void stashAction(action, ref) }} close={() => setMenu(undefined)} />
      : <GitMenu x={menu.x} y={menu.y} title={menu.name} label={t.branchActions(menu.name)} items={branchItems(menu.kind, menu.kind === 'local' && graph?.branches.local.find((item) => item.name === menu.name)?.head === true, graph?.repo.head ?? null)} run={runMenu} close={() => setMenu(undefined)} />)}
    {ask?.kind === 'reset-hard' && <ConfirmDialog eyebrow={t.resetHardEyebrow} title={t.resetHardTitle(ask.name.slice(0, 7))} text={t.resetHardText} ok={t.resetHardOk} danger cancel={() => setAsk(undefined)} confirm={() => { const hash = ask.name; setAsk(undefined); void commitAction('reset-hard', hash) }} />}
    {pushRejected && graph && <PushRejectedDialog branch={graph.repo.head ?? ''} cancel={() => setPushRejected(false)} pull={(mode) => { setPushRejected(false); void sync('pull', mode) }} force={() => { setPushRejected(false); void sync('push', undefined, true) }} />}
    {renameStash && <ConfirmDialog eyebrow={t.stashEyebrow} title={t.renameStashTitle} text={t.renameStashText} extra={<label className="f"><span>{common.name}</span><input className="in" autoFocus maxLength={500} value={renameStash.message} onChange={(event) => setRenameStash({ ...renameStash, message: event.target.value })} /></label>} ok={t.saveName} okDisabled={!renameStash.message.trim()} cancel={() => setRenameStash(undefined)} confirm={() => void saveStashName()} />}
    {renameCommit && (renameCommit.confirm ? <ConfirmDialog eyebrow={t.changeCommit} title={t.updateMessageTitle} text={t.updateMessageText} ok={t.updateMessageOk} danger cancel={() => setRenameCommit({ ...renameCommit, confirm: false })} confirm={() => void saveCommitName()} /> : <ConfirmDialog eyebrow={t.changeCommit} title={t.editMessageTitle} text={t.editMessageText} extra={<label className="f"><span>{t.summary}</span><input className="in" autoFocus maxLength={2000} value={renameCommit.message} onChange={(event) => setRenameCommit({ ...renameCommit, message: event.target.value })} /></label>} ok={common.continue} okDisabled={!renameCommit.message.trim()} cancel={() => setRenameCommit(undefined)} confirm={() => setRenameCommit({ ...renameCommit, confirm: true })} />)}
    {upstreamAsk && graph && <UpstreamDialog sourceId={graph.repo.sourceId} cardId={worktree} branch={upstreamAsk.branch} remotes={upstreamAsk.remotes} close={() => setUpstreamAsk(undefined)} done={() => { const mode = upstreamAsk.mode; setUpstreamAsk(undefined); void sync('pull', mode) }} />}
    {ask?.kind === 'delete-remote' && <ConfirmDialog eyebrow={t.deleteRemoteEyebrow} title={t.deleteRemoteTitle(ask.name)} text={t.deleteRemoteText} ok={t.deleteRemoteOk} danger cancel={() => setAsk(undefined)} confirm={() => { const name = ask.name; setAsk(undefined); void branchAction('delete-remote', name) }} />}
    {ask?.kind === 'delete' && <ConfirmDialog eyebrow={t.deleteBranchEyebrow} title={t.deleteBranchTitle(ask.name)} text={t.deleteBranchText} ok={t.deleteBranchOk} danger cancel={() => setAsk(undefined)} confirm={() => { const name = ask.name; setAsk(undefined); void branchAction('delete', name) }} />}
    {ask?.kind === 'delete-folder' && <ConfirmDialog eyebrow={t.deleteFolderEyebrow} title={t.deleteFolderTitle(ask.names?.length ?? 0, ask.name)} text={t.deleteFolderText} ok={t.deleteFolderOk} danger cancel={() => setAsk(undefined)} confirm={() => { const names = ask.names ?? []; setAsk(undefined); void deleteFolderBranches(names) }} />}
    {(ask?.kind === 'create' || ask?.kind === 'commit-branch' || ask?.kind === 'commit-tag') && <div className="overlay top" role="dialog" aria-label={t.newBranch}><form className="modal" style={{ width: 'min(430px,100%)' }} onSubmit={(event) => {
      event.preventDefault(); const wanted = newName.trim(); if (!wanted || creating || nameProblem) return
      const name = ask.name, kind = ask.kind; setCreating(true); setCreateError('')
      // Fica aberto até dar certo: com erro do Git, o texto digitado continua ali com a mensagem embaixo.
      void (kind === 'create' ? branchAction('create', name, { newName: wanted }) : commitAction(kind === 'commit-branch' ? 'branch' : 'tag', name, wanted)).then((failure) => { setCreating(false); if (failure) setCreateError(failure); else setAsk(undefined) })
    }}><header><div><div className="eyebrow">{ask.kind === 'commit-tag' ? t.newTag : t.newBranch}</div><h2>{ask.kind === 'create' ? t.fromName(ask.name) : t.atCommit(ask.name.slice(0, 7))}</h2></div></header><label className="f"><span>{common.name}</span><input className="in" autoFocus value={newName} aria-invalid={Boolean(nameProblem || createError)} onChange={(event) => { setNewName(event.target.value); setCreateError('') }} placeholder={t.branchPlaceholder} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); if (!creating) setAsk(undefined) } }} /></label>{(nameProblem || createError) && <p className="error" role="alert">{nameProblem ? t.nameProblem[nameProblem] : createError}</p>}{ask.kind !== 'commit-tag' && <p className="hint">{t.mainFolderMoves}</p>}<div className="actions"><button type="button" className="secondary" disabled={creating} onClick={() => setAsk(undefined)}>{common.cancel}</button><button type="submit" disabled={!newName.trim() || Boolean(nameProblem) || creating}>{creating ? t.creating : common.create}</button></div></form></div>}
  </div>
}
