import React, { useCallback, useEffect, useState } from 'react'
import { CloseIcon } from './icons'
import { Markdown } from './markdown'
import { plainError } from './NoticeDialog'

interface Opened { path: string; relative: string; content: string; truncated: boolean; size: number; binary: boolean }

const viewerMin = 320
const stored = (): number => { try { return Number(localStorage.getItem('agentboard.viewerWidth')) || 520 } catch { return 520 } }
const viewerState = { width: stored() }
const clampViewer = (value: number, chatWidth: number): number => Math.max(viewerMin, Math.min(window.innerWidth - chatWidth - 260, value))

/**
 * Visualizador de arquivo ao lado do chat: abre o que o agente citou (caminho ou link) sem sair da conversa. O divisor do meio
 * redistribui o espaço entre o chat e o arquivo; `chatWidth` é a largura atual do chat, que o divisor também ajusta.
 */
export function useFileViewer(chatId: string | undefined, chatWidth: number, setChatWidth: (value: number) => void): {
  file: Opened | null; error: string; loading: boolean; requested: string | null; open(path: string): void; close(): void
  width: number; dragging: boolean; startResize(event: React.PointerEvent<HTMLDivElement>): void; startSplit(event: React.PointerEvent<HTMLDivElement>): void; expand(): void; restore(): void
} {
  const [requested, setRequested] = useState<string | null>(null), [file, setFile] = useState<Opened | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [width, setWidthState] = useState(() => viewerState.width), [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!requested || !chatId) return
    let alive = true; setLoading(true); setError('')
    window.agentboard.invoke('files:read', { chatId, path: requested }).then((opened) => { if (alive) setFile(opened) }).catch((reason: unknown) => { if (alive) { setFile(null); setError(plainError(reason)) } }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [requested, chatId])
  const open = useCallback((path: string) => { if (chatId) setRequested(path) }, [chatId])
  const close = useCallback(() => { setRequested(null); setFile(null); setError('') }, [])
  const drag = (apply: (x: number) => void, finish?: () => void) => (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault(); setDragging(true)
    const move = (e: PointerEvent): void => apply(e.clientX)
    const up = (): void => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); setDragging(false); finish?.() }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up)
  }
  const remember = (): void => { try { localStorage.setItem('agentboard.viewerWidth', String(viewerState.width)) } catch { /* só vale nesta sessão */ } }
  // Borda de fora: muda só a largura do arquivo. Divisor do meio: troca espaço entre o chat e o arquivo, mantendo o total.
  const startResize = drag((x) => { const next = clampViewer(window.innerWidth - x - chatWidth, chatWidth); viewerState.width = next; setWidthState(next) }, remember)
  const startSplit = drag((x) => {
    const total = viewerState.width + chatWidth, nextChat = Math.max(440, Math.min(total - viewerMin, window.innerWidth - x))
    setChatWidth(nextChat); viewerState.width = total - nextChat; setWidthState(total - nextChat)
  }, remember)
  const place = (value: number): void => { const next = clampViewer(value, chatWidth); viewerState.width = next; setWidthState(next); remember() }
  const expand = (): void => { setChatWidth(440); place(window.innerWidth - 440 - 260) }
  const restore = (): void => place(520)
  return { file, error, loading, requested, open, close, width, dragging, startResize, startSplit, expand, restore }
}

const sizeLabel = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

export function FileViewer({ viewer, style }: { viewer: ReturnType<typeof useFileViewer>; style?: React.CSSProperties }): React.JSX.Element {
  const { file, error, loading, requested, close } = viewer
  const [raw, setRaw] = useState(false)
  useEffect(() => setRaw(false), [requested])
  const name = file?.relative ?? requested ?? '', isMd = /\.(md|mdx|markdown)$/i.test(name)
  const lines = file ? file.content.split('\n') : []
  return <aside className="fview" style={style} aria-label="Visualizador de arquivo">
    <div className="fv-head">
      <div className="fv-path" title={file?.path ?? requested ?? ''}>{name.split('/').map((part, index, all) => <React.Fragment key={index}>{index > 0 && <span className="fv-sep">›</span>}<span className={index === all.length - 1 ? 'fv-name' : ''}>{part}</span></React.Fragment>)}</div>
      {file && <small className="fv-size">{sizeLabel(file.size)}</small>}
      {isMd && file && !file.binary && <button type="button" className="fv-toggle" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? 'Ver renderizado' : 'Ver código'}</button>}
      <button type="button" className="x" aria-label="Fechar visualizador" onClick={close}><CloseIcon /></button>
    </div>
    <div className="fv-body">
      {loading && !file && <p className="fv-note"><span className="spin sm" /> Abrindo…</p>}
      {error && <p className="fv-note err">{error}</p>}
      {file?.binary && <p className="fv-note">Arquivo binário, sem visualização.</p>}
      {file && !file.binary && (isMd && !raw
        ? <div className="md fv-md"><Markdown source={file.content} /></div>
        : <div className="fv-code"><pre className="fv-ln" aria-hidden="true">{lines.map((_, index) => index + 1).join('\n')}</pre><pre className="fv-src"><code>{file.content}</code></pre></div>)}
      {file?.truncated && <p className="fv-note">Arquivo grande: mostrando só o começo (1 MB).</p>}
    </div>
  </aside>
}

/** Divisor entre o chat e o painel ao lado (arquivo ou diff): alça larga para arrastar e botões de expandir/restaurar. */
export function ViewGrip({ viewer }: { viewer: ReturnType<typeof useFileViewer> }): React.JSX.Element {
  const stop = (event: React.PointerEvent): void => event.stopPropagation()
  return <div className="viewgrip" role="separator" aria-orientation="vertical" aria-label="Dividir espaço entre o painel e o chat" onPointerDown={viewer.startSplit} onDoubleClick={viewer.restore}>
    <span className="viewgrip-handle" aria-hidden="true" />
    <span className="viewgrip-btns" onPointerDown={stop}>
      <button type="button" className="tip" data-tip="Expandir painel" aria-label="Expandir painel" onClick={viewer.expand}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5" /></svg></button>
      <button type="button" className="tip" data-tip="Restaurar largura" aria-label="Restaurar largura" onClick={viewer.restore}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 5 5 5-5 5" /></svg></button>
    </span>
  </div>
}
