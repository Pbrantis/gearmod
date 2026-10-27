import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { findNext, findPrevious, replaceAll, replaceNext } from '@codemirror/search'
import { Markdown } from '../markdown'
import { markdownImages } from './markdownImages'
import { headingTrail, markdownHeadings, type Heading } from './markdownOutline'
import { DiffIcon } from '../icons'
import { FileFind, GoToLine, fileMatches, type FindOptions } from '../FileFind'
import { fileKind } from '../FileAppearance'
import { plainError } from '../NoticeDialog'
import { ConfirmDialog } from '../ConfirmDialog'
import type { FileChange } from '../changes'
import { CodeEditor } from './CodeEditor'
import { DiffEditor } from './DiffEditor'
import { ConflictCompare } from './ConflictCompare'
import { GitContextChip } from './GitContextChip'
import { applyFind, hiddenSearch } from './search'
import { linePicker, setPicked } from './picks'
import { editorKeymap } from './keymap'
import { languageName } from './languages'
import { detectIndent, normalizeEol, parseGoto } from './position'
import { cursorInfo, isHtml, isMarkdown, nameOf, readViewState, slashed, writeViewState, type Document } from './documents'
import type { Preferences } from './preferences'

export type PaneCommand = { type: 'find' | 'replace' | 'goto' | 'toggle-find'; at: number }
export interface FilePaneProps {
  doc: Document; mode: 'full' | 'focused'; context: { projectId: string; cardId: string | null }
  preferences: Preferences; changePreferences(patch: Partial<Preferences>): void
  change?: FileChange | undefined; root?: { path: string; branch?: string | null; worktree?: boolean } | undefined
  commentCardId: string | null; commentTarget: string
  update(path: string, patch: Partial<Document>): void; save(path: string): Promise<boolean>; reload(path: string): void
  afterComment(): void; error: string; loading: boolean; setError(value: string): void
  command?: PaneCommand | undefined; jump?: { line: number; column: number; length?: number } | undefined; onJumped?(): void
  /** Só no modo focado: nome do repositório mostrado antes do caminho e botões extras no fim do cabeçalho. */
  repoName?: string | undefined; headerEnd?: React.ReactNode
  /** Fechar a aba (faixa de arquivo apagado) e recriar o arquivo apagado com o texto atual; sem `restore` o botão não aparece. */
  closeDocument?(): void; restore?(path: string): void
  /** O painel preenche com uma função que devolve o texto selecionado no editor (para semear a busca no projeto). */
  selectionText?: React.MutableRefObject<(() => string) | null>
  /** Raízes do projeto: uma imagem solta que já está nelas vira só um link relativo. */
  roots?: Array<{ path: string }>
}

/**
 * Área de um arquivo aberto: cabeçalho de ações, localizar/substituir, ir para linha, editor, diff, prévia, comentário de linhas e barra de status.
 * `full` é o modo Arquivos (dentro de uma aba); `focused` é o painel ao lado do chat, que abre no diff e só edita depois de "Editar".
 */
