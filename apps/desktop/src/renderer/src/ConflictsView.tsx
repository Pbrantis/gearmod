import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { ConfirmDialog } from './ConfirmDialog'
import { plainError } from './NoticeDialog'
import { CodeEditor } from './editor/CodeEditor'
import { ConflictCompare } from './editor/ConflictCompare'
import { findConflicts, hasConflicts, nextConflict, previousConflict } from './editor/conflicts'
import { usePreferences } from './editor/preferences'

export type ConflictState = { operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null; files: string[] }
export const operationLabel: Record<NonNullable<ConflictState['operation']>, string> = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' }
export interface ConflictTarget { sourceId: string; cardId: string | null; repo: string; cardTitle: string | null }

/**
 * Resolução de conflitos dentro da página Git, repositório por repositório (inclusive a worktree de um card): os arquivos em conflito à esquerda e,
 * à direita, o arquivo inteiro no editor com "Aceitar atual · chegando · ambos · Comparar" em cada bloco. Nada é gravado sem "Salvar".
 */
export function ConflictsView({ target, changed, back, setDirty }: { target: ConflictTarget; changed(): void; back(): void; setDirty(value: boolean): void }): React.JSX.Element {
  const { sourceId, cardId } = target, tail = { sourceId, cardId }
  const [state, setState] = useState<ConflictState>({ operation: null, files: [] }), [path, setPath] = useState(''), [drafts, setDrafts] = useState<Record<string, { text: string; saved: string }>>({})
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState<{ title: string; text: string; run(): void }>(), [comparing, setComparing] = useState<{ ours: string; theirs: string; oursLabel: string; theirsLabel: string }>()
  const [preferences] = usePreferences(), view = useRef<EditorView | null>(null)
  const rebase = state.operation === 'rebase', oursLabel = rebase ? 'base' : 'atual', theirsLabel = rebase ? 'seu commit' : 'chegando'
  const draft = drafts[path], dirty = (file: string): boolean => Boolean(drafts[file] && drafts[file]!.text !== drafts[file]!.saved)
  const reload = useCallback(async (): Promise<ConflictState> => { const next = await window.agentboard.invoke('git:conflicts', tail); setState(next); return next }, [sourceId, cardId])
  useEffect(() => { void reload().catch((reason: unknown) => setError(plainError(reason))) }, [reload])
  useEffect(() => { if (!state.files.includes(path)) setPath(state.files[0] ?? '') }, [state.files, path])
  useEffect(() => {
    if (!path || drafts[path]) return
    let alive = true
    void window.agentboard.invoke('git:conflict-file', { ...tail, path }).then((text) => { if (alive) setDrafts((all) => ({ ...all, [path]: { text, saved: text } })) }).catch((reason: unknown) => { if (alive) setError(plainError(reason)) })
    return () => { alive = false }
  }, [path, sourceId, cardId])
  const anyDirty = Object.values(drafts).some((item) => item.text !== item.saved)
  useEffect(() => { setDirty(anyDirty); return () => setDirty(false) }, [anyDirty])
  const remaining = useMemo(() => draft ? findConflicts(draft.text).length : 0, [draft?.text])
  const options = useMemo(() => ({ wrap: preferences.wrap, tabSize: preferences.tabSize, indentWithTab: preferences.indent, whitespace: preferences.whitespace, guides: preferences.guides, scrollPastEnd: preferences.beyond }), [preferences.wrap, preferences.tabSize, preferences.indent, preferences.whitespace, preferences.guides, preferences.beyond])
  const act = async (task: () => Promise<unknown>): Promise<void> => { setBusy(true); setError(''); try { await task() } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) } }
  const forget = (file: string): void => setDrafts((all) => { const next = { ...all }; delete next[file]; return next })
  /** Pergunta antes de abandonar uma edição que ainda não foi salva. */
  const guard = (file: string, title: string, run: () => void): void => { if (dirty(file)) setPending({ title, text: `Há edição sem salvar em ${file}. Se continuar, ela será descartada.`, run }); else run() }
  const save = (): Promise<void> => act(async () => { if (!draft) return; await window.agentboard.invoke('git:conflict-save', { ...tail, path, content: draft.text }); setDrafts((all) => ({ ...all, [path]: { text: draft.text, saved: draft.text } })) })
  const resolve = (side: 'ours' | 'theirs' | 'marked'): Promise<void> => act(async () => { await window.agentboard.invoke('git:conflict-resolve', { ...tail, path, side }); forget(path); await reload(); changed() })
  const saveAndMark = (): Promise<void> => act(async () => { if (!draft) return; await window.agentboard.invoke('git:conflict-save', { ...tail, path, content: draft.text }); await window.agentboard.invoke('git:conflict-resolve', { ...tail, path, side: 'marked' }); forget(path); await reload(); changed() })
  const finish = (action: 'continue' | 'abort'): Promise<void> => act(async () => { await window.agentboard.invoke('git:conflict-finish', { ...tail, action }); changed(); back() })
  const open = (file: string): void => { if (file !== path) guard(path, 'Trocar de arquivo?', () => { setComparing(undefined); setPath(file) }) }
  const label = state.operation ? operationLabel[state.operation] : 'Operação'
  const marked = draft ? hasConflicts(draft.text) : false
  return <section className="cflview" style={{ gridColumn: '1 / -1' }} aria-label="Resolver conflitos" onKeyDown={(event) => { if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 's') { event.preventDefault(); void save() } }}>
    <header className="cflview-head"><div><div className="eyebrow">{label} em andamento</div><h2>{target.repo}{target.cardTitle ? <small> · worktree de {target.cardTitle}</small> : null}</h2></div><span className="cflview-count">{state.files.length ? `${state.files.length} arquivo${state.files.length === 1 ? '' : 's'} em conflito` : 'Todos os conflitos resolvidos'}</span><button type="button" className="mini secondary" onClick={() => guard(path, 'Voltar ao grafo?', back)}>Voltar ao grafo</button></header>
    <div className="cflview-body">
      <ul className="cfl-files" aria-label="Arquivos em conflito">{state.files.map((file) => <li key={file}><button type="button" className={file === path ? 'on' : ''} title={file} onClick={() => open(file)}>{file}{dirty(file) && <i className="cflview-dot" title="Alterações sem salvar" />}</button></li>)}{!state.files.length && <li className="cfl-ok">Nada mais para resolver. Continue a operação.</li>}</ul>
      <div className="cflview-main">{path ? <>
        <div className="cfl-actions"><span className="cflview-left">{draft ? `${remaining} ${remaining === 1 ? 'conflito restante' : 'conflitos restantes'} neste arquivo` : 'Carregando…'}</span>
          <button type="button" className="wf-findnav" aria-label="Conflito anterior" title="Conflito anterior (Shift+Alt+F5)" disabled={!remaining} onClick={() => view.current && previousConflict(view.current)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4m-5 5 5-5 5 5" /></svg></button>
          <button type="button" className="wf-findnav" aria-label="Próximo conflito" title="Próximo conflito (Alt+F5)" disabled={!remaining} onClick={() => view.current && nextConflict(view.current)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12m-5-5 5 5 5-5" /></svg></button>
          <span className="grow1" />
          <button type="button" className="mini" disabled={busy} onClick={() => guard(path, `Usar a versão ${oursLabel} inteira?`, () => void resolve('ours'))}>Usar a versão {oursLabel} inteira</button>
          <button type="button" className="mini" disabled={busy} onClick={() => guard(path, `Usar a versão ${theirsLabel} inteira?`, () => void resolve('theirs'))}>Usar a versão {theirsLabel} inteira</button>
          <button type="button" className="mini secondary" disabled={busy || !draft || draft.text === draft.saved} title="Ctrl+S" onClick={() => void save()}>Salvar</button>
          <button type="button" className="mini" disabled={busy || !draft || marked} title={marked ? 'Ainda há marcadores de conflito no arquivo' : undefined} onClick={() => void saveAndMark()}>Salvar e marcar como resolvido</button></div>
        {draft ? (comparing ? <ConflictCompare info={comparing} path={path} options={options} back={() => setComparing(undefined)} /> : <div className="cflview-editor"><CodeEditor key={path} value={draft.text} path={path} options={options} ariaLabel={`Conflitos em ${path}`} conflictLabels={{ ours: oursLabel, theirs: theirsLabel }} onCompareConflict={setComparing} onChange={(text) => setDrafts((all) => ({ ...all, [path]: { text, saved: all[path]?.saved ?? '' } }))} onReady={(editor) => { view.current = editor }} /></div>) : <div className="cgnote">Carregando…</div>}
      </> : <div className="cgnote">Sem arquivos em conflito.</div>}</div>
    </div>
    {error && <p className="error">{error}</p>}
    <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => setPending({ title: `Cancelar o ${label.toLowerCase()}?`, text: 'A pasta volta ao que era antes da operação e as edições de conflito feitas até aqui se perdem.', run: () => void finish('abort') })}>Cancelar {label.toLowerCase()}</button><span className="grow1" /><button type="button" disabled={busy || state.files.length > 0} onClick={() => void finish('continue')}>Continuar {label.toLowerCase()}</button></div>
    {pending && <ConfirmDialog eyebrow="Conflitos" title={pending.title} text={pending.text} ok="Continuar" danger cancel={() => setPending(undefined)} confirm={() => { const run = pending.run; setPending(undefined); run() }} />}
  </section>
}
