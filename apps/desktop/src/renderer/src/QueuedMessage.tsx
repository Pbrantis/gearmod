import React, { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Mensagem escrita enquanto o agente ainda trabalha: fica numa prévia embaixo do chat em vez de se perder. Quando o agente termina,
 * ela segue sozinha; "Enviar agora" interrompe o turno e manda já, para complementar o contexto (a sessão do agente continua).
 * Se você parou o agente no botão, ela espera a sua decisão em vez de sair sozinha.
 */
export function useQueuedMessage(busy: boolean, deliver: (text: string) => Promise<void>): {
  queued: string; queue(text: string): void; take(): string; discard(): void; markStopped(): void; sendNow(cancel: () => Promise<void>): void
} {
  const [queued, setQueued] = useState('')
  const stopped = useRef(false), interrupting = useRef(false), wasBusy = useRef(busy)
  useEffect(() => {
    const ended = wasBusy.current && !busy; wasBusy.current = busy
    if (!ended) return
    const manual = stopped.current && !interrupting.current
    stopped.current = false; interrupting.current = false
    if (!queued || manual) return
    setQueued(''); void deliver(queued)
  }, [busy]) // só reage ao fim do turno; `queued` e `deliver` são os da renderização em que ele terminou
  const queue = useCallback((text: string) => setQueued((current) => (current ? `${current}\n\n${text}` : text)), [])
  const take = (): string => { const text = queued; setQueued(''); return text }
  const sendNow = (cancel: () => Promise<void>): void => {
    if (!busy) { const text = take(); if (text) void deliver(text); return }
    interrupting.current = true; void cancel()
  }
  return { queued, queue, take, discard: () => setQueued(''), markStopped: () => { stopped.current = true }, sendNow }
}

export function QueuedPreview({ text, busy, sendNow, edit, discard }: { text: string; busy: boolean; sendNow(): void; edit(): void; discard(): void }): React.JSX.Element {
  return <div className="queued" role="status">
    <div className="q-head"><b>{busy ? 'Na fila' : 'Pronta para enviar'}</b><span>{busy ? 'Segue quando o agente terminar. Enviar agora interrompe o turno atual para complementar o contexto.' : 'O agente foi parado. Quer enviar agora?'}</span></div>
    <p className="q-text">{text}</p>
    <div className="q-actions"><button type="button" className="q-now" onClick={sendNow}>{busy ? 'Enviar agora' : 'Enviar'}</button><button type="button" className="secondary" onClick={edit}>Editar</button><button type="button" className="secondary" onClick={discard}>Descartar</button></div>
  </div>
}
