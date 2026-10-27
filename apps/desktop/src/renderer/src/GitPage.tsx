import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentProfile, GitChange, GitCommitFile, GitGraph, GitRepo, GitRow, ProjectBoard } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { GitSide } from './GitSide'
import { GitMenu, branchItems, commitItems, stashItems, type BranchAction, type CommitMenuAction, type StashMenuAction } from './BranchMenu'
import { ConfirmDialog } from './ConfirmDialog'
import { ConflictDialog, operationLabel, type ConflictState } from './ConflictDialog'
import { DiffLines } from './gitDiff'
import { openInEditor } from './openInEditor'
import { toast } from './toasts'
import { GitEmpty, GitUpstreamDialog as UpstreamDialog, gitChangedEvent } from './GitSetup'
import { plainError } from './NoticeDialog'
import { agoLabel, ghostChip, graphEdges, initials, isWip, laneColor, laneSpacing, laneX, refChips, rowHeight, shortAgo, splitPath, type RefChip } from './gitView'
import { Checkbox } from './Checkbox'

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
  tree: I(<><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4M6 16v-4h12v4" /></>),
  tag: I(<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1" /></>),
  card: I(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h5" /></>)
}

/** Ícone do card no canto do detalhe: ao clicar mostra título, branch e as ações do card num balão, sem ocupar o painel. */
function CardButton({ cardId, title, branch, focus, setFocus, openCardGit }: { cardId: string; title: string; branch?: string | null; focus: string | null; setFocus(id: string | null): void; openCardGit(cardId: string): void }): React.JSX.Element {
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
    <button type="button" className={`gcardbtn ${on ? 'on' : ''}`} title={title} aria-label={`Card: ${title}`} aria-expanded={open} onClick={() => setOpen(!open)}>{gitIcons.card}</button>
    {open && <div className="gcardpop" role="dialog" aria-label="Card"><small>Card</small><b>{title}</b>{branch && <span className="gcardpopbr" title={branch}>{branch}</span>}
      <div className="cgrow"><button type="button" className="mini" onClick={() => { setOpen(false); openCardGit(cardId) }}>Abrir Git do card</button><button type="button" className="mini secondary" onClick={() => setFocus(on ? null : cardId)}>{on ? 'Mostrar todos os commits' : 'Só este card no grafo'}</button></div></div>}
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
  return <div className={`gfile ${onOpen ? 'click' : ''}`} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onClick={onOpen} onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } } : undefined}><span className={`st ${file.status}`}>{file.status}</span><span className="pth" title={file.path}>{file.path}</span><span className="nums"><span className="p">+{file.additions}</span> <span className="m">−{file.deletions}</span></span></div>
}

