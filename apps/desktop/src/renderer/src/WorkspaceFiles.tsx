import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IpcOutput } from '@agentboard/contracts'
import { Markdown } from './markdown'
import { Checkbox } from './Checkbox'
import { Select } from './Select'
import { plainError } from './NoticeDialog'
import { FolderGlyph, CloseIcon, CollapseIcon, ExpandIcon } from './icons'
import { WindowLayoutMenu } from './WindowLayoutMenu'
import { FileContextMenu, type FileMenuItem } from './FileContextMenu'
import { FileFind, fileMatches, type FindOptions } from './FileFind'
import { fileKind, FileTypeIcon, sourceTokens } from './FileAppearance'
import { terminal } from './terminalStore'
import { DiffLines } from './gitDiff'
import type { FileChange } from './changes'
import { DiffIcon } from './icons'

type Entry = IpcOutput<'workspace:list'>[number]
type Document = IpcOutput<'workspace:read'> & { saved: string; preview: boolean; error: string; diffView?: boolean }
type Preferences = { tree: boolean; treeSide: 'left' | 'right'; tabs: boolean; autosave: boolean; indent: boolean; wrap: boolean; guides: boolean; whitespace: boolean; beyond: boolean; tabSize: number }
const defaults: Preferences = { tree: true, treeSide: 'left', tabs: true, autosave: false, indent: true, wrap: true, guides: true, whitespace: false, beyond: false, tabSize: 2 }
const readPreferences = (): Preferences => { try { const saved = JSON.parse(localStorage.getItem('agentboard.filePreferences') ?? '{}'); const migrated = localStorage.getItem('agentboard.fileTreeLeftV2') === '1'; localStorage.setItem('agentboard.fileTreeLeftV2', '1'); return { ...defaults, ...saved, treeSide: migrated ? saved.treeSide ?? 'left' : 'left' } } catch { return defaults } }
const nameOf = (path: string): string => path.split(/[\\/]/).at(-1) ?? path
const isMarkdown = (path: string): boolean => /\.(md|mdx|markdown)$/i.test(path)
const isHtml = (path: string): boolean => /\.html?$/i.test(path)

function TreeFolder({ entry, context, selected, open, reveal, menu, depth = 0 }: { entry: Entry; context: { projectId: string; cardId: string | null }; selected?: string; open(path: string): void; reveal?: { path: string; at: number }; menu(entry: Entry, event: React.MouseEvent): void; depth?: number }): React.JSX.Element {
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
      <span className="wf-chevron">{entry.directory ? expanded ? '⌄' : '›' : ''}</span><FileTypeIcon path={entry.path} directory={entry.directory} /><span>{entry.name}</span>
    </button>
    {entry.directory && expanded && <div role="group">{error ? <p className="wf-note error">{error}</p> : !entries ? <p className="wf-note">Carregando…</p> : !entries.length ? <p className="wf-note">Pasta vazia</p> : entries.map((item) => <TreeFolder key={item.path} entry={item} context={context} selected={selected} open={open} reveal={reveal} menu={menu} depth={depth + 1} />)}</div>}
  </div>
}

