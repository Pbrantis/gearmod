import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { plainError } from './NoticeDialog'

export type ConflictState = { operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null; files: string[] }
export const operationLabel: Record<NonNullable<ConflictState['operation']>, string> = { merge: 'Merge', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' }

type Part = { kind: 'text'; lines: string[] } | { kind: 'conflict'; ours: string[]; theirs: string[]; oursName: string; theirsName: string }

/** Separa o arquivo em trechos normais e blocos de conflito (<<<<<<< / ======= / >>>>>>>). */
function parseConflicts(text: string): Part[] {
  const parts: Part[] = [], lines = text.replace(/\r$/gm, '').split('\n')
  let current: Part = { kind: 'text', lines: [] }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^<{7}( |$)/.test(line)) {
      if (current.kind === 'text' && current.lines.length) parts.push(current)
      const block: Extract<Part, { kind: 'conflict' }> = { kind: 'conflict', ours: [], theirs: [], oursName: line.slice(8), theirsName: '' }
      let side: 'ours' | 'theirs' = 'ours'
      for (i++; i < lines.length; i++) {
        const inner = lines[i]!
        if (/^={7}$/.test(inner)) { side = 'theirs'; continue }
        if (/^>{7}( |$)/.test(inner)) { block.theirsName = inner.slice(8); break }
        if (/^\|{7}( |$)/.test(inner)) { side = 'theirs'; continue }
        block[side].push(inner)
      }
      parts.push(block); current = { kind: 'text', lines: [] }
    } else if (current.kind === 'text') current.lines.push(line)
  }
  if (current.kind === 'text' && current.lines.length) parts.push(current)
  return parts
}

/** Tela de conflitos: um arquivo por vez, com os dois lados lado a lado, escolha de qual vale e o botão de continuar/cancelar a operação. */
export function ConflictDialog({ sourceId, state, changed, close }: { sourceId: string; state: ConflictState; changed(): void; close(): void }): React.JSX.Element {
  const [path, setPath] = useState(state.files[0] ?? ''), [text, setText] = useState<string>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState('')
  const rebase = state.operation === 'rebase'
  const oursLabel = rebase ? 'a versão da base (destino do rebase)' : 'a versão da branch atual', theirsLabel = rebase ? 'a versão do seu commit' : 'a versão que está chegando'
  useEffect(() => { if (!state.files.includes(path)) setPath(state.files[0] ?? '') }, [state.files, path])
  const loadFile = useCallback(() => { if (!path) { setText(undefined); return } setText(undefined); void window.agentboard.invoke('git:conflict-file', { sourceId, path }).then(setText).catch((reason: unknown) => setError(plainError(reason))) }, [sourceId, path])
  useEffect(loadFile, [loadFile])
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); close() } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [close])
  const parts = useMemo(() => parseConflicts(text ?? ''), [text])
  const act = async (task: () => Promise<unknown>): Promise<void> => { setBusy(true); setError(''); try { await task(); changed() } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) } }
  const resolve = (side: 'ours' | 'theirs' | 'marked'): Promise<void> => act(() => window.agentboard.invoke('git:conflict-resolve', { sourceId, path, side }))
  const finish = (action: 'continue' | 'abort'): Promise<void> => act(async () => { const out = await window.agentboard.invoke('git:conflict-finish', { sourceId, action }); setDone(out.output); close() })
  const label = state.operation ? operationLabel[state.operation] : 'Operação'
  return <div className="overlay top" role="dialog" aria-label="Resolver conflitos"><div className="modal conflictbox">
    <header><div><div className="eyebrow">{label} em andamento</div><h2>{state.files.length ? `${state.files.length} arquivo${state.files.length === 1 ? '' : 's'} em conflito` : 'Todos os conflitos resolvidos'}</h2></div><button type="button" className="x" aria-label="Fechar" onClick={close}>×</button></header>
    <div className="cfl-body">
      <ul className="cfl-files" aria-label="Arquivos em conflito">{state.files.map((file) => <li key={file}><button type="button" className={file === path ? 'on' : ''} title={file} onClick={() => setPath(file)}>{file}</button></li>)}{!state.files.length && <li className="cfl-ok">Nada mais para resolver. Continue para concluir.</li>}</ul>
      <div className="cfl-view">{path ? <>
        <div className="cfl-actions"><button type="button" className="mini" disabled={busy} onClick={() => void resolve('ours')}>Usar {oursLabel}</button><button type="button" className="mini" disabled={busy} onClick={() => void resolve('theirs')}>Usar {theirsLabel}</button><button type="button" className="mini secondary" disabled={busy} title="Depois de editar o arquivo no seu editor e remover os marcadores" onClick={() => void resolve('marked')}>Já editei, marcar como resolvido</button></div>
        <div className="cfl-code">{text === undefined ? <div className="cgnote">Carregando…</div> : parts.map((part, index) => part.kind === 'text'
          ? <pre key={index} className="cfl-ctx">{part.lines.length > 6 ? [...part.lines.slice(0, 3), `··· ${part.lines.length - 6} linhas iguais ···`, ...part.lines.slice(-3)].join('\n') : part.lines.join('\n')}</pre>
          : <div key={index} className="cfl-block"><div className="cfl-side ours"><small>{rebase ? 'Base' : 'Atual'} · {part.oursName}</small><pre>{part.ours.join('\n') || ' '}</pre></div><div className="cfl-side theirs"><small>{rebase ? 'Seu commit' : 'Chegando'} · {part.theirsName}</small><pre>{part.theirs.join('\n') || ' '}</pre></div></div>)}</div>
      </> : <div className="cgnote">{done || 'Sem arquivos em conflito.'}</div>}</div>
    </div>
    {error && <p className="error">{error}</p>}
    <div className="actions"><button type="button" className="secondary" disabled={busy} onClick={() => void finish('abort')}>Cancelar {label.toLowerCase()}</button><span className="grow1" /><button type="button" disabled={busy || state.files.length > 0} onClick={() => void finish('continue')}>Continuar {label.toLowerCase()}</button></div>
  </div></div>
}
