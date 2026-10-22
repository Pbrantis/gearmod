import React from 'react'
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
