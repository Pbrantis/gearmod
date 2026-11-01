import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { MergeView, getChunks, getOriginalDoc, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge'
import { DiffLines } from '../gitDiff'
import { CodeEditor } from './CodeEditor'
import { baseExtensions, none, optionExtensions, readOnlyExtension, type EditorOptions } from './base'
import { languageFor } from './languages'
import { diffReviewPrompt, type ReviewChunk } from './diffPrompt'
import { linePicker, setPicked } from './picks'
import { tr, useT } from '../i18n'

type Review = { path: string; send(prompt: string): boolean | Promise<boolean> }
const collapse = { margin: 3, minSize: 6 }
/** No modo uma coluna só o "Reverter" existe: o "aceitar" do CodeMirror é escondido. */
const mergeControls = (type: 'reject' | 'accept', action: (event: MouseEvent) => void): HTMLElement => {
  if (type === 'accept') { const hidden = document.createElement('span'); hidden.hidden = true; return hidden }
  const button = document.createElement('button'); button.type = 'button'; button.name = 'reject'; button.textContent = tr().files.editor.diff.revert; button.title = tr().files.editor.diff.revertTip; button.setAttribute('aria-label', tr().files.editor.diff.revertTip); button.onmousedown = action
  return button
}

/**
 * Diff de um arquivo sobre o `@codemirror/merge`: uma coluna (`unified`) ou lado a lado (`split`), com cores de sintaxe, trechos iguais recolhidos,
 * reverter trecho, navegação entre alterações e comentário de linhas para o agente. O texto "depois" é do pai (`after`): editar aqui ou no editor é a mesma coisa.
 */
export function DiffEditor({ before, after, path, layout, editable, onChange, review, options, onReady, unavailable, fallbackDiff, title, onBack, onToggleLayout }: {
  title?: string; onBack?(): void; onToggleLayout?(): void; before: string | null; after: string | null; path: string; layout: 'unified' | 'split'; editable: boolean; onChange?(after: string): void; review?: Review
  options: EditorOptions; onReady?(view: EditorView): void; unavailable?: 'binary' | 'truncated'; fallbackDiff?: string
}): React.JSX.Element {
  const t = useT(), host = useRef<HTMLDivElement>(null), main = useRef<EditorView | null>(null), merge = useRef<MergeView | null>(null), box = useRef<HTMLDivElement>(null)
  const latest = useRef({ after, onChange, onReady }); latest.current = { after, onChange, onReady }
  const [count, setCount] = useState(0), [lines, setLines] = useState<[number, number] | null>(null), [composing, setComposing] = useState(false), [comment, setComment] = useState(''), [top, setTop] = useState(4), [error, setError] = useState('')
  const picking = useRef<number | null>(null), linesRef = useRef(lines), field = useRef<HTMLTextAreaElement>(null)
  linesRef.current = lines
  const deleted = after === null, readOnlyView = !editable || deleted
  const original = deleted ? '' : before ?? ''
  const placeButton = (): void => { const view = main.current, wrap = box.current, picked = linesRef.current; if (!view || !wrap || !picked) return; const line = view.state.doc.line(Math.min(Math.max(...picked) + 1, view.state.doc.lines)); setTop(Math.max(4, Math.round(view.documentTop + view.lineBlockAt(line.from).bottom - wrap.getBoundingClientRect().top - 14))) }
  const sync = (view: EditorView): void => { setCount(getChunks(view.state)?.chunks.length ?? 0) }
  /** Extensões do editor onde se escolhe e edita o texto novo. */
  const mainExtensions = useMemo((): Extension[] => [
    Prec.high(keymap.of([{ key: 'Alt-F5', run: (view) => goToNextChunk(view), preventDefault: true }, { key: 'Shift-Alt-F5', run: (view) => goToPreviousChunk(view), preventDefault: true }])),
    ...(review ? [linePicker((index, extend) => { if (extend && linesRef.current) setLines([linesRef.current[0], index]); else { picking.current = index; setComposing(false); setLines([index, index]) } }, (index) => { if (picking.current !== null) setLines([picking.current, index]) }, () => { picking.current = null })] : []),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) { latest.current.onChange?.(update.state.doc.toString()); sync(update.view) }
      if (review && update.selectionSet) { const { from, to } = update.state.selection.main; if (from !== to) { setComposing(false); setLines([update.state.doc.lineAt(from).number - 1, update.state.doc.lineAt(update.state.doc.sliceString(to - 1, to) === '\n' ? to - 1 : to).number - 1]) } else if (!composingRef.current) setLines(null) }
    }),
    EditorView.domEventHandlers({ scroll: () => { placeButton() } })
  ], [Boolean(review)])
  const composingRef = useRef(composing); composingRef.current = composing
  useEffect(() => {
    if (unavailable || deleted || !host.current) return
    const language = new Compartment(), initial = latest.current.after ?? ''
    const common = [...baseExtensions(), language.of(none), optionExtensions(options)]
    let view: EditorView
    if (layout === 'unified') {
      view = new EditorView({ parent: host.current, state: EditorState.create({ doc: initial, extensions: [...common, readOnlyExtension(readOnlyView), unifiedMergeView({ original, highlightChanges: true, gutter: true, syntaxHighlightDeletions: true, mergeControls: readOnlyView ? false : mergeControls, collapseUnchanged: collapse }), ...mainExtensions] }) })
    } else {
      const view2 = new MergeView({ parent: host.current, a: { doc: original, extensions: [...common, readOnlyExtension(true)] }, b: { doc: initial, extensions: [...common, readOnlyExtension(readOnlyView), ...mainExtensions] }, orientation: 'a-b', ...(readOnlyView ? {} : { revertControls: 'a-to-b' as const }), highlightChanges: true, gutter: true, collapseUnchanged: collapse })
      merge.current = view2; view = view2.b
    }
    main.current = view; let alive = true
    void languageFor(path).then((extension) => { if (!alive) return; const effects = language.reconfigure(extension ?? none); merge.current?.a.dispatch({ effects }); view.dispatch({ effects }) }).catch(() => undefined)
    const frame = window.requestAnimationFrame(() => sync(view)); latest.current.onReady?.(view)
    return () => { alive = false; window.cancelAnimationFrame(frame); main.current = null; merge.current?.destroy(); merge.current = null; view.destroy(); setLines(null); setComposing(false) }
  }, [layout, original, path, readOnlyView, options, unavailable, deleted, mainExtensions])
  // O pai pode trocar o texto por fora (recarregar do disco): aplica sem recriar a vista nem perder a rolagem.
  useEffect(() => { const view = main.current; if (view && after !== null && after !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: after } }) }, [after])
  useEffect(() => { main.current?.dispatch({ effects: setPicked.of(lines) }); placeButton() }, [lines])
  useEffect(() => { if (composing) field.current?.focus() }, [composing])
  const go = (next: boolean): void => { const view = main.current; if (!view) return; (next ? goToNextChunk : goToPreviousChunk)(view); view.focus() }
  const clear = (): void => { setLines(null); setComposing(false); setComment(''); setError('') }
  const send = async (): Promise<void> => {
    const view = main.current, picked = lines
    if (!review || !view || !picked || !comment.trim()) return
    const found = getChunks(view.state)?.chunks ?? [], oldDoc = layout === 'unified' ? getOriginalDoc(view.state) : merge.current!.a.state.doc, doc = view.state.doc
    const chunks: ReviewChunk[] = found.map((chunk) => ({ fromLine: doc.lineAt(Math.min(chunk.fromB, doc.length)).number, toLine: chunk.toB > chunk.fromB ? doc.lineAt(Math.max(chunk.fromB, chunk.toB - 1)).number : doc.lineAt(Math.min(chunk.fromB, doc.length)).number - 1, old: oldDoc.sliceString(chunk.fromA, Math.min(chunk.toA, oldDoc.length)) }))
    try { setError(''); if (await review.send(diffReviewPrompt({ path: review.path, from: Math.min(...picked) + 1, to: Math.max(...picked) + 1, after: doc.toString(), chunks, comment }))) clear() } catch { setError(t.files.editor.diff.sendFailed) }
  }
  if (unavailable) return <div className="diffed unavailable"><p className="wf-note">{t.files.editor.diff.unavailable(unavailable)}</p>{fallbackDiff && <div className="wf-diffview"><DiffLines text={fallbackDiff} {...(review ? { review } : {})} /></div>}</div>
  if (deleted) return <div className="diffed"><p className="wf-note diffed-note">{t.files.editor.diff.deleted}</p><CodeEditor value={before ?? ''} path={path} readOnly options={options} ariaLabel={t.files.editor.diff.previousVersion(path)} /></div>
  return <div className="diffed" ref={box}>
    <div className="diffed-bar"><button type="button" className="wf-findnav" aria-label={t.files.editor.diff.previousChange} data-tip={t.files.editor.diff.previousChangeTip} disabled={!count} onClick={() => go(false)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4m-5 5 5-5 5 5" /></svg></button><button type="button" className="wf-findnav" aria-label={t.files.editor.diff.nextChange} data-tip={t.files.editor.diff.nextChangeTip} disabled={!count} onClick={() => go(true)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12m-5-5 5 5 5-5" /></svg></button><span role="status">{count ? t.files.editor.diff.changeCount(count) : t.files.editor.diff.noChanges}</span>{title && <b className="diffed-title">{title}</b>}{onToggleLayout && <button type="button" className="wf-findnav" style={title ? undefined : { marginLeft: 'auto' }} aria-label={layout === 'split' ? t.files.editor.diff.oneColumnLabel : t.files.editor.diff.sideBySideLabel} data-tip={layout === 'split' ? t.files.editor.diff.oneColumn : t.files.editor.diff.sideBySide} onClick={onToggleLayout}><svg viewBox="0 0 20 20" aria-hidden="true">{layout === 'split' ? <path d="M3 4h14v12H3zM3 8h14" /> : <path d="M3 4h14v12H3zM10 4v12" />}</svg></button>}{onBack && <button type="button" className="mini secondary diffed-back" onClick={onBack}>{t.files.editor.diff.backToEditor}</button>}</div>
    <div className={`diffed-view ${layout}`}><div ref={host} className={layout === 'unified' ? 'cm-host' : 'cm-mergehost'} />
      {review && lines && !composing && <button type="button" className="gdl-chatbtn tip" data-tip={t.files.editor.diff.commentLines(Math.abs(lines[1] - lines[0]) + 1)} aria-label={t.files.editor.diff.commentLinesLabel} style={{ top }} onClick={() => setComposing(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg></button>}</div>
    {review && lines && composing && <div className="gdl-compose" role="group" aria-label={t.files.editor.diff.commentLinesLabel}>
      <div className="gdl-askhead"><span>{t.files.editor.diff.linesIn(Math.abs(lines[1] - lines[0]) + 1, review.path)}</span><button type="button" className="ghost" onClick={clear}>{t.common.cancel}</button></div>
      <div className="cbox"><textarea ref={field} value={comment} rows={1} placeholder={t.files.editor.diff.commentPlaceholder} aria-label={t.files.editor.diff.commentLabel} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } else if (event.key === 'Escape') { event.stopPropagation(); clear() } }} />
        <button type="button" className="sendbtn tip" data-tip={t.files.editor.diff.sendTip} aria-label={t.files.editor.diff.send} disabled={!comment.trim()} onClick={() => void send()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button></div>
      {error && <p className="error">{error}</p>}</div>}
  </div>
}
