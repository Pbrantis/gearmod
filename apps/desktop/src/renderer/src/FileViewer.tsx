import React, { useCallback, useRef, useState } from 'react'

const viewerMin = 320
const stored = (): number => { try { return Number(localStorage.getItem('agentboard.viewerWidth')) || 520 } catch { return 520 } }
const viewerState = { width: stored() }
const clampViewer = (value: number, chatWidth: number): number => Math.max(viewerMin, Math.min(window.innerWidth - chatWidth - 260, value))

/**
 * Painel de arquivo ao lado do chat: abre o que o agente citou (caminho ou link) sem sair da conversa. Aqui fica só o pedido de abertura
 * e a largura; o arquivo em si é o `FocusedFile`. O divisor do meio redistribui o espaço entre o chat e o arquivo; `chatWidth` é a
 * largura atual do chat, que o divisor também ajusta.
 */
export function useFileViewer(chatWidth: number, setChatWidth: (value: number) => void): {
  request: { path: string; at: number } | null; requested: string | null; open(path: string): void; close(): void; setDirty(value: boolean): void
  width: number; dragging: boolean; startResize(event: React.PointerEvent<HTMLDivElement>): void; startSplit(event: React.PointerEvent<HTMLDivElement>): void; expand(): void; restore(): void
} {
  const [request, setRequest] = useState<{ path: string; at: number } | null>(null), dirty = useRef(false)
  const [width, setWidthState] = useState(() => viewerState.width), [dragging, setDragging] = useState(false)
  const open = useCallback((path: string) => {
    if (dirty.current && !window.confirm('Descartar as alterações do arquivo aberto?')) return
    setRequest({ path, at: Date.now() })
  }, [])
  const close = useCallback(() => setRequest(null), [])
  const setDirty = useCallback((value: boolean) => { dirty.current = value }, [])
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
  return { request, requested: request?.path ?? null, open, close, setDirty, width, dragging, startResize, startSplit, expand, restore }
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