/** Explorador do projeto/worktree com editor, visualização e uma janela exclusiva por arquivo. */
export function WorkspaceFiles({ projectId, cardId, initialPath, close, standalone = false, changes, startExpanded = false }: { projectId: string; cardId: string | null; initialPath?: string; close(): void; standalone?: boolean; changes?: FileChange[]; startExpanded?: boolean }): React.JSX.Element {
  const context = { projectId, cardId }
  const [roots, setRoots] = useState<IpcOutput<'workspace:roots'>>([]), [documents, setDocuments] = useState<Document[]>([]), [active, setActive] = useState(''), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [preferences, setPreferences] = useState(readPreferences), [query, setQuery] = useState(''), [results, setResults] = useState<IpcOutput<'workspace:search'>>(), [searching, setSearching] = useState(false)
  const [menu, setMenu] = useState<'settings' | null>(null), [expanded, setExpanded] = useState(startExpanded), [position, setPosition] = useState<'left' | 'right' | 'top' | 'bottom'>('left'), [find, setFind] = useState(false), [needle, setNeedle] = useState(''), [treeVisible, setTreeVisible] = useState(!standalone)
  const [tabMenu, setTabMenu] = useState<{ entry: Entry; x: number; y: number }>(), [reveal, setReveal] = useState<{ path: string; at: number }>(), [findOptions, setFindOptions] = useState<FindOptions>({ caseSensitive: false, wholeWord: false, regex: false }), [matchIndex, setMatchIndex] = useState(-1), [image, setImage] = useState('')
  const slashed = (value: string): string => value.replace(/\\/g, '/').toLowerCase()
  const changeFor = (path: string): FileChange | undefined => changes?.find((item) => slashed(path).endsWith(`/${slashed(item.path)}`))
  const changeTotals = useMemo(() => ({ added: changes?.reduce((sum, item) => sum + item.added, 0) ?? 0, removed: changes?.reduce((sum, item) => sum + item.removed, 0) ?? 0 }), [changes])
  const current = documents.find((item) => item.path === active), latest = useRef(documents), editor = useRef<HTMLTextAreaElement>(null), gutter = useRef<HTMLPreElement>(null), menuBox = useRef<HTMLDivElement>(null), searchField = useRef<HTMLInputElement>(null), loadingId = useRef(0), pending = useRef(new Set<string>())
  const [lineHeights, setLineHeights] = useState<number[]>([]), whitespace = useRef<HTMLPreElement>(null), guides = useRef<HTMLDivElement>(null), syntax = useRef<HTMLPreElement>(null), picks = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<[number, number] | null>(null), [composing, setComposing] = useState(false), [comment, setComment] = useState(''), [scrollTop, setScrollTop] = useState(0), pickDrag = useRef<number | null>(null), commentField = useRef<HTMLTextAreaElement>(null), [commentError, setCommentError] = useState('')
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
      setLineHeights(current.content.split('\n').map((line) => preferences.wrap ? Math.max(1, Math.ceil(ctx.measureText(line.replace(/\t/g, ' '.repeat(preferences.tabSize))).width / width)) * 21 : 21))
    }
    measure(); const observer = new ResizeObserver(measure); observer.observe(field); return () => observer.disconnect()
  }, [current?.content, current?.path, current?.preview, preferences.wrap, preferences.tabSize])
  latest.current = documents
  const change = (patch: Partial<Preferences>): void => setPreferences((value) => { const next = { ...value, ...patch }; localStorage.setItem('agentboard.filePreferences', JSON.stringify(next)); return next })
  const updateDocument = (path: string, patch: Partial<Document>): void => setDocuments((all) => all.map((item) => item.path === path ? { ...item, ...patch } : item))
  const save = useCallback(async (path: string): Promise<boolean> => {
    const file = latest.current.find((item) => item.path === path)
    if (!file || file.binary || file.truncated) return false
    if (file.content === file.saved) return true
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
      if (id !== loadingId.current) return
      setDocuments((all) => all.some((item) => item.path === file.path) ? all : [...all, { ...file, saved: file.content, preview: isMarkdown(file.path) || fileKind(file.path) === 'image', error: '', diffView: Boolean(changeFor(file.path)?.diff) }]); setActive(file.path)
    } catch (reason) { if (id === loadingId.current) setError(plainError(reason)) }
    finally { if (id === loadingId.current) setLoading(false) }
  }, [projectId, cardId])
  useEffect(() => { void window.agentboard.invoke('workspace:roots', context).then(setRoots).catch((reason) => setError(plainError(reason))) }, [projectId, cardId])
  useEffect(() => { if (initialPath) void open(initialPath) }, [initialPath, open])
  const absolute = (relative: string): string | undefined => { const root = roots[0]?.path; return root ? `${root.replace(/[\\/]+$/, '')}/${relative}` : undefined }
  const openChange = (item: FileChange): void => { const path = absolute(item.path); if (path) void open(path) }
  const firstChange = changes?.find((item) => !item.untracked) ?? changes?.[0]
  const autoOpened = useRef(false)
  useEffect(() => { if (autoOpened.current || !firstChange || !roots.length || initialPath) return; autoOpened.current = true; openChange(firstChange) }, [roots, firstChange])
  const openAllChanges = (): void => { (changes ?? []).slice(0, 20).forEach((item) => { const path = absolute(item.path); if (path) void open(path) }) }
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
        ...(document ? [{ label: 'Fechar arquivo', separator: true, action: () => closeTab(document) }] : [])
      ] : [])
    ]
  }
  const detach = async (): Promise<void> => {
    if (!current || !await save(current.path)) return
    try { await window.agentboard.invoke('windows:open', { kind: 'file', projectId, cardId: cardId ?? undefined, path: current.path, placement: 'new' }); setMenu(null) } catch (reason) { setError(plainError(reason)) }
  }
  const returnToMain = async (): Promise<void> => {
    if (!current || !await save(current.path)) return
    try { await window.agentboard.invoke('windows:return-file', { ...context, path: current.path }); window.close() } catch (reason) { setError(plainError(reason)) }
  }
  const pickLine = (index: number, event: React.MouseEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    if (event.shiftKey && lines) { setLines([lines[0], index]); return }
    pickDrag.current = index; setComposing(false); setLines([index, index])
  }
  const sendComment = async (): Promise<void> => {
    if (!current || !lines || !comment.trim()) return
    const from = Math.min(...lines), to = Math.max(...lines), code = current.content.split('\n').slice(from, to + 1).join('\n')
    const fence = '`'.repeat(Math.max(3, ...(code.match(/`+/g) ?? []).map((run) => run.length + 1))), language = /\.([A-Za-z0-9]+)$/.exec(current.path)?.[1] ?? ''
    const span = from === to ? `linha ${from + 1}` : `linhas ${from + 1}–${to + 1}`
    const text = `Comentário em \`${current.relative}\` (${span}${current.content !== current.saved ? ', texto atual do editor, com alterações ainda não salvas' : ''}):\n\n${fence}${language}\n${code}\n${fence}\n\n${comment.trim()}`
    try { setCommentError(''); await window.agentboard.invoke('workspace:comment', { ...context, text }); setLines(null); setComposing(false); setComment(''); if (!standalone) close() } catch (reason) { setCommentError(plainError(reason)) }
  }
  const toggleFind = (): void => { if (find) setFind(false); else showFind() }
  const fill = (): void => { if (standalone) void window.agentboard.invoke('windows:place', { placement: expanded ? 'new' : 'fill' }); setExpanded(!expanded); setMenu(null) }
  const keyDown = (event: React.KeyboardEvent): void => {
    if (event.ctrlKey && event.key.toLowerCase() === 's') { event.preventDefault(); if (current) void save(current.path) }
    if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); showFind() }
    if (event.key === 'Escape') { setMenu(null); setFind(false) }
  }
  const tree = treeVisible && preferences.tree
  return <section className={`workspacefiles ${standalone ? 'standalone' : ''} ${expanded ? 'expanded' : position}`} aria-label="Arquivos do projeto" onKeyDown={keyDown}>
    <header className="wf-header"><FolderGlyph /><b>{standalone ? nameOf(active || initialPath || 'Arquivo') : changes ? 'Alterações' : 'Arquivos'}</b>{changes ? <span className="wf-context wf-totals" title={roots.map((root) => root.path).join('\n')}><span className="ch-add">+{changeTotals.added}</span> <span className="ch-del">−{changeTotals.removed}</span> · {changes.length} {changes.length === 1 ? 'arquivo' : 'arquivos'}</span> : <span className="wf-context" title={roots.map((root) => root.path).join('\n')}>{cardId ? 'Worktree do card' : 'Projeto'}</span>}<div className="wf-actions">
      <button type="button" className="ibtn" title="Pesquisar no arquivo (Ctrl+F)" aria-label="Pesquisar no arquivo" onClick={toggleFind}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg></button>
      <button type="button" className="ibtn" title="Mostrar árvore de arquivos" aria-label="Mostrar árvore de arquivos" aria-pressed={tree} onClick={() => { setTreeVisible(true); change({ tree: !tree }) }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 4h2m3 0h7M4 10h2m3 0h7M4 16h2m3 0h7" /></svg></button>
      {standalone && <button type="button" className="ibtn" title="Voltar à janela principal" aria-label="Voltar à janela principal" onClick={() => void returnToMain()}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10v10H5zM8 3H3v5m0-5 7 7" /></svg></button>}
      {changes && <button type="button" className="ibtn tip" data-tip="Abrir todos os arquivos alterados em abas" aria-label="Abrir todos os arquivos alterados em abas" disabled={!changes.length} onClick={openAllChanges}><DiffIcon /></button>}
      <div className="wf-menus" ref={menuBox}>
        <button type="button" className="ibtn" aria-label="Configurações do arquivo" aria-expanded={menu === 'settings'} onClick={() => setMenu(menu === 'settings' ? null : 'settings')}>···</button>
        {menu === 'settings' && <div className="popmenu wf-settings" role="dialog" aria-label="Configurações do editor">
          {([['tree', 'Mostrar árvore de arquivos'], ['tabs', 'Abas de visualização'], ['autosave', 'Salvamento automático'], ['indent', 'Tab insere recuo'], ['wrap', 'Quebra de linha'], ['guides', 'Guias de recuo'], ['whitespace', 'Mostrar espaços em branco'], ['beyond', 'Rolar além do fim']] as const).map(([key, label]) => <label key={key}><Checkbox checked={preferences[key]} onChange={(value) => { change({ [key]: value }); if (key === 'tree') setTreeVisible(true) }} />{label}</label>)}
          <label>Posição da árvore<Select label="Posição da árvore" value={preferences.treeSide} options={[{ value: 'left', label: 'Esquerda' }, { value: 'right', label: 'Direita' }]} onChange={(value) => change({ treeSide: value as Preferences['treeSide'] })} /></label>
          <label>Tamanho da tabulação<Select label="Tamanho da tabulação" value={String(preferences.tabSize)} options={[2, 4, 8].map((value) => ({ value: String(value), label: String(value) }))} onChange={(value) => change({ tabSize: Number(value) })} /></label>
        </div>}
      </div><WindowLayoutMenu move={(value) => { if (standalone) void window.agentboard.invoke('windows:place', { placement: value }); else { setPosition(value); setExpanded(false) } }} fill={() => { if (!expanded) fill() }} center={() => { if (standalone) void window.agentboard.invoke('windows:place', { placement: 'new' }); else { setPosition('left'); setExpanded(false) } }} detach={!standalone ? () => void detach() : undefined} detachDisabled={!current} /><button type="button" className="ibtn" aria-label={expanded ? 'Restaurar arquivos' : 'Expandir arquivos'} title={expanded ? 'Restaurar arquivos' : 'Expandir arquivos'} onClick={fill}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button><button type="button" className="ibtn" aria-label="Fechar arquivos" onClick={leave}><CloseIcon /></button>
    </div></header>
    {tabMenu && <FileContextMenu x={tabMenu.x} y={tabMenu.y} items={fileMenu(tabMenu.entry)} close={() => setTabMenu(undefined)} find={() => showFind(tabMenu.entry.path)} />}
    {preferences.tabs && documents.length > 0 && <div className="wf-tabs" role="tablist" aria-label="Arquivos abertos">{documents.map((file) => <div key={file.path} className={`wf-tab ${file.path === active ? 'on' : ''}`} onContextMenu={(event) => showContext({ path: file.path, name: nameOf(file.path), directory: false }, event)}><button type="button" role="tab" aria-selected={file.path === active} title={file.path} onClick={() => setActive(file.path)}><FileTypeIcon path={file.path} />{nameOf(file.path)}{file.saved !== file.content ? ' •' : ''}</button><button type="button" aria-label={`Fechar ${nameOf(file.path)}`} onClick={() => closeTab(file)}>×</button></div>)}</div>}
    <div className={`wf-body ${tree ? `tree-${preferences.treeSide}` : ''}`}>
      {tree && <nav className="wf-tree" aria-label="Árvore de arquivos"><input className="in" aria-label={changes ? 'Pesquisar arquivos alterados' : 'Pesquisar arquivos'} placeholder={changes ? 'Pesquisar arquivos alterados…' : 'Pesquisar arquivos…'} value={query} onChange={(event) => setQuery(event.target.value)} />{searching && <p className="wf-note">Pesquisando…</p>}{changes ? <div role="list" aria-label="Arquivos alterados">{changes.filter((item) => item.path.toLowerCase().includes(query.trim().toLowerCase())).map((item) => { const slash = item.path.lastIndexOf('/'), name = item.path.slice(slash + 1), dir = slash > 0 ? item.path.slice(0, slash) : '', path = absolute(item.path); return <button key={item.path} type="button" role="listitem" className={`wf-result wf-changed ${path && slashed(active) === slashed(path) ? 'on' : ''}`} title={item.path} onContextMenu={(event) => { if (path) showContext({ path, name, directory: false }, event) }} onClick={() => openChange(item)}><b><FileTypeIcon path={item.path} />{name}{item.untracked ? <span className="ch-new">novo</span> : <span className="wf-nums"><span className="ch-add">+{item.added}</span><span className="ch-del">−{item.removed}</span></span>}</b>{dir && <small>{dir}</small>}</button> })}{!changes.length && <p className="wf-note">Nenhum arquivo alterado.</p>}</div> : results ? <div>{results.paths.map((path) => <button key={path} type="button" className={`wf-result ${active === path ? 'on' : ''}`} title={path} onContextMenu={(event) => showContext({ path, name: nameOf(path), directory: false }, event)} onClick={() => void open(path)}><b><FileTypeIcon path={path} />{nameOf(path)}</b><small>{path}</small></button>)}{!results.paths.length && !searching && <p className="wf-note">Nenhum arquivo encontrado.</p>}{results.limited && <p className="wf-note">Busca limitada; refine o nome. Pastas de dependências e build ficam fora da busca.</p>}</div> : <div role="tree">{roots.map((root) => <TreeFolder key={root.path} entry={{ ...root, directory: true }} context={context} selected={active} open={(path) => void open(path)} reveal={reveal} menu={showContext} />)}</div>}</nav>}
      <div className="wf-document">{current && <div className="wf-filebar"><span title={current.path}>{current.relative}</span>{!current.binary && !current.truncated && <>
        {(isMarkdown(current.path) || isHtml(current.path) || fileKind(current.path) === 'image') && <button type="button" className="wf-iconchip" aria-label={current.preview ? 'Ver código fonte' : 'Visualizar'} title={current.preview ? 'Ver código fonte' : 'Visualizar'} onClick={() => updateDocument(current.path, { preview: !current.preview })}><svg viewBox="0 0 20 20" aria-hidden="true">{current.preview ? <path d="m7 5-5 5 5 5m6-10 5 5-5 5" /> : <><path d="M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z" /><circle cx="10" cy="10" r="2.5" /></>}</svg></button>}
        {changeFor(current.path)?.diff && <button type="button" className={`wf-iconchip ${current.diffView ? 'on' : ''}`} aria-label={current.diffView ? 'Editar o arquivo' : 'Ver as alterações'} title={current.diffView ? 'Editar o arquivo' : 'Ver as alterações (diff)'} onClick={() => updateDocument(current.path, { diffView: !current.diffView })}><DiffIcon /></button>}
        <button type="button" className="wf-iconchip" aria-label="Salvar arquivo" title="Salvar (Ctrl+S)" disabled={current.saved === current.content} onClick={() => void save(current.path)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 2h11l3 3v13H3zM6 2v6h7V2M6 18v-7h8v7" /></svg></button></>}
        <button type="button" className="wf-iconchip" aria-label="Recarregar arquivo" title="Recarregar arquivo" onClick={() => void reload(current.path)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a7 7 0 1 0 1 6M16 2v5h-5" /></svg></button>
      </div>}
      {find && <FileFind input={searchField} query={needle} setQuery={setNeedle} options={findOptions} setOptions={setFindOptions} count={search.matches.length} index={matchIndex} error={search.error} previous={() => searchInFile(-1)} next={() => searchInFile(1)} close={() => setFind(false)} />}
      {(error || current?.error) && <div className="wf-error" role="alert">{error || current?.error}</div>}{loading && <p className="wf-note">Abrindo…</p>}
      {current?.diffView && changeFor(current.path)?.diff ? <div className="wf-diffview"><DiffLines text={changeFor(current.path)!.diff} review={{ path: current.relative, send: async (prompt) => { try { await window.agentboard.invoke('workspace:comment', { ...context, text: prompt }); if (!standalone) close(); return true } catch (reason) { setError(plainError(reason)); return false } } }} /></div> : !current ? <div className="wf-empty"><FolderGlyph /><p>{changes ? 'Escolha um arquivo alterado.' : 'Escolha um arquivo na árvore.'}</p>{!tree && <button type="button" className="mini secondary" onClick={() => { change({ tree: true }); setTreeVisible(true) }}>Mostrar arquivos</button>}</div> : fileKind(current.path) === 'image' && (current.binary || current.preview) ? <div className="wf-imagepreview">{image ? <img src={image} alt={nameOf(current.path)} /> : <p className="wf-note">{error || 'Carregando prévia…'}</p>}</div> : current.binary ? <p className="wf-note">Este formato não tem prévia e não pode ser editado como texto.</p> : current.preview ? isMarkdown(current.path) ? <div className="md wf-preview"><Markdown source={current.content} /></div> : <iframe className="wf-html" title={`Visualização de ${nameOf(current.path)}`} sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">${current.content}`} /> : <div className={`wf-code ${preferences.wrap ? 'wrap' : ''} ${preferences.guides ? 'guides' : ''}`} style={{ '--wf-tab': preferences.tabSize, '--wf-bottom': preferences.beyond ? '50vh' : '16px' } as React.CSSProperties}>
        <pre className="wf-gutter" ref={gutter}>{current.content.split('\n').map((_, index) => <span key={index} className={lines && index >= Math.min(...lines) && index <= Math.max(...lines) ? 'picked' : ''} title="Clique ou arraste para escolher linhas" style={{ display: 'block', height: lineHeights[index] ?? 21, cursor: 'pointer' }} onMouseDown={(event) => pickLine(index, event)} onMouseEnter={() => { if (pickDrag.current !== null) setLines([pickDrag.current, index]) }}>{index + 1}</span>)}</pre>
        <div className={`wf-editarea ${preferences.whitespace ? 'show-whitespace' : ''}`}>{lines && <div className="wf-linepicks" ref={picks} aria-hidden="true">{current.content.split('\n').map((_, index) => <div key={index} className={index >= Math.min(...lines) && index <= Math.max(...lines) ? 'on' : ''} style={{ height: lineHeights[index] ?? 21 }} />)}</div>}{lines && !composing && !current.truncated && <button type="button" className="gdl-chatbtn tip" data-tip={`Comentar ${Math.abs(lines[1] - lines[0]) + 1} linha${lines[0] === lines[1] ? '' : 's'}`} aria-label="Comentar as linhas selecionadas" style={{ top: Math.max(4, 12 + lineHeights.slice(0, Math.min(...lines)).reduce((sum, height) => sum + height, 0) - scrollTop) }} onClick={() => setComposing(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg></button>}<pre ref={syntax} className={`wf-syntax ${preferences.wrap ? 'wrap' : ''}`} aria-hidden="true">{tokens.map((token, index) => token.kind ? <span key={index} className={`tok-${token.kind}`}>{token.text}</span> : token.text)}{'\n'}</pre><textarea ref={editor} aria-label={`Código fonte de ${nameOf(current.path)}`} spellCheck={false} readOnly={current.truncated} wrap={preferences.wrap ? 'soft' : 'off'} value={current.content} onChange={(event) => updateDocument(current.path, { content: event.target.value })} onScroll={(event) => { for (const element of [gutter.current, whitespace.current, guides.current, syntax.current, picks.current]) if (element) { element.scrollTop = event.currentTarget.scrollTop; element.scrollLeft = event.currentTarget.scrollLeft }; setScrollTop(event.currentTarget.scrollTop) }} onKeyDown={(event) => {
          if (event.key === 'Tab' && preferences.indent) { event.preventDefault(); const field = event.currentTarget, start = field.selectionStart, end = field.selectionEnd, spaces = ' '.repeat(preferences.tabSize); updateDocument(current.path, { content: current.content.slice(0, start) + spaces + current.content.slice(end) }); window.setTimeout(() => { field.selectionStart = field.selectionEnd = start + spaces.length }, 0) }
        }} />{preferences.guides && <div className="wf-indentguides" ref={guides} aria-hidden="true">{current.content.split('\n').map((line, index) => <div key={index} style={{ height: lineHeights[index] ?? 21 }}>{Array.from({ length: Math.floor((/^\s*/.exec(line)?.[0].replace(/\t/g, ' '.repeat(preferences.tabSize)).length ?? 0) / preferences.tabSize) }, (_, depth) => <i key={depth} style={{ width: `${preferences.tabSize}ch` }} />)}</div>)}</div>}{preferences.whitespace && <pre ref={whitespace} className="wf-whitespace" aria-hidden="true">{current.content.split(/([ \t]+)/).map((part, index) => index % 2 ? <i key={index}>{part.replace(/ /g, '·').replace(/\t/g, '→' + ' '.repeat(preferences.tabSize - 1))}</i> : part)}</pre>}</div>
      </div>}
      {lines && composing && current && <div className="gdl-compose" role="group" aria-label="Comentar as linhas selecionadas">
        <div className="gdl-askhead"><span>{Math.abs(lines[1] - lines[0]) + 1} linha{lines[0] === lines[1] ? '' : 's'} selecionada{lines[0] === lines[1] ? '' : 's'} em {nameOf(current.path)}</span><button type="button" className="ghost" onClick={() => { setComposing(false); setLines(null); setComment('') }}>Cancelar</button></div>
        <div className="cbox"><textarea ref={commentField} value={comment} rows={1} placeholder="O que fazer nessas linhas? O comentário vai para o chat com o trecho" aria-label="Comentário sobre as linhas" onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendComment() } else if (event.key === 'Escape') { event.stopPropagation(); setComposing(false); setLines(null); setComment('') } }} />
          <button type="button" className="sendbtn tip" data-tip="Levar ao chat (Enter)" aria-label="Levar ao chat" disabled={!comment.trim()} onClick={() => void sendComment()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button></div>
        {commentError && <p className="error">{commentError}</p>}</div>}
      {current?.truncated && <p className="wf-note">Arquivo acima de 1 MB: visualização parcial, edição desabilitada.</p>}
      {current && <footer className="wf-status"><b className={`wf-state ${current.binary || current.truncated ? '' : current.content !== current.saved ? 'dirty' : 'saved'}`}>{current.binary ? 'Binário' : current.truncated ? 'Somente leitura' : current.content !== current.saved ? 'Alterações sem salvar' : 'Salvo'}</b><span>{preferences.autosave ? 'Salvamento automático' : 'Ctrl+S para salvar'} · Tab {preferences.tabSize} · {current.content.split('\n').length} linhas</span></footer>}
      </div>
    </div>
  </section>
}
