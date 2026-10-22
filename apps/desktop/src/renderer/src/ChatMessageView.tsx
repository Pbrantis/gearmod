import React, { useLayoutEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@agentboard/contracts'
import { Markdown } from './markdown'

/**
 * Uma mensagem do chat no estilo do Claude Code: a minha no balão; a do agente direto no fundo, em Markdown;
 * ferramentas usadas como linhas cinzas que expandem; avisos do sistema discretos.
 */
export function ChatMessageView({ message }: { message: ChatMessage }): React.JSX.Element {
  if (message.role === 'tool') {
    const [title, ...rest] = message.body.split('\n'), detail = rest.join('\n').trim()
    return detail
      ? <details className="msg tool toolrow"><summary>{title}</summary><pre>{detail}</pre></details>
      : <div className="msg tool toolrow"><span className="toolplain">{title}</span></div>
  }
  const kind = message.role === 'assistant' ? 'agent' : message.role === 'system' ? 'sys' : message.role
  return <div className={`msg ${kind}`}>{message.role === 'system' && message.status === 'failed' ? '⚠ ' : ''}{message.role === 'assistant' ? <div className="md chatmd"><Markdown source={message.body} /></div> : message.body}</div>
}

const pageSize = 10

/**
 * Ações seguidas do agente (Grep, Read…). Uma ação aparece normal; a partir de duas, fica numa caixinha que mostra só a
 * última e expande para o histórico, que desenha 10 por vez e carrega mais ao rolar para cima.
 */
function ToolGroup({ items }: { items: ChatMessage[] }): React.JSX.Element {
  const [open, setOpen] = useState(false), [shown, setShown] = useState(pageSize)
  const list = useRef<HTMLDivElement>(null), keep = useRef<{ height: number; top: number } | null>(null), atBottom = useRef(true)
  const visible = items.slice(-shown)
  useLayoutEffect(() => {
    const el = list.current; if (!el) return
    if (keep.current) { el.scrollTop = keep.current.top + (el.scrollHeight - keep.current.height); keep.current = null }
    else if (atBottom.current) el.scrollTop = el.scrollHeight
  }, [open, shown, items.length])
  const onScroll = (): void => {
    const el = list.current; if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
    if (el.scrollTop < 24 && shown < items.length) { keep.current = { height: el.scrollHeight, top: el.scrollTop }; setShown(shown + pageSize) }
  }
  const toggle = (): void => { setOpen(!open); setShown(pageSize); atBottom.current = true }
  return <div className={`toolgroup ${open ? 'open' : ''}`}>
    <button type="button" className="toolgroup-head" aria-expanded={open} onClick={toggle}><span>{items.length} ações</span><span className="chev" aria-hidden="true">›</span></button>
    {open
      ? <div className="toolgroup-list" ref={list} onScroll={onScroll}>{shown < items.length && <div className="toolgroup-more">Role para ver as anteriores</div>}{visible.map((m) => <ChatMessageView key={m.id} message={m} />)}</div>
      : <ChatMessageView message={items[items.length - 1]!} />}
  </div>
}

/**
 * Lista de mensagens do chat. As ações de ferramenta só aparecem enquanto o agente trabalha no turno atual
 * (depois da última mensagem do usuário); quando ele termina, elas somem e fica só a conversa.
 */
export function ChatMessageList({ messages, busy }: { messages: ChatMessage[]; busy: boolean }): React.JSX.Element {
  const lastUser = messages.reduce((found, m, index) => m.role === 'user' ? index : found, -1)
  const out: React.ReactNode[] = []
  for (let index = 0; index < messages.length; index++) {
    const m = messages[index]!
    if (m.role !== 'tool') { out.push(<ChatMessageView key={m.id} message={m} />); continue }
    const group: ChatMessage[] = []
    while (index < messages.length && messages[index]!.role === 'tool') group.push(messages[index++]!)
    index--
    if (!busy || index < lastUser) continue
    out.push(group.length === 1 ? <ChatMessageView key={group[0]!.id} message={group[0]!} /> : <ToolGroup key={group[0]!.id} items={group} />)
  }
  return <>{out}</>
}
