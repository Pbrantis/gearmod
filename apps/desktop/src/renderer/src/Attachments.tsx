import React, { useCallback, useEffect, useRef, useState } from 'react'
import { PlusIcon } from './icons'

const fileName = (path: string): string => path.split(/[\\/]/).pop() || path
type ContextTarget = { projectId: string; cardId: string | null }
const contextKey = (target: ContextTarget): string => `${target.projectId}:${target.cardId}`
const contextQueue = new Map<string, string[]>(), contextListeners = new Map<string, Set<() => void>>()
export function hasAttachmentTarget(target: ContextTarget): boolean { return Boolean(contextListeners.get(contextKey(target))?.size) }
export function queueContextFile(target: ContextTarget & { path: string }): void {
  const key = contextKey(target); contextQueue.set(key, [...new Set([...(contextQueue.get(key) ?? []), target.path])]); contextListeners.get(key)?.forEach((listener) => listener())
}

const textQueue = new Map<string, string[]>(), textListeners = new Map<string, Set<() => void>>()
/** Comentário sobre um trecho do editor: vira rascunho no campo de mensagem do chat, sem enviar nada. */
export function queueContextText(target: ContextTarget & { text: string }): void {
  const key = contextKey(target); textQueue.set(key, [...(textQueue.get(key) ?? []), target.text]); textListeners.get(key)?.forEach((listener) => listener())
}
export function hasCommentTarget(target: ContextTarget): boolean { return Boolean(textListeners.get(contextKey(target))?.size) }
/** Recebe os comentários enviados pelo editor de arquivos para este chat. */
export function useContextText(target: ContextTarget, receive: (text: string) => void): void {
  const latest = useRef(receive); latest.current = receive
  useEffect(() => {
    const key = contextKey(target), take = (): void => { const texts = textQueue.get(key); if (texts) { textQueue.delete(key); texts.forEach((text) => latest.current(text)) } }
    const listeners = textListeners.get(key) ?? new Set(); listeners.add(take); textListeners.set(key, listeners); take()
    return () => { listeners.delete(take) }
  }, [target.projectId, target.cardId])
}

/**
 * Anexos da próxima mensagem do chat: escolher pelo "+", arrastar ou colar (Ctrl+V) no campo. Ficam guardados até a mensagem sair
 * (inclusive quando ela espera na fila) e o agente recebe os caminhos para ler como contexto.
 */
export function useAttachments(target?: ContextTarget): { files: string[]; add(paths: string[]): void; remove(path: string): void; take(): string[]; choose(): Promise<void>; dropProps: React.HTMLAttributes<HTMLElement>; dragging: boolean } {
  const [files, setFiles] = useState<string[]>([]), [dragging, setDragging] = useState(false), ref = useRef<string[]>([])
  const update = (next: string[]): void => { ref.current = next; setFiles(next) }
  const add = useCallback((paths: string[]) => update([...new Set([...ref.current, ...paths.filter(Boolean)])].slice(0, 20)), [])
  useEffect(() => {
    if (!target) return
    const key = contextKey(target), receive = (): void => { const paths = contextQueue.get(key); if (paths) { contextQueue.delete(key); add(paths) } }
    const listeners = contextListeners.get(key) ?? new Set(); listeners.add(receive); contextListeners.set(key, listeners); receive()
    return () => { listeners.delete(receive) }
  }, [target?.projectId, target?.cardId, add])
  const remove = (path: string): void => update(ref.current.filter((item) => item !== path))
  const take = (): string[] => { const taken = ref.current; update([]); return taken }
  const choose = async (): Promise<void> => { try { add(await window.agentboard.invoke('files:choose', undefined)) } catch { /* diálogo cancelado ou indisponível */ } }
  // Ctrl+V: arquivos copiados no Explorer entram pelo caminho; imagens coladas (prints) são salvas na pasta de anexos do app.
  const paste = async (files: File[]): Promise<void> => {
    const paths: string[] = []
    for (const file of files) {
      let path = ''
      try { path = window.agentboard.getDroppedFilePath(file) } catch { /* sem caminho */ }
      if (!path) {
        try {
          const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) })
          path = await window.agentboard.invoke('files:save-pasted', { name: file.name || `colado.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, base64 })
        } catch { /* arquivo grande demais ou ilegível */ }
      }
      if (path) paths.push(path)
    }
    add(paths)
  }
  const dropProps: React.HTMLAttributes<HTMLElement> = {
    onPaste: (event) => { const pasted = Array.from(event.clipboardData.files); if (!pasted.length) return; event.preventDefault(); void paste(pasted) },
    onDragOver: (event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true) } },
    onDragLeave: () => setDragging(false),
    onDrop: (event) => {
      if (!event.dataTransfer.files.length) return
      event.preventDefault(); setDragging(false)
      add(Array.from(event.dataTransfer.files).map((file) => window.agentboard.getDroppedFilePath(file)))
    }
  }
  return { files, add, remove, take, choose, dropProps, dragging }
}

export function AttachButton({ onClick, disabled }: { onClick(): void; disabled?: boolean }): React.JSX.Element {
  return <button type="button" className="attachbtn tip" data-tip="Anexar arquivos (ou arraste ou cole com Ctrl+V)" aria-label="Anexar arquivos" disabled={disabled} onClick={onClick}><PlusIcon /></button>
}

const extLabel = (path: string): string => (path.split('.').pop() || 'arquivo').slice(0, 5).toUpperCase()

function AttachmentCard({ path, remove }: { path: string; remove?(path: string): void }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.agentboard.invoke('files:preview', { path }).then((url) => { if (alive) setSrc(url) }).catch(() => undefined)
    return () => { alive = false }
  }, [path])
  return <div className={`attcard tip ${src ? 'image' : 'file'}`} data-tip={path}>
    {src ? <img src={src} alt={fileName(path)} /> : <><span className="attcard-name">{fileName(path)}</span><span className="attcard-ext">{extLabel(path)}</span></>}
    {remove && <button type="button" className="attcard-x" aria-label={`Remover ${fileName(path)}`} onClick={() => remove(path)}>×</button>}
  </div>
}

export function AttachmentChips({ files, remove }: { files: string[]; remove?(path: string): void }): React.JSX.Element | null {
  if (!files.length) return null
  return <div className="attachments" aria-label="Arquivos anexados">{files.map((path) => <AttachmentCard key={path} path={path} remove={remove} />)}</div>
}

const noteMarker = 'Arquivos anexados (leia antes de responder; são contexto deste pedido):'

/**
 * Separa a mensagem que foi ao agente do bloco de caminhos que o app acrescenta (orchestrator.attachmentNote):
 * no chat aparece só o que o usuário escreveu, com os anexos como miniaturas em cima.
 */
export function splitAttachmentNote(body: string): { text: string; files: string[] } {
  const at = body.indexOf(noteMarker)
  if (at < 0) return { text: body, files: [] }
  const files = body.slice(at + noteMarker.length).split('\n').map((line) => /^-\s+(.+)$/.exec(line.trim())?.[1]).filter((path): path is string => Boolean(path))
  return files.length ? { text: body.slice(0, at).trim(), files } : { text: body, files: [] }
}
