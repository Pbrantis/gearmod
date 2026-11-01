import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AttachmentChips } from './Attachments'
import { SendIcon } from './icons'
import { ReplyContextCards } from './ChatReplies'
import { splitChatReplies } from './chatReplyContext'
import { useT } from './i18n'

/**
 * Mensagem escrita enquanto o agente ainda trabalha: fica numa prévia embaixo do chat em vez de se perder. Quando o agente termina,
 * ela segue sozinha; "Enviar agora" interrompe o turno e manda já, para complementar o contexto (a sessão do agente continua).
 * Se você parou o agente no botão, ela espera a sua decisão em vez de sair sozinha.
 */
export function useQueuedMessage(busy: boolean, deliver: (text: string, files: string[]) => Promise<void>): {
  queued: string; files: string[]; queue(text: string, files?: string[]): void; take(): { text: string; files: string[] }; discard(): void; markStopped(): void; sendNow(cancel: () => Promise<void>): void
} {
  const [queued, setQueued] = useState(''), [files, setFiles] = useState<string[]>([])
  const stopped = useRef(false), interrupting = useRef(false), wasBusy = useRef(busy)
  useEffect(() => {
    const ended = wasBusy.current && !busy; wasBusy.current = busy
    if (!ended) return
    const manual = stopped.current && !interrupting.current
    stopped.current = false; interrupting.current = false
    if (!queued || manual) return
    setQueued(''); setFiles([]); void deliver(queued, files)
  }, [busy]) // só reage ao fim do turno; a mensagem e os anexos são os da renderização em que ele terminou
  const queue = useCallback((text: string, nextFiles: string[] = []) => {
    setQueued((current) => (current ? `${current}\n\n${text}` : text))
    setFiles((current) => [...new Set([...current, ...nextFiles])].slice(0, 20))
  }, [])
  const take = (): { text: string; files: string[] } => { const item = { text: queued, files }; setQueued(''); setFiles([]); return item }
  const sendNow = (cancel: () => Promise<void>): void => {
    if (!busy) { const item = take(); if (item.text) void deliver(item.text, item.files); return }
    interrupting.current = true; void cancel()
  }
  return { queued, files, queue, take, discard: () => { setQueued(''); setFiles([]) }, markStopped: () => { stopped.current = true }, sendNow }
}

export function QueuedPreview({ text, files, busy, sendNow, edit, discard }: { text: string; files: string[]; busy: boolean; sendNow(): void; edit(): void; discard(): void }): React.JSX.Element {
  const t = useT().chat.queued, parsed = splitChatReplies(text)
  const [open, setOpen] = useState(false), menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => { if (!menu.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div className="queued" role="status">
    <div className="q-content"><AttachmentChips files={files} /><ReplyContextCards replies={parsed.replies} />{parsed.text && <p className="q-text">{parsed.text}</p>}</div>
    <div className="q-tools" ref={menu}>
      <button type="button" className="sendbtn q-send tip" data-tip={busy ? t.sendNow : t.send} aria-label={busy ? t.sendNow : t.send} onClick={sendNow}><SendIcon /></button>
      <button type="button" className="sendbtn q-more" aria-label={t.moreOptions} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.35" /><circle cx="10" cy="10" r="1.35" /><circle cx="16" cy="10" r="1.35" /></svg></button>
      {open && <div className="q-menu" role="menu"><button type="button" role="menuitem" onClick={() => { setOpen(false); edit() }}>{t.edit}</button><button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); discard() }}>{t.discard}</button></div>}
    </div>
  </div>
}