export function FilePane({ doc, mode, context, preferences, changePreferences, change, root, commentCardId, commentTarget, update, save, reload, afterComment, error, loading, setError, command, jump, onJumped, repoName, headerEnd, closeDocument, restore, selectionText, roots }: FilePaneProps): React.JSX.Element {
  const focused = mode === 'focused'
  const view = useRef<EditorView | null>(null), codeBox = useRef<HTMLDivElement>(null), statusBox = useRef<HTMLSpanElement>(null), searchField = useRef<HTMLInputElement>(null), commentField = useRef<HTMLTextAreaElement>(null), pickDrag = useRef<number | null>(null)
  const [find, setFind] = useState(false), [needle, setNeedle] = useState(''), [findOptions, setFindOptions] = useState<FindOptions>({ caseSensitive: false, wholeWord: false, regex: false }), [matchIndex, setMatchIndex] = useState(-1), [replaceOpen, setReplaceOpen] = useState(false), [replacement, setReplacement] = useState('')
  const [goto, setGoto] = useState(false), [cursor, setCursor] = useState({ line: 1, column: 1, selected: 0, ranges: 1 }), [indentMenu, setIndentMenu] = useState(false), [image, setImage] = useState(''), [edit, setEdit] = useState(false), [discarding, setDiscarding] = useState(false), [outlineOpen, setOutlineOpen] = useState(false), [conflictView, setConflictView] = useState<{ ours: string; theirs: string; oursLabel: string; theirsLabel: string }>()
  const previewRef = useRef<HTMLDivElement>(null), outlineBox = useRef<HTMLSpanElement>(null)
  const [lines, setLines] = useState<[number, number] | null>(null), [composing, setComposing] = useState(false), [comment, setComment] = useState(''), [buttonTop, setButtonTop] = useState(4), [commentError, setCommentError] = useState('')
  const linesRef = useRef(lines), composingRef = useRef(composing); linesRef.current = lines; composingRef.current = composing
  const search = useMemo(() => fileMatches(doc.content, needle, findOptions), [doc.content, needle, findOptions])
  const indent = useMemo(() => detectIndent(doc.saved), [doc.path, doc.saved])
  const editorOptions = useMemo(() => ({ tabs: indent.kind === 'tab', wrap: preferences.wrap, tabSize: preferences.tabSize, indentWithTab: preferences.indent, whitespace: preferences.whitespace, guides: preferences.guides, scrollPastEnd: preferences.beyond }), [indent.kind, preferences.wrap, preferences.tabSize, preferences.indent, preferences.whitespace, preferences.guides, preferences.beyond])
  const readOnly = doc.truncated || Boolean(doc.locked) || (focused && !edit), canDiff = Boolean(change?.diff)
  const liveView = (): EditorView | null => view.current?.dom.isConnected ? view.current : null
  if (selectionText) selectionText.current = () => { const editor = view.current?.dom.isConnected ? view.current : null; if (!editor) return ''; const range = editor.state.selection.main; return range.empty ? '' : editor.state.sliceDoc(range.from, Math.min(range.to, range.from + 200)) }
  const showFind = (withReplace?: boolean): void => { if (withReplace !== undefined) setReplaceOpen(withReplace); else if (!find) setReplaceOpen(false); setFind(true); window.setTimeout(() => { searchField.current?.focus(); searchField.current?.select() }, 0) }
  const showGoto = (): void => { if (doc.binary) return; if (doc.preview) update(doc.path, { preview: false }); setGoto(true) }
  const gotoLine = (line: number, column = 1, length = 0): boolean => {
    const editor = liveView(); if (!editor) return false
    const text = editor.state.doc, target = text.line(Math.min(Math.max(1, line), text.lines)), at = target.from + Math.min(column - 1, target.length)
    editor.dispatch({ selection: { anchor: at, head: Math.min(at + length, target.to) }, effects: EditorView.scrollIntoView(at, { y: 'center' }) }); editor.focus(); return true
  }
  const searchInFile = (direction = 1): void => {
    if (!search.matches.length) return
    const run = (): void => { const editor = liveView(); if (!editor) return; (direction > 0 ? findNext : findPrevious)(editor); const at = editor.state.selection.main.from; setMatchIndex(search.matches.findIndex(([start]) => start === at)) }
    if (doc.preview) { update(doc.path, { preview: false }); window.setTimeout(run, 80) } else run()
  }
  const replaceWith = (all: boolean): void => { const editor = liveView(); if (editor && !readOnly) (all ? replaceAll : replaceNext)(editor) }
  const pickLine = (index: number, extend: boolean): void => {
    if (extend && linesRef.current) { setLines([linesRef.current[0], index]); return }
    pickDrag.current = index; setComposing(false); setLines([index, index])
  }
  /** O botão de comentar acompanha a última linha escolhida, também ao rolar. */
  const placeButton = (): void => { const editor = liveView(), box = codeBox.current, picked = linesRef.current; if (!editor || !box || !picked) return; const line = editor.state.doc.line(Math.min(Math.max(...picked) + 1, editor.state.doc.lines)); setButtonTop(Math.max(4, Math.round(editor.documentTop + editor.lineBlockAt(line.from).bottom - box.getBoundingClientRect().top - 14))) }
  const actions = useRef({ save: (): void => undefined, find: (): void => undefined, replace: (): void => undefined, goto: (): void => undefined, place: (): void => undefined })
  actions.current = { save: () => { void save(doc.path) }, find: () => showFind(), replace: () => showFind(true), goto: showGoto, place: placeButton }
  const extensions = useMemo<Extension[]>(() => [
    hiddenSearch,
    linePicker((index, extend) => pickLine(index, extend), (index) => { if (pickDrag.current !== null) setLines([pickDrag.current, index]) }, () => { pickDrag.current = null }),
    EditorView.updateListener.of((updated) => {
      if (updated.selectionSet || updated.docChanged) setCursor(cursorInfo(updated.state))
      if (!updated.selectionSet) return
      const { from, to } = updated.state.selection.main, text = updated.state.doc
      if (from === to) { if (!composingRef.current) setLines(null); return }
      setComposing(false); setLines([text.lineAt(from).number - 1, text.lineAt(text.sliceString(to - 1, to) === '\n' ? to - 1 : to).number - 1])
    }),
    EditorView.domEventHandlers({ scroll: () => { actions.current.place() } }),
    editorKeymap({ save: () => actions.current.save(), find: () => actions.current.find(), replace: () => actions.current.replace(), goto: () => actions.current.goto() })
  ], [])
  const markdown = isMarkdown(doc.path)
  const headings = useMemo(() => markdown ? markdownHeadings(doc.content) : [], [markdown, doc.content])
  const trail = useMemo(() => markdown && !doc.preview ? headingTrail(headings, cursor.line) : [], [markdown, doc.preview, headings, cursor.line])
  const goHeading = (heading: Heading): void => { setOutlineOpen(false); if (doc.preview) previewRef.current?.querySelector(`[data-line="${heading.line - 1}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); else gotoLine(heading.line) }
  /** Colar ou soltar imagem só no Markdown editável: grava em `imagens/` e insere o link. */
  const editorExtensions = useMemo<Extension[]>(() => markdown && !readOnly ? [...extensions, markdownImages({
    markdownPath: doc.path, fail: (message) => setError(message), droppedPath: (file) => { try { return window.agentboard.getDroppedFilePath(file) } catch { return '' } },
    inProject: (path) => (roots ?? []).some((root) => slashed(path).startsWith(`${slashed(root.path).replace(/\/$/, '')}/`)),
    save: (data, mime) => window.agentboard.invoke('workspace:save-image', { ...context, markdownPath: doc.path, data, mime })
  })] : extensions, [markdown, readOnly, extensions, doc.path, roots, context.projectId, context.cardId])
  useEffect(() => {
    if (!outlineOpen) return
    const away = (event: PointerEvent): void => { if (!outlineBox.current?.contains(event.target as Node)) setOutlineOpen(false) }
    document.addEventListener('pointerdown', away); return () => document.removeEventListener('pointerdown', away)
  }, [outlineOpen])
  useEffect(() => { liveView()?.dispatch({ effects: setPicked.of(lines) }); placeButton() }, [lines, doc.path])
  useEffect(() => { const editor = liveView(); if (editor) applyFind(editor, find && !doc.preview, { search: needle, caseSensitive: findOptions.caseSensitive, regexp: findOptions.regex, wholeWord: findOptions.wholeWord, replace: replacement }) }, [find, needle, findOptions, replacement, doc.path, doc.preview])
  useEffect(() => { setMatchIndex(-1) }, [needle, findOptions, doc.path])
  useEffect(() => { setLines(null); setComposing(false); setComment(''); setCommentError(''); setGoto(false); setEdit(false); setConflictView(undefined) }, [doc.path])
  useEffect(() => { const up = (): void => { pickDrag.current = null }; document.addEventListener('mouseup', up); return () => document.removeEventListener('mouseup', up) }, [])
  useEffect(() => { if (composing) commentField.current?.focus() }, [composing])
  useEffect(() => { setImage(''); if (fileKind(doc.path) !== 'image') return; let alive = true; void window.agentboard.invoke('workspace:image', { ...context, path: doc.path }).then((url) => { if (alive) setImage(url) }).catch((reason) => { if (alive) setError(plainError(reason)) }); return () => { alive = false } }, [doc.path])
  useEffect(() => { if (!command) return; if (command.type === 'find') showFind(); else if (command.type === 'replace') showFind(true); else if (command.type === 'goto') showGoto(); else if (find) setFind(false); else showFind() }, [command?.at])
  useEffect(() => {
    if (!jump || doc.preview) return
    if (gotoLine(jump.line, jump.column, jump.length)) onJumped?.()
  }, [jump, doc.path, doc.preview, loading])
  useEffect(() => {
    if (!indentMenu) return
    const away = (event: PointerEvent): void => { if (!statusBox.current?.contains(event.target as Node)) setIndentMenu(false) }
    document.addEventListener('pointerdown', away); return () => document.removeEventListener('pointerdown', away)
  }, [indentMenu])
  const sendComment = async (): Promise<void> => {
    if (!lines || !comment.trim()) return
    const from = Math.min(...lines), to = Math.max(...lines), code = doc.content.split('\n').slice(from, to + 1).join('\n')
    const fence = '`'.repeat(Math.max(3, ...(code.match(/`+/g) ?? []).map((run) => run.length + 1))), language = /\.([A-Za-z0-9]+)$/.exec(doc.path)?.[1] ?? ''
    const span = from === to ? `linha ${from + 1}` : `linhas ${from + 1}–${to + 1}`
    const text = `Comentário em \`${doc.relative}\` (${span}${doc.content !== doc.saved ? ', texto atual do editor, com alterações ainda não salvas' : ''}):\n\n${fence}${language}\n${code}\n${fence}\n\n${comment.trim()}`
    try { setCommentError(''); await window.agentboard.invoke('workspace:comment', { ...context, cardId: commentCardId, text }); setLines(null); setComposing(false); setComment(''); afterComment() } catch (reason) { setCommentError(plainError(reason)) }
  }
  const keyDown = (event: React.KeyboardEvent): void => {
    if (!event.ctrlKey || event.shiftKey) return
    const key = event.key.toLowerCase(), stop = (): void => { event.preventDefault(); event.stopPropagation() }
    if (key === 's') { stop(); void save(doc.path) } else if (key === 'f') { stop(); showFind() } else if (key === 'h' && !doc.binary) { stop(); showFind(true) } else if (key === 'g' && !doc.binary) { stop(); showGoto() }
  }
  const escape = (event: React.KeyboardEvent): void => { if (event.key === 'Escape' && (find || goto)) { event.stopPropagation(); setFind(false); setGoto(false) } }
  const dirty = doc.content !== doc.saved, previewable = isMarkdown(doc.path) || isHtml(doc.path) || fileKind(doc.path) === 'image'
  const reviewTarget = { path: doc.relative, send: async (prompt: string): Promise<boolean> => { try { await window.agentboard.invoke('workspace:comment', { ...context, cardId: commentCardId, text: prompt }); afterComment(); return true } catch (reason) { setError(plainError(reason)); return false } } }
  const actionsRow = <>
    {!doc.binary && !doc.truncated && <>
      {markdown && headings.length > 0 && <span className="wf-outlinewrap" ref={outlineBox}><button type="button" className="wf-iconchip" aria-label="Sumário" aria-expanded={outlineOpen} title="Sumário" onClick={() => setOutlineOpen(!outlineOpen)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M7 10h9M10 15h6" /></svg></button>{outlineOpen && <div className="popmenu wf-outline" role="menu" aria-label="Sumário">{headings.map((heading) => <button key={heading.line} type="button" role="menuitem" style={{ paddingLeft: 8 + (heading.level - 1) * 12 }} onClick={() => goHeading(heading)}>{heading.text}</button>)}</div>}</span>}
      {previewable && <button type="button" className="wf-iconchip" aria-label={doc.preview ? 'Ver código fonte' : 'Visualizar'} title={doc.preview ? 'Ver código fonte' : 'Visualizar'} onClick={() => update(doc.path, { preview: !doc.preview })}><svg viewBox="0 0 20 20" aria-hidden="true">{doc.preview ? <path d="m7 5-5 5 5 5m6-10 5 5-5 5" /> : <><path d="M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z" /><circle cx="10" cy="10" r="2.5" /></>}</svg></button>}
      {!focused && doc.diffView && canDiff && <button type="button" className="wf-iconchip" aria-label={preferences.diffLayout === 'split' ? 'Mostrar em uma coluna' : 'Mostrar lado a lado'} title={preferences.diffLayout === 'split' ? 'Uma coluna' : 'Lado a lado'} onClick={() => changePreferences({ diffLayout: preferences.diffLayout === 'split' ? 'unified' : 'split' })}><svg viewBox="0 0 20 20" aria-hidden="true">{preferences.diffLayout === 'split' ? <path d="M3 4h14v12H3zM3 8h14" /> : <path d="M3 4h14v12H3zM10 4v12" />}</svg></button>}
      {canDiff && <button type="button" className={`wf-iconchip ${doc.diffView ? 'on' : ''}`} aria-label={doc.diffView ? (focused ? 'Ver o código' : 'Editar o arquivo') : 'Ver as alterações'} title={doc.diffView ? (focused ? 'Ver o código' : 'Editar o arquivo') : 'Ver as alterações (diff)'} onClick={() => update(doc.path, { diffView: !doc.diffView })}><DiffIcon /></button>}
      {focused && !doc.locked && <button type="button" className={`wf-iconchip ${edit ? 'on' : ''}`} aria-pressed={edit} aria-label={edit ? 'Voltar a somente leitura' : 'Editar o arquivo'} title={edit ? 'Editando: clique para voltar a somente leitura' : 'Editar o arquivo'} onClick={() => { setEdit(!edit); if (!edit && !doc.preview) window.setTimeout(() => liveView()?.focus(), 0) }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m3 17 1-4 9-9 3 3-9 9zM12 5l3 3" /></svg></button>}
      {dirty && !doc.compare && <button type="button" className="wf-iconchip" aria-label="Comparar com o salvo" title="Comparar com o salvo" onClick={() => update(doc.path, { compare: { before: doc.saved, title: 'Alterações não salvas', split: false } })}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v14h4M13 3h4v14h-4M10 2v16" /></svg></button>}
      <button type="button" className="wf-iconchip" aria-label="Salvar arquivo" title="Salvar (Ctrl+S)" disabled={!dirty} onClick={() => void save(doc.path)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 2h11l3 3v13H3zM6 2v6h7V2M6 18v-7h8v7" /></svg></button></>}
    <button type="button" className="wf-iconchip" aria-label="Recarregar arquivo" title="Recarregar arquivo" onClick={() => reload(doc.path)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 7a7 7 0 1 0 1 6M16 2v5h-5" /></svg></button>
    {focused && !doc.binary && <button type="button" className="wf-iconchip" aria-label="Pesquisar no arquivo" title="Pesquisar no arquivo (Ctrl+F)" onClick={() => find ? setFind(false) : showFind()}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg></button>}
  </>
  const parts = doc.relative.split('/')
  return <div className={`wf-document ${focused ? 'focused' : ''}`} onKeyDown={keyDown} onKeyDownCapture={escape}>
    {focused
      ? <div className="fv-head"><div className="fv-path" title={doc.path}>{repoName && <><span className="fv-repo">{repoName}</span><span className="fv-sep">›</span></>}{parts.map((part, index) => <React.Fragment key={index}>{index > 0 && <span className="fv-sep">›</span>}<span className={index === parts.length - 1 ? 'fv-name' : ''}>{part}</span></React.Fragment>)}{trail.map((heading) => <React.Fragment key={heading.line}><span className="fv-sep">›</span><button type="button" className="wf-crumb" title="Abrir o sumário" onClick={() => setOutlineOpen(true)}>{heading.text}</button></React.Fragment>)}</div>{dirty && <small className="fv-size" title="Alterações sem salvar">•</small>}{actionsRow}{headerEnd}</div>
      : <div className="wf-filebar"><span title={doc.path}>{doc.relative}{trail.map((heading) => <React.Fragment key={heading.line}> › <button type="button" className="wf-crumb" title="Abrir o sumário" onClick={() => setOutlineOpen(true)}>{heading.text}</button></React.Fragment>)}</span>{root && <GitContextChip root={root} title={root.path} />}{actionsRow}</div>}
    {find && <FileFind input={searchField} query={needle} setQuery={setNeedle} options={findOptions} setOptions={setFindOptions} count={search.matches.length} index={matchIndex} error={search.error} previous={() => searchInFile(-1)} next={() => searchInFile(1)} close={() => setFind(false)} replace={{ open: replaceOpen, setOpen: setReplaceOpen, text: replacement, setText: setReplacement, disabled: readOnly || doc.binary, one: () => replaceWith(false), all: () => replaceWith(true) }} />}
    {goto && <GoToLine close={() => { setGoto(false); liveView()?.focus() }} submit={(text) => { const target = parseGoto(text); return target ? gotoLine(target.line, target.column) : false }} />}
    {doc.conflict && <div className="wf-banner" role="alert"><span>Este arquivo mudou no disco.</span><button type="button" onClick={() => update(doc.path, { compare: { before: doc.conflict!.content, title: 'Disco × sua versão', split: true } })}>Comparar</button><button type="button" title="Mantém o seu texto; o próximo Ctrl+S grava por cima do disco" onClick={() => { update(doc.path, { saved: doc.conflict!.content, disk: doc.conflict!.disk, eol: doc.conflict!.eol, conflict: undefined }); window.setTimeout(() => liveView()?.focus(), 0) }}>Manter o meu</button><button type="button" onClick={() => setDiscarding(true)}>Recarregar</button></div>}
    {doc.deleted && <div className="wf-banner" role="alert"><span>Este arquivo foi apagado.</span>{restore && <button type="button" onClick={() => restore(doc.path)}>Salvar mesmo assim</button>}{closeDocument && <button type="button" onClick={closeDocument}>Fechar</button>}</div>}
    {(error || doc.error) && <div className="wf-error" role="alert">{error || doc.error}</div>}{loading && <p className="wf-note">Abrindo…</p>}
    {conflictView ? <ConflictCompare info={conflictView} path={doc.path} options={editorOptions} back={() => setConflictView(undefined)} />
      : doc.compare ? <div className="wf-diffview"><DiffEditor key={`${doc.path}:compare`} before={doc.compare.before} after={doc.content} path={doc.path} layout={doc.compare.split ? 'split' : focused ? 'unified' : preferences.diffLayout} editable={!readOnly && !doc.binary} onChange={(text) => update(doc.path, { content: text })} options={editorOptions} title={doc.compare.title} onBack={() => update(doc.path, { compare: undefined })} /></div>
      : doc.diffView && canDiff ? <div className="wf-diffview">{doc.versions ? <DiffEditor key={doc.path} before={doc.versions.before === null ? null : normalizeEol(doc.versions.before)} after={doc.versions.after === null ? null : doc.content} path={doc.path} layout={focused ? 'unified' : preferences.diffLayout} editable={!readOnly && !doc.binary} onChange={(text) => update(doc.path, { content: text })} options={editorOptions} {...(doc.versions.binary ? { unavailable: 'binary' as const } : doc.versions.truncated ? { unavailable: 'truncated' as const } : {})} fallbackDiff={change!.diff} review={reviewTarget} title={`Alterações desde ${doc.versions.baseLabel}`} /> : <p className="wf-note">Carregando alterações…</p>}</div>
      : fileKind(doc.path) === 'image' && (doc.binary || doc.preview) ? <div className="wf-imagepreview">{image ? <img src={image} alt={nameOf(doc.path)} /> : <p className="wf-note">{error || 'Carregando prévia…'}</p>}</div>
        : doc.binary ? <p className="wf-note">Este formato não tem prévia e não pode ser editado como texto.</p>
          : doc.preview ? isMarkdown(doc.path) ? <div className="md wf-preview" ref={previewRef}><Markdown source={doc.content} base={{ ...context, path: doc.path }} runnable={false} /></div> : <iframe className="wf-html" title={`Visualização de ${nameOf(doc.path)}`} sandbox="" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">${doc.content}`} />
            : <div ref={codeBox} className="wf-code">{lines && !composing && !readOnly && <button type="button" className="gdl-chatbtn tip" data-tip={`Comentar ${Math.abs(lines[1] - lines[0]) + 1} linha${lines[0] === lines[1] ? '' : 's'}`} aria-label="Comentar as linhas selecionadas" style={{ top: buttonTop }} onClick={() => setComposing(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg></button>}
              <CodeEditor key={doc.path} value={doc.content} path={doc.path} readOnly={readOnly} options={editorOptions} extensions={editorExtensions} onCompareConflict={setConflictView} ariaLabel={`Código fonte de ${nameOf(doc.path)}`} onChange={(text) => update(doc.path, { content: text })} onReady={(editor) => { view.current = editor; setCursor(cursorInfo(editor.state)) }} initialSelection={readViewState(doc.path)} initialScroll={readViewState(doc.path)?.scrollTop} onViewState={(state) => writeViewState(doc.path, state)} />
            </div>}
    {lines && composing && <div className="gdl-compose" role="group" aria-label="Comentar as linhas selecionadas">
      <div className="gdl-askhead"><span>{Math.abs(lines[1] - lines[0]) + 1} linha{lines[0] === lines[1] ? '' : 's'} selecionada{lines[0] === lines[1] ? '' : 's'} em {nameOf(doc.path)}</span><span className={`wf-comment-target ${commentCardId ? 'card' : 'new'}`}>{commentTarget}</span><button type="button" className="ghost" onClick={() => { setComposing(false); setLines(null); setComment('') }}>Cancelar</button></div>
      <div className="cbox"><textarea ref={commentField} value={comment} rows={1} placeholder="O que fazer nessas linhas? O comentário vai para o chat com o trecho" aria-label="Comentário sobre as linhas" onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendComment() } else if (event.key === 'Escape') { event.stopPropagation(); setComposing(false); setLines(null); setComment('') } }} />
        <button type="button" className="sendbtn tip" data-tip="Levar ao chat (Enter)" aria-label="Levar ao chat" disabled={!comment.trim()} onClick={() => void sendComment()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button></div>
      {commentError && <p className="error">{commentError}</p>}</div>}
    {doc.truncated && <p className="wf-note">Arquivo acima de 1 MB: visualização parcial, edição desabilitada.</p>}
    {discarding && doc.conflict && <ConfirmDialog eyebrow="Arquivo" title="Recarregar do disco?" text={`Sua edição em ${nameOf(doc.path)} será descartada e o texto do disco volta ao editor.`} ok="Descartar e recarregar" danger cancel={() => setDiscarding(false)} confirm={() => { setDiscarding(false); update(doc.path, { content: doc.conflict!.content, saved: doc.conflict!.content, disk: doc.conflict!.disk, eol: doc.conflict!.eol, conflict: undefined }) }} />}
    <footer className="wf-status"><b className={`wf-state ${doc.binary || doc.truncated ? '' : dirty ? 'dirty' : 'saved'}`}>{doc.binary ? 'Binário' : doc.truncated || doc.locked ? 'Somente leitura' : dirty ? 'Alterações sem salvar' : focused && !edit ? 'Somente leitura' : 'Salvo'}</b>{doc.notice && <em className="wf-notice" role="status">{doc.notice}</em>}<span>{preferences.autosave ? 'Salvamento automático' : 'Ctrl+S para salvar'}{!doc.binary && !(doc.preview && fileKind(doc.path) === 'image') && <> · Ln {cursor.line}, Col {cursor.column}{cursor.ranges > 1 ? ` · ${cursor.ranges} seleções` : cursor.selected ? ` (${cursor.selected} selecionados)` : ''} · <span className="wf-statusmenubox" ref={statusBox}><button type="button" className="wf-statusbtn" title="Recuo: clique para trocar o tamanho" aria-expanded={indentMenu} onClick={() => setIndentMenu(!indentMenu)}>{indent.kind === 'tab' ? 'Tab' : `Espaços: ${preferences.tabSize}`}</button>{indentMenu && <span className="popmenu wf-statusmenu" role="menu" aria-label="Tamanho do recuo">{[2, 4, 8].map((size) => <button key={size} type="button" role="menuitemradio" aria-checked={preferences.tabSize === size} className={preferences.tabSize === size ? 'on' : ''} onClick={() => { changePreferences({ tabSize: size }); setIndentMenu(false) }}>{size} espaços</button>)}</span>}</span> · {doc.eol === 'crlf' ? 'CRLF' : 'LF'} · {languageName(doc.path)}</>}</span></footer>
  </div>
}
