import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IpcOutput } from '@agentboard/contracts'
import { Markdown } from './markdown'
import { Checkbox } from './Checkbox'
import { Select } from './Select'
import { plainError } from './NoticeDialog'
import { BranchIcon, FolderGlyph, CloseIcon, CollapseIcon, ExpandIcon, WorktreeIcon } from './icons'
import { WindowLayoutMenu } from './WindowLayoutMenu'
import { FileContextMenu, type FileMenuItem } from './FileContextMenu'
import { FileFind, fileMatches, type FindOptions } from './FileFind'
import { fileKind, FileTypeIcon, sourceTokens } from './FileAppearance'
import { terminal } from './terminalStore'
import { DiffLines } from './gitDiff'
import type { FileChange } from './changes'
import { DiffIcon } from './icons'

type Entry = IpcOutput<'workspace:list'>[number] & { branch?: string | null; worktree?: boolean; cardId?: string | null; cardTitle?: string | null }
type Document = IpcOutput<'workspace:read'> & { saved: string; preview: boolean; error: string; diffView?: boolean }
type Preferences = { tree: boolean; treeSide: 'left' | 'right'; tabs: boolean; autosave: boolean; indent: boolean; wrap: boolean; guides: boolean; whitespace: boolean; beyond: boolean; tabSize: number }
const defaults: Preferences = { tree: true, treeSide: 'left', tabs: true, autosave: false, indent: true, wrap: true, guides: true, whitespace: false, beyond: false, tabSize: 2 }
const readPreferences = (): Preferences => { try { const saved = JSON.parse(localStorage.getItem('agentboard.filePreferences') ?? '{}'); const migrated = localStorage.getItem('agentboard.fileTreeLeftV2') === '1'; localStorage.setItem('agentboard.fileTreeLeftV2', '1'); return { ...defaults, ...saved, treeSide: migrated ? saved.treeSide ?? 'left' : 'left' } } catch { return defaults } }
const nameOf = (path: string): string => path.split(/[\\/]/).at(-1) ?? path
type Position = 'left' | 'right' | 'top' | 'bottom'
const positionKey = 'agentboard.filePanelPosition'
/** Painel que, no momento, reserva espaço ao lado do conteúdo principal (só um por vez). */
let dockOwner: HTMLElement | null = null
/** O painel de arquivos abre à esquerda e lembra a posição que o usuário escolheu em "Mover". */
const readPosition = (): Position => { try { const saved = localStorage.getItem(positionKey); return saved === 'right' || saved === 'top' || saved === 'bottom' ? saved : 'left' } catch { return 'left' } }
const isMarkdown = (path: string): boolean => /\.(md|mdx|markdown)$/i.test(path)
const isHtml = (path: string): boolean => /\.html?$/i.test(path)
const pathKey = (path: string): string => path.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase()
function GitContextChip({ root, title }: { root: { branch?: string | null; worktree?: boolean }; title?: string }): React.JSX.Element {
  const label = root.branch || (root.worktree ? 'Worktree' : 'Pasta principal')
  return <small className={`wf-branchchip ${root.worktree ? 'worktree' : ''}`} title={title ?? `${root.worktree ? 'Worktree' : 'Branch'}: ${label}`}>{root.worktree ? <WorktreeIcon /> : root.branch ? <BranchIcon /> : null}<span>{label}</span></small>
}

function TreeFolder({ entry, context, contexts, selected, open, reveal, menu, depth = 0 }: { entry: Entry; context: { projectId: string; cardId: string | null }; contexts: IpcOutput<'workspace:roots'>; selected?: string; open(path: string): void; reveal?: { path: string; at: number }; menu(entry: Entry, event: React.MouseEvent): void; depth?: number }): React.JSX.Element {
  const [expanded, setExpanded] = useState(depth === 0), [entries, setEntries] = useState<Entry[]>(), [error, setError] = useState('')
  const row = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!reveal) return
    const normalize = (value: string): string => value.replace(/\\/g, '/').toLowerCase()
    if (entry.directory && normalize(reveal.path).startsWith(`${normalize(entry.path)}/`)) setExpanded(true)
    if (normalize(reveal.path) === normalize(entry.path)) row.current?.scrollIntoView({ block: 'nearest' })
  }, [reveal?.at, entry.path])
  useEffect(() => {
    if (!expanded || !entry.directory) return
    let alive = true
    void window.agentboard.invoke('workspace:list', { ...context, path: entry.path }).then((items) => { if (alive) { setEntries(items); setError('') } }).catch((reason) => { if (alive) setError(plainError(reason)) })
    return () => { alive = false }
  }, [expanded, entry.path, context.projectId, context.cardId, entry.directory])
  return <div role="treeitem" aria-expanded={entry.directory ? expanded : undefined} aria-selected={selected === entry.path}>
    <button ref={row} type="button" className={`wf-treeitem ${selected === entry.path ? 'on' : ''}`} style={{ paddingLeft: 10 + depth * 13 }} title={entry.path} onContextMenu={(event) => menu(entry, event)} onClick={() => entry.directory ? setExpanded(!expanded) : open(entry.path)}>
      <span className={`wf-chevron ${expanded ? 'open' : ''}`} aria-hidden="true">{entry.directory && <svg viewBox="0 0 12 12"><path d="m4.5 2.5 3.5 3.5-3.5 3.5" /></svg>}</span><FileTypeIcon path={entry.path} directory={entry.directory} /><span className="wf-tree-label"><span>{entry.name}</span>{entry.worktree !== undefined && <GitContextChip root={entry} />}</span>
    </button>
    {entry.directory && expanded && <div role="group">{error ? <p className="wf-note error">{error}</p> : !entries ? <p className="wf-note">Carregando…</p> : !entries.length ? <p className="wf-note">Pasta vazia</p> : entries.map((item) => { const root = contexts.find((candidate) => pathKey(candidate.path) === pathKey(item.path)); return <TreeFolder key={item.path} entry={root ? { ...item, ...root } : item} context={context} contexts={contexts} selected={selected} open={open} reveal={reveal} menu={menu} depth={depth + 1} /> })}</div>}
  </div>
}