function Chip({ chip, pick, open }: { chip: RefChip; pick?(): void; open?(): void }): React.JSX.Element {
  // Na lista que abre ao passar o mouse o nome já aparece inteiro e a dica do sistema só atrapalha, por isso sem `title` quando é clicável.
  const props = pick ? { role: 'button', tabIndex: 0, onClick: (event: React.MouseEvent) => { event.stopPropagation(); pick() }, onDoubleClick: (event: React.MouseEvent) => { event.stopPropagation(); open?.() }, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter') { event.stopPropagation(); open?.() } } } : { title: `${chip.name}${chip.local ? ' · local' : ''}${chip.remote ? ' · origin' : ''}${chip.tag ? ' · tag' : ''}` }
  return <span className={`rchip ${chip.head ? 'head' : ''} ${pick ? 'pick' : ''}`} {...props}>
    {chip.head && gitIcons.head}<span className="rn">{chip.name}</span>{chip.tag && gitIcons.tag}{chip.local && gitIcons.pc}{chip.remote && gitIcons.cloud}</span>
}

function RefsCell({ row, ghost, spacing, act }: { row: GitRow; ghost: RefChip | null; spacing: number; act(kind: 'local' | 'remote', name: string, open: boolean): void }): React.JSX.Element {
  const chips = refChips(row.refs), style = { '--lc': laneColor(row.lane), '--lx': `${laneX(row.lane, spacing) - 12}px` } as React.CSSProperties
  if (!chips.length) return ghost ? <span className="grefs ghost" style={style}><span className="grefs-in"><Chip chip={ghost} /></span></span> : <span className="grefs" />
  return <span className={`grefs ${chips.length > 1 ? 'multi' : ''}`} style={style}><span className="grefs-in">{chips.map((chip) => <Chip key={chip.name} chip={chip} />)}</span>
    <span className="gstack">{chips.map((chip) => {
      // Etiquetas (tags) não são branches; as demais abrem a local, ou a remota quando só existe ela.
      const remote = row.refs.find((ref) => ref.kind === 'remote' && ref.name.replace(/^[^/]+\//, '') === chip.name)?.name
      const target = chip.tag ? null : chip.local ? { kind: 'local' as const, name: chip.name } : remote ? { kind: 'remote' as const, name: remote } : null
      return <Chip key={chip.name} chip={chip} {...(target ? { pick: () => act(target.kind, target.name, false), open: () => act(target.kind, target.name, true) } : {})} />
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
  useEffect(() => { let alive = true; setUrl(null); void gravatarUrl(email).then((value) => { if (alive) setUrl(value) }); return () => { alive = false } }, [email])
  return url
}

function Dot({ row, profiles, spacing }: { row: GitRow; profiles: AgentProfile[]; spacing: number }): React.JSX.Element {
  const style = { left: laneX(row.lane, spacing), '--lc': laneColor(row.lane) } as React.CSSProperties
  if (isWip(row)) return <span className="gdot wip" style={style} />
  const agent = profiles.find((profile) => profile.id === row.agentProfileId), photo = useGravatar(row.email)
  return <span className="gdot tip" style={style} data-tip={row.email ? `${row.author} · ${row.email}` : row.author}>{photo ? <img className="gphoto" src={photo} alt="" /> : <b>{initials(row.author)}</b>}{agent && <span className="gdotag tip" data-tip={`Commit feito por ${agent.label}`}><AgentIcon profile={agent} size="sm" tip={false} /></span>}</span>
}

function Who({ row, profiles }: { row: GitRow; profiles: AgentProfile[] }): React.JSX.Element {
  const agent = profiles.find((profile) => profile.id === row.agentProfileId)
  const photo = useGravatar(row.email)
  return <><span className="me tip" data-tip={row.author}>{photo ? <img className="gphoto" src={photo} alt="" /> : initials(row.author)}</span><span className="gname">{row.author}</span>{agent && <span className="gvia tip" data-tip={`Commit feito por ${agent.label}`}><AgentIcon profile={agent} size="sm" tip={false} /></span>}</>
}

/** Detalhe do WIP, como no GitKraken: arquivos não preparados e preparados (stage) e o commit embaixo. */
function WipForm({ row, graph, summary, setSummary, changed, openDiff }: { row: GitRow; graph: GitGraph; summary: string; setSummary(value: string): void; changed(): void; openDiff(file: GitChange): void }): React.JSX.Element {
  const sourceId = graph.repo.sourceId, cardId = row.cardId
  const [files, setFiles] = useState<GitChange[]>([]), [last, setLast] = useState(''), [description, setDescription] = useState(''), [amend, setAmend] = useState(false)
  const [closed, setClosed] = useState<{ un?: boolean; on?: boolean }>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { const state = await window.agentboard.invoke('git:changes', { sourceId, cardId }); setFiles(state.files); setLast(state.lastMessage) } catch (reason) { setError(plainError(reason)) } }, [sourceId, cardId])
  useEffect(() => { void load() }, [load, row.wip?.modified, row.wip?.added, row.wip?.deleted, row.wip?.staged])
  const unstaged = files.filter((file) => !file.staged), staged = files.filter((file) => file.staged)
  const stage = async (paths: string[], value: boolean): Promise<void> => {
    try { setError(''); const state = await window.agentboard.invoke('git:stage', { sourceId, cardId, paths, stage: value }); setFiles(state.files); changed() } catch (reason) { setError(plainError(reason)) }
  }
  const commit = async (): Promise<void> => {
    setBusy(true); setError('')
    try { await window.agentboard.invoke('git:commit', { sourceId, cardId, message: summary.trim(), description: description.trim() || undefined, amend }); setSummary(''); setDescription(''); setAmend(false); await load(); changed() } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) }
  }
  const lines = (list: GitChange[], isStaged: boolean): React.JSX.Element => <>{list.map((file) => {
    const { dir, name } = splitPath(file.path), key = `${isStaged ? 's' : 'u'}:${file.path}`
    return <React.Fragment key={key}><div className="gwrow" title={file.path}><span className={`st ${file.status}`}>{file.status === 'M' ? gitIcons.pen : file.status === 'A' ? '+' : '−'}</span>
      <button type="button" className="gwp" onClick={() => openDiff(file)}>{dir && <span className="dir">{dir}</span>}<b>{name}</b></button>
      <button type="button" className={`gwbtn ${isStaged ? 'un' : ''}`} onClick={() => void stage([file.path], !isStaged)}>{isStaged ? 'Unstage' : 'Stage'}</button></div>
      </React.Fragment>
  })}{!list.length && <div className="gwempty">Nada aqui.</div>}</>
  const section = (id: 'un' | 'on', title: string, list: GitChange[], isStaged: boolean): React.JSX.Element => <div className="gwsec"><div className="gwsech">
    <button type="button" className="gwtog" onClick={() => setClosed({ ...closed, [id]: !closed[id] })}>{closed[id] ? '▸' : '▾'} {title} ({list.length})</button>
    {list.length > 0 && <button type="button" className={`gwall ${isStaged ? 'un' : ''}`} onClick={() => void stage([], !isStaged)}>{isStaged ? 'Unstage tudo' : 'Stage tudo'}</button>}</div>
    {!closed[id] && <div className="gwlist">{lines(list, isStaged)}</div>}</div>
  const toggleAmend = (value: boolean): void => { setAmend(value); if (value && !summary.trim()) setSummary(last); else if (!value && summary === last) setSummary('') }
  const ready = staged.length > 0 || amend, count = Array.from(new Set(staged.map((file) => file.path))).length
  return <div className="gwform"><div className="gwtop"><span>{new Set(files.map((file) => file.path)).size} arquivos alterados em <code>{row.wip?.branch}</code></span></div>
    <div className="gwlists">{section('un', 'Não preparados', unstaged, false)}{section('on', 'Preparados', staged, true)}</div>
    <div className="gwcommit"><label className="gwamend"><GitCheck checked={amend} onChange={toggleAmend} label="Corrigir o último commit" /> Corrigir o último commit (amend)</label>
      <div className="gwmsg"><div className="gwsumrow"><input maxLength={120} placeholder="Resumo do commit" value={summary} onChange={(e) => setSummary(e.target.value)} /><span className={`gwcount ${summary.length > 72 ? 'over' : ''}`}>{72 - summary.length}</span></div>
        <textarea className="autogrow" placeholder="Descrição" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      {error && <p className="error">{error}</p>}
      <button type="button" className="gwgo" disabled={!ready || busy || (!amend && !summary.trim())} onClick={() => void commit()}>{amend ? 'Corrigir o último commit' : staged.length ? `Commit de ${count} arquivo${count > 1 ? 's' : ''}` : 'Coloque arquivos no stage para commitar'}</button></div></div>
}

function CommitDetail({ row, graph, profiles, board, focus, setFocus, openCardGit, openFile }: { row: GitRow; graph: GitGraph; profiles: AgentProfile[]; board: ProjectBoard; focus: string | null; setFocus(id: string | null): void; openCardGit(cardId: string): void; openFile(file: GitCommitFile): void }): React.JSX.Element {
  const [detail, setDetail] = useState<{ body: string; files: GitCommitFile[] }>(), [error, setError] = useState(''), [moreBody, setMoreBody] = useState(false)
  useEffect(() => { setDetail(undefined); setError(''); setMoreBody(false); void window.agentboard.invoke('git:commit-detail', { sourceId: graph.repo.sourceId, hash: row.hash }).then(setDetail).catch((reason: unknown) => setError(plainError(reason))) }, [graph.repo.sourceId, row.hash])
  const card = board.cards.find((item) => item.id === row.cardId), branch = graph.worktrees.find((item) => item.cardId === row.cardId)?.branch
  const files = detail?.files ?? []
  return <>
    {card && <CardButton cardId={card.id} title={card.title} branch={branch} focus={focus} setFocus={setFocus} openCardGit={openCardGit} />}
    <div className="gmeta"><span>commit <code>{row.short}</code>{row.parents.length > 1 ? ' · merge' : ''}</span></div><h3>{row.subject}</h3>
    <div className="gmeta"><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Who row={row} profiles={profiles} /> · {shortAgo(row.date)}</span>{row.parents.length > 0 && <span>pai: <code>{row.parents.map((hash) => hash.slice(0, 7)).join(', ')}</code></span>}</div>
    {detail?.body && detail.body !== row.subject && (() => { const text = detail.body.replace(row.subject, '').trim(), long = text.length > 180 || text.split('\n').length > 3; return <><p className={`gbody ${long && !moreBody ? 'short' : ''}`}>{text}</p>{long && <button type="button" className="gmore" aria-expanded={moreBody} onClick={() => setMoreBody(!moreBody)}>{moreBody ? 'Ver menos' : 'Ver mais'}</button>}</> })()}
    {!card && <div className="cgnote">Commit fora de card (feito direto na branch).</div>}
    {error ? <p className="error">{error}</p> : <><div className="cglabel">{files.length} arquivo{files.length === 1 ? '' : 's'} · <FileCounts files={files} /></div><div className="gfiles">{files.map((file) => <FileRow key={file.path} file={file} onOpen={() => openFile(file)} />)}</div></>}
  </>
}

/** Código do arquivo alterado (diff) na área do grafo: abre ao clicar num arquivo do WIP. */
function DiffView({ viewer, close }: { viewer: { sourceId: string; cardId: string | null; hash?: string; file: GitChange }; close(): void }): React.JSX.Element {
  const { sourceId, cardId, file, hash } = viewer
  const [text, setText] = useState<string>(), [error, setError] = useState('')
  useEffect(() => { setText(undefined); setError(''); void (hash ? window.agentboard.invoke('git:commit-diff', { sourceId, hash, path: file.path }) : window.agentboard.invoke('git:diff', { sourceId, cardId, path: file.path, staged: file.staged })).then(setText).catch((reason: unknown) => setError(plainError(reason))) }, [sourceId, cardId, hash, file.path, file.staged])
  return <section className="gdiffview" style={{ gridColumn: '1 / span 2' }} aria-label={`Alterações de ${file.path}`}><header><span className={`st ${file.status}`}>{file.status}</span><b title={file.path}>{file.path}</b><small>{hash ? `commit ${hash.slice(0, 7)}` : file.staged ? 'preparado' : 'não preparado'}</small><span className="gdstat"><span className="p">+{file.additions}</span> <span className="m">−{file.deletions}</span></span><span className="grow1" /><button type="button" className="fv-toggle" title="Abrir a versão atual no editor de arquivos" onClick={() => void openInEditor({ sourceId, cardId, path: file.path }).then(close).catch((reason: unknown) => setError(plainError(reason)))}>Abrir no editor</button><button type="button" className="x" onClick={close} aria-label="Fechar">×</button></header>
    <div className="gdiffbody">{error ? <p className="error">{error}</p> : text === undefined ? <div className="gempty" style={{ padding: 14 }}>Carregando…</div> : !text.trim() ? <div className="gempty" style={{ padding: 14 }}>Sem diferenças para mostrar.</div> : <DiffLines text={text} />}</div></section>
}

type PullMode = 'fetch-all' | 'ff' | 'ff-only' | 'rebase'
const pullOptions: Array<{ id: PullMode; label: string }> = [{ id: 'fetch-all', label: 'Fetch all' }, { id: 'ff', label: 'Pull (fast-forward se possível)' }, { id: 'ff-only', label: 'Pull (somente fast-forward)' }, { id: 'rebase', label: 'Pull (rebase)' }]
const pullKey = 'agentboard.gitPull'
const loadPull = (): PullMode => { try { const value = localStorage.getItem(pullKey); return pullOptions.some((item) => item.id === value) ? value as PullMode : 'ff' } catch { return 'ff' } }
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

/** Aba Git do quadro: um repositório por vez, branches/worktrees/stashes na lateral, grafo no centro e o detalhe do commit à direita. */
export function GitPage({ board, profiles, openCardGit, focusRequest }: { board: ProjectBoard; profiles: AgentProfile[]; openCardGit(cardId: string): void; focusRequest?: { cardId: string; at: number } }): React.JSX.Element {
  const projectId = board.project.id
  const [repos, setRepos] = useState<GitRepo[]>(), [repoId, setRepoId] = useState<string>(), [graph, setGraph] = useState<GitGraph>(), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('')
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
  const [pullMode, setPullMode] = useState<PullMode>(loadPull), [pullMenu, setPullMenu] = useState(false), pullBox = useRef<HTMLSpanElement>(null)
  useEffect(() => { if (!pullMenu) return; const out = (e: MouseEvent): void => { if (!pullBox.current?.contains(e.target as Node)) setPullMenu(false) }; document.addEventListener('mousedown', out); return () => document.removeEventListener('mousedown', out) }, [pullMenu])
  const [viewer, setViewer] = useState<{ sourceId: string; cardId: string | null; hash?: string; file: GitChange }>()
  useEffect(() => { if (!viewer) return; const key = (e: KeyboardEvent): void => { if (e.key === 'Escape') setViewer(undefined) }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [viewer])
  useEffect(() => { if (focusRequest) setFocus(focusRequest.cardId) }, [focusRequest])
  const title = (cardId: string | null): string => board.cards.find((card) => card.id === cardId)?.title ?? 'Card'
  // Rolagem infinita: começa com 100 commits e, ao chegar perto do fim, pede mais 100 (de novo e de novo, até acabar o histórico).
  const pageCommits = 100
  const [limit, setLimit] = useState(pageCommits), [more, setMore] = useState(false)
  const load = useCallback(async (id = repoId): Promise<void> => {
    if (!id) return
    try { setGraph(await window.agentboard.invoke('git:graph', { projectId, sourceId: id, limit })); setError('') } catch (reason) { setError(plainError(reason)) } finally { setMore(false) }
  }, [projectId, repoId, limit])
  useEffect(() => { setLimit(pageCommits) }, [repoId])
  const onListScroll = (event: React.UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget
    if (!graph?.truncated || more) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) { setMore(true); setLimit((current) => current + pageCommits) }
  }
  useEffect(() => { void window.agentboard.invoke('git:detect', { projectId }).then(({ repos: items, changed }) => { if (changed) window.dispatchEvent(new Event(gitChangedEvent)); setRepos(items); setRepoId((current) => { const saved = (() => { try { return localStorage.getItem(`agentboard.gitRepo.${projectId}`) } catch { return null } })(); return current && items.some((item) => item.sourceId === current) ? current : items.find((item) => item.sourceId === saved)?.sourceId ?? items[0]?.sourceId }) }).catch((reason: unknown) => setError(plainError(reason))) }, [projectId])
  useEffect(() => { setGraph(undefined); setSel(null); setOpen(false); setPicked(undefined) }, [repoId])
  useEffect(() => { void load(repoId) }, [repoId, load])
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
  const opTitle: Record<string, string> = { fetch: 'Fetch', pull: 'Pull', push: 'Push', stash: 'Stash', pop: 'Pop', checkout: 'Checkout', 'pull-rebase': 'Pull com rebase', 'rebase-onto': 'Rebase', merge: 'Merge', create: 'Criar branch', delete: 'Apagar branch', 'delete-remote': 'Apagar branch remota', 'cherry-pick': 'Cherry-pick', revert: 'Reverter', 'reset-soft': 'Reset', 'reset-mixed': 'Reset', 'reset-hard': 'Reset', branch: 'Criar branch', tag: 'Criar tag', apply: 'Aplicar stash', drop: 'Descartar stash' }
  const report = (action: string, ok: boolean, text: string): void => {
    setNotice(text)
    const name = opTitle[action] ?? action
    // O repositório e a branch aparecem em letra pequena: com vários repositórios abertos, diz onde a operação rodou.
    const meta = graph ? `${graph.repo.name}${graph.repo.head ? ` · ${graph.repo.head}` : ''}` : undefined
    if (ok) toast.success(`${name} concluído`, text, { meta }); else toast.error(`${name} falhou`, text, { meta })
  }
  const sync = async (action: 'fetch' | 'pull' | 'push' | 'stash' | 'pop', pull?: 'ff' | 'ff-only' | 'rebase'): Promise<void> => {
    if (!graph) return
    setBusy(action); setNotice('')
    try { const out = await window.agentboard.invoke('git:sync', { sourceId: graph.repo.sourceId, cardId: focus, action, pull }); report(action, true, out.output.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? 'Pronto.'); await load() } catch (reason) { report(action, false, plainError(reason)) } finally { setBusy('') }
  }
  const [picked, setPicked] = useState<string>(), [menu, setMenu] = useState<{ x: number; y: number; kind: 'local' | 'remote' | 'commit' | 'stash'; name: string }>(), [conflicts, setConflicts] = useState<ConflictState>({ operation: null, files: [] }), [resolving, setResolving] = useState(false), [ask, setAsk] = useState<{ kind: 'create' | 'delete' | 'delete-remote' | 'commit-branch' | 'commit-tag' | 'reset-hard'; name: string }>(), [newName, setNewName] = useState('')
  useEffect(() => { if (!graph) return; void window.agentboard.invoke('git:conflicts', { sourceId: graph.repo.sourceId }).then((state) => { setConflicts(state); if (!state.operation) setResolving(false) }).catch(() => undefined) }, [graph, notice])
  const branchAction = async (action: Exclude<BranchAction, 'copy'>, name: string, extra?: { newName?: string }): Promise<void> => {
    if (!graph) return
    setBusy(action); setNotice('')
    try { const out = await window.agentboard.invoke('git:branch-action', { sourceId: graph.repo.sourceId, action, name, ...extra }); report(action, true, out.output.split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? 'Pronto.'); await load() } catch (reason) { report(action, false, plainError(reason)) } finally { setBusy('') }
  }
  const commitAction = async (action: Exclude<CommitMenuAction, 'copy'>, hash: string, name?: string): Promise<void> => {
    if (!graph) return
    setBusy(action); setNotice('')
    try { const out = await window.agentboard.invoke('git:commit-action', { sourceId: graph.repo.sourceId, action, hash, name }); report(action, true, out.output); await load() } catch (reason) { report(action, false, plainError(reason)) } finally { setBusy('') }
  }
  const stashAction = async (action: StashMenuAction, ref: string): Promise<void> => {
    if (!graph) return
    setBusy(action); setNotice('')
    try { const out = await window.agentboard.invoke('git:stash-action', { sourceId: graph.repo.sourceId, action, ref }); report(action, true, out.output); await load() } catch (reason) { report(action, false, plainError(reason)) } finally { setBusy('') }
  }
  const runCommitMenu = (action: CommitMenuAction): void => {
    const current = menu; setMenu(undefined)
    if (!current) return
    if (action === 'copy') { void navigator.clipboard.writeText(current.name).then(() => toast.info('SHA copiado')).catch(() => undefined); return }
    if (action === 'branch' || action === 'tag') { setNewName(''); setAsk({ kind: action === 'branch' ? 'commit-branch' : 'commit-tag', name: current.name }); return }
    if (action === 'reset-hard') { setAsk({ kind: 'reset-hard', name: current.name }); return }
    void commitAction(action, current.name)
  }
  const runMenu = (action: BranchAction): void => {
    const current = menu; setMenu(undefined)
    if (!current) return
    if (action === 'copy') { void navigator.clipboard.writeText(current.name).then(() => toast.info('Nome copiado')).catch(() => undefined); return }
    if (action === 'create') { setNewName(''); setAsk({ kind: 'create', name: current.name }); return }
    if (action === 'delete') {
      const owner = graph?.branches.local.find((item) => item.name === current.name)?.cardId
      if (owner) { toast.error('Apagar branch falhou', `A branch ${current.name} é do card "${title(owner)}" e está em uso pela worktree dele. Remova a worktree do card antes de apagar a branch.`); return }
      setAsk({ kind: 'delete', name: current.name }); return
    }
    if (action === 'delete-remote') { setAsk({ kind: 'delete-remote', name: current.name }); return }
    void branchAction(action, current.name)
  }
  // Clicar numa branch da lateral seleciona o commit da ponta dela: o grafo rola até lá e o detalhe abre à direita.
  const pickBranch = (kind: 'local' | 'remote', name: string): void => {
    setPicked(`${kind}:${name}`)
    const row = rows.find((item) => item.refs.some((ref) => ref.name === name && (kind === 'remote' ? ref.kind === 'remote' : ref.kind !== 'remote' && ref.kind !== 'tag')))
    if (!row) { toast.info('Branch fora do histórico', 'Esta branch não aparece no histórico carregado.'); return }
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

  if (repos && !repos.length) return <div className="gwrap"><GitEmpty projectId={projectId} done={(items) => { setRepos(items); setRepoId(items[0]?.sourceId) }} /></div>
  const labels = rows.map((row) => agoLabel(row.date))
  const side = <GitSide graph={graph} focus={focus} setFocus={setFocus} title={title} icons={gitIcons} picked={picked} onPick={pickBranch} onOpen={(kind, name, current) => { if (current) toast.info(`Você já está em ${name}`); else void branchAction('checkout', name) }} onMenu={(kind, name, event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, kind, name }) }} />
  const tool = (icon: React.JSX.Element, label: string, action: 'push' | 'stash' | 'pop', remote = true): React.JSX.Element => <button type="button" className="gtool" disabled={Boolean(busy) || (remote && !graph?.repo.hasRemote)} title={remote && !graph?.repo.hasRemote ? 'Este repositório não tem remoto (origin)' : undefined} onClick={() => void sync(action)}>{icon}{busy === action ? '…' : label}</button>
  // Pull sem branch remota ligada: pergunta com qual remoto/branch a branch atual puxa e envia, liga e então puxa.
  const [upstreamAsk, setUpstreamAsk] = useState<{ branch: string; remotes: string[]; mode: 'ff' | 'ff-only' | 'rebase' }>()
  // O botão de fora roda o padrão; cada opção do menu roda a sua na hora (sem mudar o padrão).
  const pullNow = (mode: PullMode = pullMode): void => {
    if (mode === 'fetch-all') { void sync('fetch'); return }
    if (!graph) return
    void window.agentboard.invoke('git:upstream', { sourceId: graph.repo.sourceId, cardId: focus }).then((info) => {
      if (info.branch && !info.upstream && info.remotes.length) setUpstreamAsk({ branch: info.branch, remotes: info.remotes, mode })
      else void sync('pull', mode)
    }).catch(() => { void sync('pull', mode) })
  }
  const pullTool = <span className="gsplit" ref={pullBox}><button type="button" className="gtool" disabled={Boolean(busy) || !graph?.repo.hasRemote} title={graph?.repo.hasRemote ? pullOptions.find((item) => item.id === pullMode)?.label : 'Este repositório não tem remoto (origin)'} onClick={() => pullNow()}>{gitIcons.pull}{busy === 'pull' || busy === 'fetch' ? '…' : 'Pull'}</button>
    <button type="button" className="gtool gcaret" aria-label="Opções do pull" aria-expanded={pullMenu} onClick={() => setPullMenu(!pullMenu)}>▾</button>
    {pullMenu && <div className="gpullmenu" role="menu"><p>Clique numa opção para executá-la agora. O círculo define o padrão do botão Pull.</p>{pullOptions.map((item) => <div className={`gpullrow ${pullMode === item.id ? 'on' : ''}`} key={item.id}>
      <button type="button" role="menuitemradio" aria-checked={pullMode === item.id} className="gpulldef" title="Definir como padrão do botão Pull" aria-label={`Definir “${item.label}” como padrão`} onClick={() => { setPullMode(item.id); try { localStorage.setItem(pullKey, item.id) } catch { /* só vale nesta sessão */ } }}><i /></button>
      <button type="button" role="menuitem" className="gpullrun" disabled={Boolean(busy) || !graph?.repo.hasRemote} onClick={() => { setPullMenu(false); pullNow(item.id) }}>{item.label}{pullMode === item.id && <small>padrão</small>}</button></div>)}</div>}</span>
  const colStyle = { '--gw': `${width}px`, ...Object.fromEntries(Object.entries(cols).map(([k, v]) => [`--${k}`, `${v}px`])) } as React.CSSProperties
  const center = <section className="gcenter"><div className="gtools">{pullTool}{tool(gitIcons.push, 'Push', 'push')}{tool(gitIcons.stash, 'Stash', 'stash', false)}{tool(gitIcons.stash, 'Pop', 'pop', false)}<span className="sep" />
    {focus ? <button type="button" className="gonly on" onClick={() => setFocus(null)}>{gitIcons.graph}Só: {title(focus)} ✕</button> : <span className="gonly">{gitIcons.graph}Todas as branches</span>}
    <span className="gcur">Pasta principal em <b>{graph?.repo.head ?? '—'}</b></span></div>
    {error && <p className="error" style={{ margin: '10px 14px' }}>{error}</p>}
    <div className={`glist ${cols.cm ? 'fixedcm' : ''}`} style={colStyle} ref={list} onScroll={onListScroll} onClick={(e) => { if (focus && !(e.target as HTMLElement).closest('.grow,.ghead')) setFocus(null) }}>
      <div className="ghead">{['Branch / Tag', 'Grafo', 'Mensagem', 'Card'].map((label) => <span key={label}>{label}</span>)}</div>
      {colEdges.length === 4 && ([['cr', 90], ['cg', graphMin], ['cm', 160], ['cc', 120]] as const).map(([key, min], cell) => <i key={key} className="gcolfull" title="Arraste para mudar a largura" style={{ left: colEdges[cell]! - 4, height: 28 + rows.length * rowHeight }} onPointerDown={grip(key, min, cell)} />)}
      <svg className="gsvg" width={width} height={rows.length * rowHeight} aria-hidden="true">{edges.map((edge, i) => <path key={i} d={edge.d} stroke={edge.color} strokeWidth={1.5} fill="none" strokeDasharray={edge.wip ? '3 3' : undefined} opacity={edge.dim ? 0.3 : 1} />)}</svg>
      {!graph && !error && <div className="gskel" aria-busy="true" aria-label="Carregando o histórico">{Array.from({ length: 16 }, (_, index) => <div className="gskel-row" key={index} style={{ '--w': `${46 + ((index * 37) % 44)}%` } as React.CSSProperties}><span className="gskel-chip" /><span className="gskel-dot" /><span className="gskel-bar" /><span className="gskel-tag" /></div>)}</div>}
      {rows.map((row, i) => {
        const last = !rows[i + 1] || labels[i + 1] !== labels[i], wip = row.wip
        const cardTitle = row.cardId ? title(row.cardId) : ''
        return <button type="button" key={row.hash} data-hash={row.hash} className={`grow ${last && rows[i + 1] ? 'gbreak' : ''} ${wip ? 'wip' : ''} ${open && row.hash === sel ? 'on' : ''} ${dimmed(row) ? 'dim' : ''}`} onClick={() => clickRow(row)} onContextMenu={wip ? undefined : (event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, kind: 'commit', name: row.hash }) }}>
          <RefsCell row={row} ghost={ghostChip(rows, i, graph?.repo.head ?? null)} spacing={spacing} act={(kind, name, open) => { if (!open) pickBranch(kind, name); else if (kind === 'local' && name === graph?.repo.head) toast.info(`Você já está em ${name}`); else void branchAction('checkout', name) }} /><span className="ggraph"><Dot row={row} profiles={profiles} spacing={spacing} /></span>
          <span className="gmsg">{wip ? <><span className="gwipbox">{summaries[row.hash] || '// WIP'}</span><span className="gwipcnt">{wip.modified > 0 && <span className="m">{gitIcons.pen}{wip.modified}</span>}{wip.added > 0 && <span className="a">+{wip.added}</span>}{wip.deleted > 0 && <span className="d">−{wip.deleted}</span>}</span></> : <span className="t">{row.subject}</span>}</span>
          <span className="gcardc">{row.cardId && <span className="ctag" role="link" title="Abrir o Git do card" onClick={(e) => { e.stopPropagation(); openCardGit(row.cardId!) }}>{cardTitle}</span>}</span></button>
      })}
      {rows.map((row, i) => (!rows[i + 1] || labels[i + 1] !== labels[i]) ? <span key={`ago-${row.hash}`} className="gago gago2" style={{ top: 28 + (i + 1) * rowHeight }}>{labels[i]}</span> : null)}
      {graph?.truncated && <div className="gempty" style={{ padding: '10px 14px', position: 'absolute', top: 28 + rows.length * rowHeight }}>{more ? 'Carregando mais commits…' : `${rows.filter((row) => !isWip(row)).length} commits carregados · role para ver mais`}</div>}
    </div></section>
  const detail = open && selected && graph ? <aside className="gdetail">
    {isWip(selected) ? <><div className="gmeta"><span>Alterações sem commit</span></div><h3>{selected.cardId ? 'Alterações na worktree do card' : 'Alterações na pasta principal'}</h3>
      {selected.cardId && <CardButton cardId={selected.cardId} title={title(selected.cardId)} branch={selected.wip?.branch} focus={focus} setFocus={setFocus} openCardGit={openCardGit} />}
      <WipForm key={selected.hash} row={selected} graph={graph} summary={summaries[selected.hash] ?? ''} setSummary={(value) => setSummaries((current) => ({ ...current, [selected.hash]: value }))} changed={() => void load()} openDiff={(file) => setViewer({ sourceId: graph.repo.sourceId, cardId: selected.cardId, file })} /></>
      : <CommitDetail row={selected} graph={graph} profiles={profiles} board={board} focus={focus} setFocus={setFocus} openCardGit={openCardGit} openFile={(file) => setViewer({ sourceId: graph.repo.sourceId, cardId: selected.cardId, hash: selected.hash, file: { ...file, staged: false } })} />}
  </aside> : null
  return <div className="gwrap"><div className="gtabs" role="tablist" aria-label="Repositórios do projeto">{(repos ?? []).map((repo) => <button type="button" role="tab" aria-selected={repo.sourceId === repoId} key={repo.sourceId} className={`gtab ${repo.sourceId === repoId ? 'on' : ''}`} title={`${repo.path}${repo.head ? ` · ${repo.head}` : ''}`} onClick={() => { setRepoId(repo.sourceId); setFocus(null); setViewer(undefined); try { localStorage.setItem(`agentboard.gitRepo.${projectId}`, repo.sourceId) } catch { /* só vale nesta sessão */ } }}>{gitIcons.repo}<span className="gtn">{repo.name}</span></button>)}</div>{conflicts.operation && <div className="cfl-banner" role="status"><span>{operationLabel[conflicts.operation]} em andamento{conflicts.files.length ? ` · ${conflicts.files.length} arquivo${conflicts.files.length === 1 ? '' : 's'} em conflito` : ' · conflitos resolvidos, falta continuar'}</span><button type="button" className="mini" onClick={() => setResolving(true)}>{conflicts.files.length ? 'Resolver conflitos' : 'Continuar'}</button></div>}<section ref={page} className={`gitpage ${detail ? '' : 'nodetail'}`} style={{ '--gside': `${panes.side}px`, '--gdetail': `${panes.detail}px` } as React.CSSProperties} aria-label="Git do projeto">{viewer ? <DiffView viewer={viewer} close={() => setViewer(undefined)} /> : <>{side}{center}</>}{detail}{!viewer && <div className="gpanegrip side" role="separator" aria-orientation="vertical" title="Arraste para mudar a largura (duplo clique restaura)" onPointerDown={gripPane('side')} onDoubleClick={resetPane('side')} />}{detail && <div className="gpanegrip detail" role="separator" aria-orientation="vertical" title="Arraste para mudar a largura (duplo clique restaura)" onPointerDown={gripPane('detail')} onDoubleClick={resetPane('detail')} />}</section>
    {resolving && graph && conflicts.operation && <ConflictDialog sourceId={graph.repo.sourceId} state={conflicts} changed={() => { void window.agentboard.invoke('git:conflicts', { sourceId: graph.repo.sourceId }).then(setConflicts).catch(() => undefined); void load() }} close={() => setResolving(false)} />}
    {menu && (menu.kind === 'commit' ? <GitMenu x={menu.x} y={menu.y} title={menu.name.slice(0, 7)} label={`Ações do commit ${menu.name.slice(0, 7)}`} items={commitItems(graph?.repo.head ?? null)} run={runCommitMenu} close={() => setMenu(undefined)} />
      : menu.kind === 'stash' ? <GitMenu x={menu.x} y={menu.y} title={menu.name} label={`Ações do stash ${menu.name}`} items={stashItems} run={(action) => { const ref = menu.name; setMenu(undefined); void stashAction(action, ref) }} close={() => setMenu(undefined)} />
      : <GitMenu x={menu.x} y={menu.y} title={menu.name} label={`Ações da branch ${menu.name}`} items={branchItems(menu.kind, menu.kind === 'local' && graph?.branches.local.find((item) => item.name === menu.name)?.head === true, graph?.repo.head ?? null)} run={runMenu} close={() => setMenu(undefined)} />)}
    {ask?.kind === 'reset-hard' && <ConfirmDialog eyebrow="Reset hard" title={`Mover a branch atual para ${ask.name.slice(0, 7)}?`} text="Descarta as alterações não commitadas e os commits depois deste na branch atual. Os commits ainda podem ser recuperados pelo reflog, mas o que não foi commitado se perde." ok="Descartar e mover" danger cancel={() => setAsk(undefined)} confirm={() => { const hash = ask.name; setAsk(undefined); void commitAction('reset-hard', hash) }} />}
    {upstreamAsk && graph && <UpstreamDialog sourceId={graph.repo.sourceId} cardId={focus} branch={upstreamAsk.branch} remotes={upstreamAsk.remotes} close={() => setUpstreamAsk(undefined)} done={() => { const mode = upstreamAsk.mode; setUpstreamAsk(undefined); void sync('pull', mode) }} />}
    {ask?.kind === 'delete-remote' && <ConfirmDialog eyebrow="Apagar branch remota" title={`Apagar ${ask.name} no servidor?`} text="Isso remove a branch do repositório remoto (git push --delete) e vale para todo mundo que usa esse remoto. As cópias locais não são apagadas. Não dá para desfazer por aqui." ok="Apagar no remoto" danger cancel={() => setAsk(undefined)} confirm={() => { const name = ask.name; setAsk(undefined); void branchAction('delete-remote', name) }} />}
    {ask?.kind === 'delete' && <ConfirmDialog eyebrow="Apagar branch" title={`Apagar ${ask.name}?`} text="Só apaga se tudo dela já estiver em outra branch; se faltar algo, o Git recusa e nada se perde." ok="Apagar" danger cancel={() => setAsk(undefined)} confirm={() => { const name = ask.name; setAsk(undefined); void branchAction('delete', name) }} />}
    {(ask?.kind === 'create' || ask?.kind === 'commit-branch' || ask?.kind === 'commit-tag') && <div className="overlay top" role="dialog" aria-label="Nova branch"><form className="modal" style={{ width: 'min(430px,100%)' }} onSubmit={(event) => { event.preventDefault(); if (!newName.trim()) return; const name = ask.name, kind = ask.kind; setAsk(undefined); if (kind === 'create') void branchAction('create', name, { newName: newName.trim() }); else void commitAction(kind === 'commit-branch' ? 'branch' : 'tag', name, newName.trim()) }}><header><div><div className="eyebrow">{ask.kind === 'commit-tag' ? 'Nova tag' : 'Nova branch'}</div><h2>{ask.kind === 'create' ? `A partir de ${ask.name}` : `No commit ${ask.name.slice(0, 7)}`}</h2></div></header><label className="f"><span>Nome</span><input className="in" autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="feature/minha-branch" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setAsk(undefined) } }} /></label>{ask.kind !== 'commit-tag' && <p className="hint">A pasta principal passa para a nova branch.</p>}<div className="actions"><button type="button" className="secondary" onClick={() => setAsk(undefined)}>Cancelar</button><button type="submit" disabled={!newName.trim()}>Criar</button></div></form></div>}
  </div>
}