/** Explorador do projeto/worktree com editor, visualização e uma janela exclusiva por arquivo. */
export function WorkspaceFiles({ projectId, cardId, initialPath, initialPaths = [], close, standalone = false, isolated = false, changes, startExpanded = false }: { projectId: string; cardId: string | null; initialPath?: string; initialPaths?: string[]; close(): void; standalone?: boolean; isolated?: boolean; changes?: FileChange[]; startExpanded?: boolean }): React.JSX.Element {
  const context = { projectId, cardId }
  const [roots, setRoots] = useState<IpcOutput<'workspace:roots'>>([]), [documents, setDocuments] = useState<Document[]>([]), [active, setActive] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [preferences, setPreferences] = useState(readPreferences), [query, setQuery] = useState(''), [results, setResults] = useState<IpcOutput<'workspace:search'>>(), [searching, setSearching] = useState(false)
  const [menu, setMenu] = useState<'settings' | null>(null), [expanded, setExpanded] = useState(startExpanded), [position, setPositionState] = useState<Position>(readPosition), [find, setFind] = useState(false), [needle, setNeedle] = useState(''), [treeVisible, setTreeVisible] = useState(!isolated)
  const [tabMenu, setTabMenu] = useState<{ entry: Entry; x: number; y: number }>(), [reveal, setReveal] = useState<{ path: string; at: number }>(), [findOptions, setFindOptions] = useState<FindOptions>({ caseSensitive: false, wholeWord: false, regex: false }), [matchIndex, setMatchIndex] = useState(-1), [image, setImage] = useState('')
  const [draggingTab, setDraggingTab] = useState<string>(), [tabDrop, setTabDrop] = useState<number>(), internalTabDrop = useRef(false), draggedTabWidth = useRef(110), tabGeometry = useRef<Array<{ center: number }>>([])
  const slashed = (value: string): string => value.replace(/\\/g, '/').toLowerCase()
  const changePath = (item: FileChange): string => item.root ? `${item.root.replace(/[\\/]+$/, '')}/${item.path}` : item.path
  const changeFor = (path: string): FileChange | undefined => changes?.find((item) => item.root ? slashed(path) === slashed(changePath(item)) : slashed(path).endsWith(`/${slashed(item.path)}`))
  const changeTotals = useMemo(() => ({ added: changes?.reduce((sum, item) => sum + item.added, 0) ?? 0, removed: changes?.reduce((sum, item) => sum + item.removed, 0) ?? 0 }), [changes])
  const current = documents.find((item) => item.path === active), latest = useRef(documents), editor = useRef<HTMLTextAreaElement>(null), gutter = useRef<HTMLPreElement>(null), menuBox = useRef<HTMLDivElement>(null), searchField = useRef<HTMLInputElement>(null), loadingId = useRef(0), pending = useRef(new Set<string>())
  const currentRoot = current ? [...roots].sort((a, b) => b.path.length - a.path.length).find((root) => { const path = slashed(current.path), base = slashed(root.path).replace(/\/$/, ''); return path === base || path.startsWith(`${base}/`) }) : undefined
  const commentCardId = currentRoot?.cardId ?? cardId, commentTarget = currentRoot?.cardTitle || (commentCardId ? 'Card aberto' : 'Novo chat')
  const [lineHeights, setLineHeights] = useState<number[]>([]), whitespace = useRef<HTMLPreElement>(null), guides = useRef<HTMLDivElement>(null), syntax = useRef<HTMLPreElement>(null), picks = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<[number, number] | null>(null), [composing, setComposing] = useState(false), [comment, setComment] = useState(''), [scrollTop, setScrollTop] = useState(0), pickDrag = useRef<number | null>(null), commentField = useRef<HTMLTextAreaElement>(null), [commentError, setCommentError] = useState('')
  const [treeWidth, setTreeWidth] = useState(() => { try { return Number(localStorage.getItem('agentboard.fileTreeWidth')) || 240 } catch { return 240 } }), [resizingTree, setResizingTree] = useState(false)
  const contentLines = useMemo(() => (current?.content ?? '').split('\n'), [current?.content])
  const search = useMemo(() => fileMatches(current?.content ?? '', needle, findOptions), [current?.content, needle, findOptions])
  const tokens = useMemo(() => (current?.content.length ?? 0) > 200_000 ? [{ text: current?.content ?? '', kind: '' }] : sourceTokens(current?.content ?? '', current?.path ?? ''), [current?.content, current?.path])
  useEffect(() => { setMatchIndex(-1) }, [needle, findOptions, active])
  useEffect(() => { setLines(null); setComposing(false); setComment(''); setCommentError('') }, [active])
  useEffect(() => { const up = (): void => { pickDrag.current = null }; document.addEventListener('mouseup', up); return () => document.removeEventListener('mouseup', up) }, [])
  useEffect(() => { if (composing) commentField.current?.focus() }, [composing])
  useEffect(() => { setImage(''); if (!current || fileKind(current.path) !== 'image') return; let alive = true; void window.agentboard.invoke('workspace:image', { ...context, path: current.path }).then((url) => { if (alive) setImage(url) }).catch((reason) => { if (alive) setError(plainError(reason)) }); return () => { alive = false } }, [active])
  useEffect(() => {
    const field = editor.current
    if (!field || !current || current.preview) return
    const measure = (): void => {
      const style = getComputedStyle(field), canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.font = style.font
      const width = Math.max(1, field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight))
      setLineHeights(contentLines.map((line) => preferences.wrap ? Math.max(1, Math.ceil(ctx.measureText(line.replace(/\t/g, ' '.repeat(preferences.tabSize))).width / width)) * 21 : 21))
    }
    measure(); const observer = new ResizeObserver(measure); observer.observe(field); return () => observer.disconnect()
  }, [current?.content, current?.path, current?.preview, preferences.wrap, preferences.tabSize])
  latest.current = documents
  // Painel encostado à esquerda ou à direita: avisa a largura que ocupa (--files-dock-left/right) e o conteúdo principal abre espaço, lado a lado.
  const panel = useRef<HTMLElement>(null)
  const [dockWidth, setDockWidth] = useState<number | null>(() => { try { return Number(localStorage.getItem('agentboard.fileDockWidth')) || null } catch { return null } }), [resizingDock, setResizingDock] = useState(false)
  // A linha na borda de dentro do painel ajusta a largura; o sentido do arraste depende do lado em que o painel está.
  const resizeDock = (event: React.PointerEvent<HTMLDivElement>): void => {
    const element = panel.current; if (!element) return
    event.preventDefault()
    const start = event.clientX, initial = element.getBoundingClientRect().width, sign = position === 'right' ? -1 : 1
    let latestWidth = initial
    setResizingDock(true)
    const move = (next: PointerEvent): void => { latestWidth = Math.round(Math.max(320, Math.min(window.innerWidth * .9, initial + sign * (next.clientX - start)))); setDockWidth(latestWidth) }
    const up = (): void => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); setResizingDock(false)
      try { localStorage.setItem('agentboard.fileDockWidth', String(latestWidth)) } catch { /* só vale nesta sessão */ }
    }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up)
  }
  const sideDocked = !expanded && !standalone && (position === 'left' || position === 'right')
  useEffect(() => {
    const element = panel.current
    if (!element || standalone) return
    const publish = (): void => {
      const width = element.offsetParent === null || expanded ? 0 : Math.round(element.getBoundingClientRect().width)
      const root = document.documentElement.style
      if (width > 0 && (position === 'left' || position === 'right')) { dockOwner = element; root.setProperty('--files-dock-left', position === 'left' ? `${width}px` : '0px'); root.setProperty('--files-dock-right', position === 'right' ? `${width}px` : '0px') }
      else if (dockOwner === element) { dockOwner = null; root.setProperty('--files-dock-left', '0px'); root.setProperty('--files-dock-right', '0px') }
    }
    publish(); const observer = new ResizeObserver(publish); observer.observe(element)
    return () => { observer.disconnect(); if (dockOwner === element) { dockOwner = null; document.documentElement.style.setProperty('--files-dock-left', '0px'); document.documentElement.style.setProperty('--files-dock-right', '0px') } }
  }, [position, expanded, standalone])
  const setPosition = (value: Position): void => { setPositionState(value); try { localStorage.setItem(positionKey, value) } catch { /* só vale nesta sessão */ } }
  const change = (patch: Partial<Preferences>): void => setPreferences((value) => { const next = { ...value, ...patch }; localStorage.setItem('agentboard.filePreferences', JSON.stringify(next)); return next })
  const updateDocument = (path: string, patch: Partial<Document>): void => setDocuments((all) => all.map((item) => item.path === path ? { ...item, ...patch } : item))
  const save = useCallback(async (path: string): Promise<boolean> => {
    const file = latest.current.find((item) => item.path === path)
    if (!file) return false
    if (file.content === file.saved) return true
    if (file.binary || file.truncated) return false
    if (pending.current.has(path)) return false
    pending.current.add(path)
    try {
      await window.agentboard.invoke('workspace:write', { projectId, cardId, path, content: file.content, expected: file.saved })
      setDocuments((all) => all.map((item) => item.path === path ? { ...item, saved: file.content, error: '' } : item)); return true
    } catch (reason) { updateDocument(path, { error: plainError(reason) }); return false }
    finally { pending.current.delete(path) }
  }, [projectId, cardId])
  const open = useCallback(async (path: string): Promise<void> => {
    const existing = latest.current.find((item) => item.path === path)
    if (existing) { setActive(existing.path); return }
    const id = ++loadingId.current; setLoading(true); setError('')
    try {
      const file = await window.agentboard.invoke('workspace:read', { projectId, cardId, path })
      setDocuments((all) => all.some((item) => item.path === file.path) ? all : [...all, { ...file, saved: file.content, preview: isMarkdown(file.path) || fileKind(file.path) === 'image', error: '', diffView: Boolean(changeFor(file.path)?.diff) }]); if (id === loadingId.current) setActive(file.path)
    } catch (reason) { if (id === loadingId.current) setError(plainError(reason)) }
    finally { if (id === loadingId.current) setLoading(false) }
  }, [projectId, cardId])
  useEffect(() => { void window.agentboard.invoke('workspace:roots', context).then(setRoots).catch((reason) => setError(plainError(reason))) }, [projectId, cardId])
  const openedInitial = useRef('')
  useEffect(() => {
    const ordered = [...new Set([...initialPaths.filter((path) => path !== initialPath), ...(initialPath ? [initialPath] : [])])]
    const key = ordered.join('\n'); if (!key || openedInitial.current === key) return; openedInitial.current = key
    void (async () => { for (const path of ordered) await open(path) })()
  }, [initialPath, initialPaths.join('\n'), open])
  const absolute = (relative: string, root?: string): string | undefined => { const base = root ?? roots[0]?.path; return base ? `${base.replace(/[\\/]+$/, '')}/${relative}` : undefined }
  const openChange = (item: FileChange): void => { const path = absolute(item.path, item.root); if (path) void open(path) }
  const firstChange = changes?.find((item) => !item.untracked) ?? changes?.[0]
  const autoOpened = useRef(false)
  useEffect(() => { if (autoOpened.current || !firstChange || !roots.length || initialPath) return; autoOpened.current = true; openChange(firstChange) }, [roots, firstChange])
  const openAllChanges = (): void => { (changes ?? []).slice(0, 20).forEach((item) => { const path = absolute(item.path, item.root); if (path) void open(path) }) }
  useEffect(() => {
    if (changes || !query.trim()) { setResults(undefined); setSearching(false); return }
    let alive = true; setSearching(true)
    const timer = window.setTimeout(() => { void window.agentboard.invoke('workspace:search', { ...context, query: query.trim() }).then((result) => { if (alive) setResults(result) }).catch((reason) => { if (alive) setError(plainError(reason)) }).finally(() => { if (alive) setSearching(false) }) }, 250)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query, projectId, cardId])
  useEffect(() => {
    if (!preferences.autosave) return
    const timer = window.setTimeout(() => { documents.filter((item) => item.content !== item.saved && !item.error).forEach((item) => { void save(item.path) }) }, 800)
    return () => window.clearTimeout(timer)
  }, [documents, preferences.autosave, save])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent): void => { if (latest.current.some((item) => item.content !== item.saved)) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload)
  }, [])
  useEffect(() => {
    if (!menu) return
    const away = (event: PointerEvent): void => { if (!menuBox.current?.contains(event.target as Node)) setMenu(null) }
    document.addEventListener('pointerdown', away); return () => document.removeEventListener('pointerdown', away)
  }, [menu])
  useEffect(() => { if (find) searchField.current?.focus() }, [find])
  const closeTab = (file: Document): void => {
    if (file.content !== file.saved && !window.confirm(`Descartar as alterações de ${nameOf(file.path)}?`)) return
    const rest = documents.filter((item) => item.path !== file.path); setDocuments(rest); if (active === file.path) setActive(rest.at(-1)?.path ?? '')
  }
  // Fecha vários de uma vez (outros, à esquerda, à direita, todos); se algum tiver alterações sem salvar, pergunta uma vez só.
  const closeMany = (files: Document[], keep?: Document): void => {
    if (!files.length) return
    const dirty = files.filter((item) => item.content !== item.saved)
    if (dirty.length && !window.confirm(dirty.length === 1 ? `Descartar as alterações de ${nameOf(dirty[0]!.path)}?` : `Descartar as alterações de ${dirty.length} arquivos?`)) return
    const gone = new Set(files.map((item) => item.path)), rest = documents.filter((item) => !gone.has(item.path))
    setDocuments(rest); if (gone.has(active)) setActive(keep?.path ?? rest.at(-1)?.path ?? '')
  }
  const leave = (): void => {
    if (standalone && documents.some((item) => item.content !== item.saved)) {
      if (!window.confirm('Há alterações sem salvar. Descartar e fechar os arquivos?')) return
      latest.current = []; setDocuments([])
    }
    close()
  }
  const searchInFile = (direction = 1): void => {
    if (!current || !search.matches.length) return
    if (current.preview) updateDocument(current.path, { preview: false })
    const next = (matchIndex < 0 ? direction > 0 ? 0 : search.matches.length - 1 : matchIndex + direction + search.matches.length) % search.matches.length
    setMatchIndex(next); const [at, end] = search.matches[next]!
    window.setTimeout(() => { const input = editor.current; if (!input) return; input.focus(); input.setSelectionRange(at, end); const line = current.content.slice(0, at).split('\n').length - 1; input.scrollTop = Math.max(0, lineHeights.slice(0, line).reduce((sum, height) => sum + height, 0) - 42) }, 0)
  }
  const showFind = (path = active): void => { setActive(path); setTabMenu(undefined); setFind(true); window.setTimeout(() => { searchField.current?.focus(); searchField.current?.select() }, 0) }
  const reload = async (path: string): Promise<void> => {
    const document = latest.current.find((item) => item.path === path)
    if (document && document.content !== document.saved && !window.confirm('Descartar suas alterações e reler do disco?')) return
    setLoading(true)
    try { const file = await window.agentboard.invoke('workspace:read', { ...context, path }); if (document) updateDocument(path, { ...file, saved: file.content, error: '' }); else await open(path) } catch (reason) { setError(plainError(reason)) } finally { setLoading(false) }
  }
  const perform = (action: () => Promise<unknown>): void => { void action().catch((reason) => setError(plainError(reason))) }
  const relative = (path: string): string => {
    const document = latest.current.find((item) => item.path === path); if (document) return document.relative
    const normalized = path.replace(/\\/g, '/'), root = roots.find((item) => normalized.toLowerCase().startsWith(`${item.path.replace(/\\/g, '/').toLowerCase()}/`))
    return root ? normalized.slice(root.path.length + 1) : nameOf(path)
  }
  const showContext = (entry: Entry, event: React.MouseEvent): void => { event.preventDefault(); event.stopPropagation(); setTabMenu({ entry, x: event.clientX, y: event.clientY }) }
  const fileMenu = (entry: Entry): FileMenuItem[] => {
    const document = latest.current.find((item) => item.path === entry.path), path = entry.path
    const external = (target: 'vscode' | 'default' | 'explorer'): void => perform(async () => { if (document && document.content !== document.saved && !await save(path)) return; await window.agentboard.invoke('workspace:external', { ...context, path, target }) })
    return [
      ...(!entry.directory ? [{ label: 'Anexar como contexto', action: () => perform(async () => { if (document && document.content !== document.saved && !await save(path)) return; await window.agentboard.invoke('workspace:attach', { ...context, path }); if (!standalone) close() }) }] : []),
      { label: 'Copiar', children: [{ label: 'Caminho absoluto', action: () => perform(() => navigator.clipboard.writeText(path)) }, { label: 'Caminho relativo', action: () => perform(() => navigator.clipboard.writeText(relative(path))) }, { label: 'Nome do arquivo', action: () => perform(() => navigator.clipboard.writeText(entry.name)) }] },
      { label: 'Abrir em', separator: true, children: [{ label: 'VS Code', action: () => external('vscode') }, { label: 'Aplicativo padrão', action: () => external('default') }] },
      { label: 'Mostrar no Explorer', action: () => external('explorer') },
      { label: 'Abrir no terminal', action: () => { terminal.setContext(context); void terminal.openPath({ ...context, path }) } },
      ...(!entry.directory ? [
        { label: 'Mostrar na árvore de arquivos', separator: true, action: () => { setQuery(''); setResults(undefined); setTreeVisible(true); change({ tree: true, treeSide: 'left' }); setReveal({ path, at: Date.now() }) } },
        { label: 'Localizar no arquivo', separator: true, shortcut: 'Ctrl+F', disabled: document?.binary, action: () => { void open(path).then(() => showFind(path)) } },
        { label: 'Copiar conteúdo do arquivo', disabled: document?.binary, action: () => perform(async () => { const file = document ?? await window.agentboard.invoke('workspace:read', { ...context, path }); if (file.binary || file.truncated) throw new Error('O conteúdo completo deste arquivo não está disponível para cópia'); await navigator.clipboard.writeText(file.content) }) },
        { label: 'Recarregar arquivo', action: () => void reload(path) },
        ...(document ? (() => {
        const at = documents.findIndex((item) => item.path === document.path), left = documents.slice(0, at), right = documents.slice(at + 1)
        return [
          { label: 'Fechar arquivo', separator: true, action: () => closeTab(document) } as FileMenuItem,
          ...(documents.length > 1 ? [{ label: 'Fechar outros', action: () => closeMany([...left, ...right], document) } as FileMenuItem] : []),
          ...(left.length ? [{ label: 'Fechar à esquerda', action: () => closeMany(left, document) } as FileMenuItem] : []),
          ...(right.length ? [{ label: 'Fechar à direita', action: () => closeMany(right, document) } as FileMenuItem] : []),
          ...(documents.length > 1 ? [{ label: 'Fechar todos', action: () => closeMany(documents) } as FileMenuItem] : [])
        ]
      })() : [])
      ] : [])
    ]
  }
  const outsideWindow = (event: React.DragEvent): { x: number; y: number } | null => {
    const x = Math.round(event.screenX), y = Math.round(event.screenY)
    if (x === 0 && y === 0) return null
    return x < window.screenX || y < window.screenY || x > window.screenX + window.outerWidth || y > window.screenY + window.outerHeight ? { x, y } : null
  }
  const detachPanel = async (point?: { x: number; y: number }): Promise<void> => {
    for (const file of latest.current) if (file.content !== file.saved && !await save(file.path)) return
    const paths = latest.current.map((file) => file.path).filter((path) => path !== active); if (active) paths.push(active)
    try { await window.agentboard.invoke('windows:open', { kind: 'files', projectId, cardId: cardId ?? undefined, path: active || undefined, paths, placement: 'new', ...point }); setMenu(null); close() } catch (reason) { setError(plainError(reason)) }
  }
  const detachFile = async (file: Document, point: { x: number; y: number }): Promise<void> => {
    if (!await save(file.path)) return
    try {
      await window.agentboard.invoke('windows:open', { kind: 'file', projectId, cardId: cardId ?? undefined, path: file.path, placement: 'new', ...point })
      const rest = latest.current.filter((item) => item.path !== file.path); latest.current = rest; setDocuments(rest); if (active === file.path) setActive(rest.at(-1)?.path ?? '')
    } catch (reason) { setError(plainError(reason)) }
  }
  const dropTab = (path: string, requestedIndex: number): void => {
    internalTabDrop.current = true; setTabDrop(undefined)
    setDocuments((all) => {
      const file = all.find((item) => item.path === path); if (!file) return all
      const rest = all.filter((item) => item.path !== path), index = Math.max(0, Math.min(requestedIndex, rest.length))
      const next = [...rest.slice(0, index), file, ...rest.slice(index)]; latest.current = next; return next
    })
  }
  const previewIndex = (clientX: number): number => {
    const index = tabGeometry.current.findIndex((item) => clientX < item.center)
    return index < 0 ? tabGeometry.current.length : index
  }
  const returnToMain = async (): Promise<void> => {
    if (!current || !await save(current.path)) return
    try { await window.agentboard.invoke('windows:return-file', { ...context, path: current.path }); window.close() } catch (reason) { setError(plainError(reason)) }
  }
  const pickLine = (index: number, event: React.MouseEvent): void => {
    if (event.button !== 0) return
    setScrollTop(editor.current?.scrollTop ?? 0)
    event.preventDefault()
    if (event.shiftKey && lines) { setLines([lines[0], index]); return }
    pickDrag.current = index; setComposing(false); setLines([index, index])
  }
  const resizeTree = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const body = event.currentTarget.parentElement, start = event.clientX, treeElement = event.currentTarget.parentElement?.querySelector<HTMLElement>('.wf-tree'), initial = treeElement?.getBoundingClientRect().width ?? treeWidth
    if (!body) return
    setResizingTree(true)
    const move = (next: PointerEvent): void => {
      const delta = preferences.treeSide === 'left' ? next.clientX - start : start - next.clientX
      setTreeWidth(Math.round(Math.max(160, Math.min(body.getBoundingClientRect().width * .45, initial + delta))))
    }
    const up = (): void => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); setResizingTree(false)
      const width = treeElement?.getBoundingClientRect().width; if (width) try { localStorage.setItem('agentboard.fileTreeWidth', String(Math.round(width))) } catch { /* só vale nesta sessão */ }
    }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up)
  }
  const sendComment = async (): Promise<void> => {
    if (!current || !lines || !comment.trim()) return
    const from = Math.min(...lines), to = Math.max(...lines), code = current.content.split('\n').slice(from, to + 1).join('\n')
    const fence = '`'.repeat(Math.max(3, ...(code.match(/`+/g) ?? []).map((run) => run.length + 1))), language = /\.([A-Za-z0-9]+)$/.exec(current.path)?.[1] ?? ''
    const span = from === to ? `linha ${from + 1}` : `linhas ${from + 1}–${to + 1}`
    const text = `Comentário em \`${current.relative}\` (${span}${current.content !== current.saved ? ', texto atual do editor, com alterações ainda não salvas' : ''}):\n\n${fence}${language}\n${code}\n${fence}\n\n${comment.trim()}`
    try { setCommentError(''); await window.agentboard.invoke('workspace:comment', { projectId, cardId: commentCardId, text }); setLines(null); setComposing(false); setComment(''); if (!standalone) close() } catch (reason) { setCommentError(plainError(reason)) }
  }
  const toggleFind = (): void => { if (find) setFind(false); else showFind() }
  const fill = (): void => { if (standalone) void window.agentboard.invoke('windows:place', { placement: expanded ? 'new' : 'fill' }); setExpanded(!expanded); setMenu(null) }
  const keyDown = (event: React.KeyboardEvent): void => {
    if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); if (current) void save(current.path) }
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); showFind() }
    if (event.key === 'Escape') { setMenu(null); setFind(false) }
  }
  const tree = treeVisible && preferences.tree
  return <section ref={panel} className={`workspacefiles ${standalone ? 'standalone' : ''} ${expanded ? 'expanded' : position} ${resizingTree ? 'tree-resizing' : ''} ${resizingDock ? 'dock-resizing' : ''}`} style={sideDocked && dockWidth ? { width: dockWidth } : undefined} aria-label="Arquivos do projeto" onKeyDown={keyDown}>
    {sideDocked && <div className={`wf-dockgrip ${position}`} role="separator" aria-orientation="vertical" aria-label="Ajustar a largura do painel de arquivos" onPointerDown={resizeDock} onDoubleClick={() => { setDockWidth(null); try { localStorage.removeItem('agentboard.fileDockWidth') } catch { /* só vale nesta sessão */ } }} />}
    <header className="wf-header" draggable={!standalone} onDragStart={(event) => { if ((event.target as HTMLElement).closest('.wf-actions')) { event.preventDefault(); return }; event.preventDefault(); void detachPanel({ x: Math.round(event.screenX), y: Math.round(event.screenY) }) }}><FolderGlyph /><b>{isolated ? nameOf(active || initialPath || 'Arquivo') : changes ? 'Alterações' : 'Arquivos'}</b>{changes ? <span className="wf-context wf-totals" title={roots.map((root) => root.path).join('\n')}><span className="ch-add">+{changeTotals.added}</span> <span className="ch-del">−{changeTotals.removed}</span> · {changes.length} {changes.length === 1 ? 'arquivo' : 'arquivos'}</span> : <span className="wf-context" title={roots.map((root) => root.path).join('\n')}>{cardId ? 'Worktree do card' : 'Projeto'}</span>}<div className="wf-actions">
      <button type="button" className="ibtn" title="Pesquisar no arquivo (Ctrl+F)" aria-label="Pesquisar no arquivo" onClick={toggleFind}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg></button>

      {isolated && <button type="button" className="ibtn" title="Voltar à janela principal" aria-label="Voltar à janela principal" onClick={() => void returnToMain()}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10v10H5zM8 3H3v5m0-5 7 7" /></svg></button>}
      {changes && <button type="button" className="ibtn tip" data-tip="Abrir todos os arquivos alterados em abas" aria-label="Abrir todos os arquivos alterados em abas" disabled={!changes.length} onClick={openAllChanges}><DiffIcon /></button>}
      <div className="wf-menus" ref={menuBox}>
        <button type="button" className="ibtn" aria-label="Configurações do arquivo" aria-expanded={menu === 'settings'} onClick={() => setMenu(menu === 'settings' ? null : 'settings')}>···</button>
        {menu === 'settings' && <div className="popmenu wf-settings" role="dialog" aria-label="Configurações do editor">
          {([['tree', 'Mostrar árvore de arquivos'], ['tabs', 'Abas de visualização'], ['autosave', 'Salvamento automático'], ['indent', 'Tab insere recuo'], ['wrap', 'Quebra de linha'], ['guides', 'Guias de recuo'], ['whitespace', 'Mostrar espaços em branco'], ['beyond', 'Rolar além do fim']] as const).map(([key, label]) => <label key={key}><Checkbox checked={preferences[key]} onChange={(value) => { change({ [key]: value }); if (key === 'tree') setTreeVisible(true) }} />{label}</label>)}
          <label>Posição da árvore<Select label="Posição da árvore" value={preferences.treeSide} options={[{ value: 'left', label: 'Esquerda' }, { value: 'right', label: 'Direita' }]} onChange={(value) => change({ treeSide: value as Preferences['treeSide'] })} /></label>
          <label>Tamanho da tabulação<Select label="Tamanho da tabulação" value={String(preferences.tabSize)} options={[2, 4, 8].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => change({ tabSize: Number(value) })} /></label>
        </div>}
      </div><WindowLayoutMenu move={(value) => { if (standalone) void window.agentboard.invoke('windows:place', { placement: value }); else { setPosition(value); setExpanded(false) } }} detach={!standalone ? () => void detachPanel() : undefined} />{!standalone && <><button type="button" className="ibtn" aria-label={expanded ? 'Restaurar arquivos' : 'Expandir arquivos'} title={expanded ? 'Restaurar arquivos' : 'Expandir arquivos'} onClick={fill}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button><button type="button" className="ibtn" aria-label="Fechar arquivos" onClick={leave}><CloseIcon /></button></>}
    </div></header>
    {tabMenu && <FileContextMenu x={tabMenu.x} y={tabMenu.y} items={fileMenu(tabMenu.entry)} close={() => setTabMenu(undefined)} find={() => showFind(tabMenu.entry.path)} />}
    <div className="wf-tabbar">
      <button type="button" className={`ibtn wf-treebtn ${tree ? 'on' : ''}`} title={tree ? 'Esconder a árvore de arquivos' : 'Mostrar a árvore de arquivos'} aria-label="Árvore de arquivos" aria-pressed={tree} onClick={() => { setTreeVisible(true); change({ tree: !tree }) }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4h2m3 0h7M4 10h2m3 0h7M4 16h2m3 0h7" /></svg></button>
      {preferences.tabs && documents.length > 0 && <div className="wf-tabs" role="tablist" aria-label="Arquivos abertos"
        onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-agentboard-file')) { event.preventDefault(); const index = previewIndex(event.clientX); setTabDrop((current) => current === index ? current : index) } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTabDrop(undefined) }}
        onDrop={(event) => { event.preventDefault(); const path = event.dataTransfer.getData('application/x-agentboard-file'); if (path) dropTab(path, tabDrop ?? previewIndex(event.clientX)) }}>
        {(() => { let visibleIndex = 0; const dragged = documents.find((file) => file.path === draggingTab); const placeholder = dragged ? <span className="wf-tab-placeholder" style={{ width: draggedTabWidth.current }} aria-hidden="true"><span><FileTypeIcon path={dragged.path} />{nameOf(dragged.path)}{dragged.saved !== dragged.content ? ' •' : ''}</span><i>×</i></span> : null; return <>
        {documents.map((file) => {
          const index = file.path === draggingTab ? -1 : visibleIndex++
          return <React.Fragment key={file.path}>
            {index >= 0 && tabDrop === index && placeholder}
            <div draggable={!isolated} data-file-tab={file.path} className={`wf-tab ${file.path === active ? 'on' : ''} ${draggingTab === file.path ? 'dragging' : ''}`}
              onDragStart={(event) => { internalTabDrop.current = false; const source = event.currentTarget, sourceRect = source.getBoundingClientRect(), tabs = [...source.parentElement!.querySelectorAll<HTMLElement>('[data-file-tab]')], sourceIndex = tabs.indexOf(source); draggedTabWidth.current = Math.round(sourceRect.width); tabGeometry.current = tabs.filter((tab) => tab !== source).map((tab, index) => { const rect = tab.getBoundingClientRect(), wasAfterSource = index >= sourceIndex; return { center: rect.left + rect.width / 2 - (wasAfterSource ? sourceRect.width + 9 : 0) } }); const dragged = file.path, startIndex = Math.max(0, sourceIndex); window.setTimeout(() => { setDraggingTab(dragged); setTabDrop(startIndex) }, 0); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-agentboard-file', file.path) }}
              onDragEnd={(event) => { tabGeometry.current = []; setDraggingTab(undefined); setTabDrop(undefined); const point = internalTabDrop.current ? null : outsideWindow(event); internalTabDrop.current = false; const draggedFile = latest.current.find((item) => item.path === file.path); if (point && draggedFile) void detachFile(draggedFile, point) }}
              onContextMenu={(event) => showContext({ path: file.path, name: nameOf(file.path), directory: false }, event)}>
              <button type="button" role="tab" aria-selected={file.path === active} title={file.path} onClick={() => startTransition(() => setActive(file.path))}><FileTypeIcon path={file.path} />{nameOf(file.path)}{file.saved !== file.content ? ' •' : ''}</button><button type="button" aria-label={`Fechar ${nameOf(file.path)}`} onClick={() => closeTab(file)}>×</button>
            </div>
          </React.Fragment>
        })}
        {draggingTab && tabDrop === visibleIndex && placeholder}</> })()}
      </div>}
    </div>
    <div className={`wf-body ${tree ? `tree-${preferences.treeSide}` : ''}`} style={{ '--wf-tree-width': `${treeWidth}px` } as React.CSSProperties}>
      {tree && <nav className="wf-tree" aria-label="Árvore de arquivos"><input className="in" aria-label={changes ? 'Pesquisar arquivos alterados' : 'Pesquisar arquivos'} placeholder={changes ? 'Pesquisar arquivos alterados…' : 'Pesquisar arquivos…'} value={query} onChange={(event) => setQuery(event.target.value)} />{searching && <p className="wf-note">Pesquisando…</p>}{changes ? <div role="list" aria-label="Arquivos alterados">{changes.filter((item) => item.path.toLowerCase().includes(query.trim().toLowerCase())).map((item) => { const slash = item.path.lastIndexOf('/'), name = item.path.slice(slash + 1), dir = slash > 0 ? item.path.slice(0, slash) : '', path = absolute(item.path, item.root), detail = [item.root ? nameOf(item.root) : '', dir].filter(Boolean).join('/'); return <button key={`${item.root ?? ''}:${item.path}`} type="button" role="listitem" className={`wf-result wf-changed ${path && slashed(active) === slashed(path) ? 'on' : ''}`} title={path ?? item.path} onContextMenu={(event) => { if (path) showContext({ path, name, directory: false }, event) }} onClick={() => openChange(item)}><b><FileTypeIcon path={item.path} />{name}{item.untracked ? <span className="ch-new">novo</span> : <span className="wf-nums"><span className="ch-add">+{item.added}</span><span className="ch-del">−{item.removed}</span></span>}</b>{detail && <small>{detail}</small>}</button> })}{!changes.length && <p className="wf-note">Nenhum arquivo alterado.</p>}</div> : results ? <div>{results.paths.map((path) => <button key={path} type="button" className={`wf-result ${active === path ? 'on' : ''}`} title={path} onContextMenu={(event) => showContext({ path, name: nameOf(path), directory: false }, event)} onClick={() => void open(path)}><b><FileTypeIcon path={path} />{nameOf(path)}</b><small>{path}</small></button>)}{!results.paths.length && !searching && <p className="wf-note">Nenhum arquivo encontrado.</p>}{results.limited && <p className="wf-note">Busca limitada; refine o nome. Pastas de dependências e build ficam fora da busca.</p>}</div> : <div role="tree">{roots.filter((root) => root.primary).map((root) => <TreeFolder key={root.path} entry={{ ...root, directory: true }} context={context} contexts={roots} selected={active} open={(path) => void open(path)} reveal={reveal} menu={showContext} />)}</div>}</nav>}
      {tree && <div className="wf-treesplit" role="separator" aria-label="Ajustar largura da árvore de arquivos" aria-orientation="vertical" onPointerDown={resizeTree} onDoubleClick={() => { setTreeWidth(240); try { localStorage.setItem('agentboard.fileTreeWidth', '240') } catch { /* só vale nesta sessão */ } }} />}
      <div className="wf-document">{current && <div className="wf-filebar"><span title={current.path}>{current.relative}</span>{currentRoot && <GitContextChip root={currentRoot} title={currentRoot.path} />}{!current.binary && !current.truncated && <>
        {(isMarkdown(current.path) || isHtml(current.path) || fileKind(current.path) === 'image') && <button type="button" className="wf-iconchip" aria-label={current.preview ? 'Ver código fonte' : 'Visualizar'} title={current.preview ? 'Ver código fonte' : 'Visualizar'} onClick={() => updateDocument(current.path, { preview: !current.preview })}><svg viewBox="0 0 20 20" aria-hidden="true">{current.preview ? <path d="m7 5-5 5 5 5m6-10 5 5-5 5" /> : <><path d="M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z" /><circle cx="10" cy="10" r="2.5" /></>}</svg></button>}
        {changeFor(current.path)?.diff && <button type="button" className={`wf-iconchip ${current.diffView ? 'on' : ''}`} aria-label={current.diffView ? 'Editar o arquivo' : 'Ver as alterações'} title={current.diffView ? 'Editar o arquivo' : 'Ver as alterações (diff)'} onClick={() => updateDocument(current.path, { diffView: !current.diffView })}><DiffIcon /></button>}
        <button type="button" className="wf-iconchip" aria-label="Salvar arquivo" title="Salvar (Ctrl+S)" disabled={current.saved === current.content} onClick={() => void save(current.path)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 2h11l3 3v13H3zM6 2v6h7V2M6 18v-7h8v7" /></svg></button></>}
        <button type="button" className="wf-iconchip" aria-label="Recarregar arquivo" title="Recarregar arquivo" onClick={() => void reload(current.path)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a7 7 0 1 0 1 6M16 2v5h-5" /></svg></button>
      </div>}
      {find && <FileFind input={searchField} query={needle} setQuery={setNeedle} options={findOptions} setOptions={setFindOptions} count={search.matches.length} index={matchIndex} error={search.error} previous={() => searchInFile(-1)} next={() => searchInFile(1)} close={() => setFind(false)} />}
      {(error || current?.error) && <div className="wf-error" role="alert">{error || current?.error}</div>}{loading && <p className="wf-note">Abrindo…</p>}
      {current?.diffView && changeFor(current.path)?.diff ? <div className="wf-diffview"><DiffLines text={changeFor(current.path)!.diff} review={{ path: current.relative, send: async (prompt) => { try { await window.agentboard.invoke('workspace:comment', { projectId, cardId: commentCardId, text: prompt }); if (!standalone) close(); return true } catch (reason) { setError(plainError(reason)); return false } } }} /></div> : !current ? <div className="wf-empty"><FolderGlyph /><p>{changes ? 'Escolha um arquivo alterado.' : 'Escolha um arquivo na árvore.'}</p>{!tree && <button type="button" className="mini secondary" onClick={() => { change({ tree: true }); setTreeVisible(true) }}>Mostrar arquivos</button>}</div> : fileKind(current.path) === 'image' && (current.binary || current.preview) ? <div className="wf-imagepreview">{image ? <img src={image} alt={nameOf(current.path)} /> : <p className="wf-note">{error || 'Carregando prévia…'}</p>}</div> : current.binary ? <p className="wf-note">Este formato não tem prévia e não pode ser editado como texto.</p> : current.preview ? isMarkdown(current.path) ? <div className="md wf-preview"><Markdown source={current.content} /></div> : <iframe className="wf-html" title={`Visualização de ${nameOf(current.path)}`} sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">${current.content}`} /> : <div className={`wf-code ${preferences.wrap ? 'wrap' : ''} ${preferences.guides ? 'guides' : ''}`} style={{ '--wf-tab': preferences.tabSize, '--wf-bottom': preferences.beyond ? '50vh' : '16px' } as React.CSSProperties}>
        <pre className="wf-gutter" ref={gutter}>{contentLines.map((_, index) => <span key={index} className={lines && index >= Math.min(...lines) && index <= Math.max(...lines) ? 'picked' : ''} title="Clique ou arraste para escolher linhas" style={{ display: 'block', height: lineHeights[index] ?? 21, cursor: 'pointer' }} onMouseDown={(event) => pickLine(index, event)} onMouseEnter={() => { if (pickDrag.current !== null) setLines([pickDrag.current, index]) }}>{index + 1}</span>)}</pre>
        <div className={`wf-editarea ${preferences.whitespace ? 'show-whitespace' : ''}`}>{lines && <div className="wf-linepicks" ref={picks} aria-hidden="true">{contentLines.map((_, index) => <div key={index} className={index >= Math.min(...lines) && index <= Math.max(...lines) ? 'on' : ''} style={{ height: lineHeights[index] ?? 21 }} />)}</div>}{lines && !composing && !current.truncated && <button type="button" className="gdl-chatbtn tip" data-tip={`Comentar ${Math.abs(lines[1] - lines[0]) + 1} linha${lines[0] === lines[1] ? '' : 's'}`} aria-label="Comentar as linhas selecionadas" style={{ top: Math.max(4, 12 + lineHeights.slice(0, Math.max(...lines) + 1).reduce((sum, height) => sum + height, 0) - scrollTop - 14) }} onClick={() => setComposing(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg></button>}<pre ref={syntax} className={`wf-syntax ${preferences.wrap ? 'wrap' : ''}`} aria-hidden="true">{tokens.map((token, index) => token.kind ? <span key={index} className={`tok-${token.kind}`}>{token.text}</span> : token.text)}{'\n'}</pre><textarea ref={editor} aria-label={`Código fonte de ${nameOf(current.path)}`} spellCheck={false} readOnly={current.truncated} wrap={preferences.wrap ? 'soft' : 'off'} value={current.content} onChange={(event) => updateDocument(current.path, { content: event.target.value })} onSelect={(event) => {
          const field = event.currentTarget, from = field.selectionStart, end = field.selectionEnd
          if (from === end) { if (!composing) setLines(null); return }
          const last = current.content[end - 1] === '\n' ? end - 1 : end
          setScrollTop(field.scrollTop); setComposing(false); setLines([current.content.slice(0, from).split('\n').length - 1, current.content.slice(0, last).split('\n').length - 1])
        }} onScroll={(event) => { for (const element of [gutter.current, whitespace.current, guides.current, syntax.current, picks.current]) if (element) { element.scrollTop = event.currentTarget.scrollTop; element.scrollLeft = event.currentTarget.scrollLeft }; if (lines) setScrollTop(event.currentTarget.scrollTop) }} onKeyDown={(event) => {
          if (event.key === 'Tab' && preferences.indent) { event.preventDefault(); const field = event.currentTarget, start = field.selectionStart, end = field.selectionEnd, spaces = ' '.repeat(preferences.tabSize); updateDocument(current.path, { content: current.content.slice(0, start) + spaces + current.content.slice(end) }); window.setTimeout(() => { field.selectionStart = field.selectionEnd = start + spaces.length }, 0) }
        }} />{preferences.guides && <div className="wf-indentguides" ref={guides} aria-hidden="true">{contentLines.map((line, index) => <div key={index} style={{ height: lineHeights[index] ?? 21 }}>{Array.from({ length: Math.floor((/^\s*/.exec(line)?.[0].replace(/\t/g, ' '.repeat(preferences.tabSize)).length ?? 0) / preferences.tabSize) }, (_, depth) => <i key={depth} style={{ width: `${preferences.tabSize}ch` }} />)}</div>)}</div>}{preferences.whitespace && <pre ref={whitespace} className="wf-whitespace" aria-hidden="true">{current.content.split(/([ \t]+)/).map((part, index) => index % 2 ? <i key={index}>{part.replace(/ /g, '·').replace(/\t/g, '→' + ' '.repeat(preferences.tabSize - 1))}</i> : part)}</pre>}</div>
      </div>}
      {lines && composing && current && <div className="gdl-compose" role="group" aria-label="Comentar as linhas selecionadas">
        <div className="gdl-askhead"><span>{Math.abs(lines[1] - lines[0]) + 1} linha{lines[0] === lines[1] ? '' : 's'} selecionada{lines[0] === lines[1] ? '' : 's'} em {nameOf(current.path)}</span><span className={`wf-comment-target ${commentCardId ? 'card' : 'new'}`}>{commentTarget}</span><button type="button" className="ghost" onClick={() => { setComposing(false); setLines(null); setComment('') }}>Cancelar</button></div>
        <div className="cbox"><textarea ref={commentField} value={comment} rows={1} placeholder="O que fazer nessas linhas? O comentário vai para o chat com o trecho" aria-label="Comentário sobre as linhas" onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendComment() } else if (event.key === 'Escape') { event.stopPropagation(); setComposing(false); setLines(null); setComment('') } }} />
          <button type="button" className="sendbtn tip" data-tip="Levar ao chat (Enter)" aria-label="Levar ao chat" disabled={!comment.trim()} onClick={() => void sendComment()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button></div>
        {commentError && <p className="error">{commentError}</p>}</div>}
      {current?.truncated && <p className="wf-note">Arquivo acima de 1 MB: visualização parcial, edição desabilitada.</p>}
      {current && <footer className="wf-status"><b className={`wf-state ${current.binary || current.truncated ? '' : current.content !== current.saved ? 'dirty' : 'saved'}`}>{current.binary ? 'Binário' : current.truncated ? 'Somente leitura' : current.content !== current.saved ? 'Alterações sem salvar' : 'Salvo'}</b><span>{preferences.autosave ? 'Salvamento automático' : 'Ctrl+S para salvar'} · Tab {preferences.tabSize} · {current.content.split('\n').length} linhas</span></footer>}
      </div>
    </div>
  </section>
}
