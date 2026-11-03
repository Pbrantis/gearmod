import React, { useLayoutEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@gearmod/contracts'
import { AgentMessage, answersFor } from './AgentMessage'
import { AttachmentChips, splitAttachmentNote } from './Attachments'
import { ReplyContextCards } from './ChatReplies'
import { splitChatReplies } from './chatReplyContext'
import { useT } from './i18n'

/**
 * Uma mensagem do chat no estilo do Claude Code: a minha no balão; a do agente direto no fundo, em Markdown;
 * ferramentas usadas como linhas cinzas que expandem; avisos do sistema discretos.
 */
export function ChatMessageView({ message, answered = true, busy = false, answers }: { message: ChatMessage; answered?: boolean; busy?: boolean; answers?: Map<string, string> }): React.JSX.Element {
  if (message.role === 'tool') {
    const [title, ...rest] = message.body.split('\n'), detail = rest.join('\n').trim()
    return detail
      ? <details className="msg tool toolrow"><summary>{title}</summary><pre>{detail}</pre></details>
      : <div className="msg tool toolrow"><span className="toolplain">{title}</span></div>
  }
  // Aviso de que uma skill do sistema conduz esta execução (em vez de mostrar o prompt): vira uma etiqueta discreta.
  const skill = message.role === 'system' ? /^▶ Usando a skill (\S+)(.*)$/.exec(message.body) : null
  if (skill) return <div className="msg sys skillnote"><span className="skillbadge">skill</span><b>{skill[1]}</b>{skill[2] && <small>{skill[2].replace(/^\s*·\s*/, '')}</small>}</div>
  const kind = message.role === 'assistant' ? 'agent' : message.role === 'system' ? 'sys' : message.role
  return <div className={`msg ${kind}`} data-mid={message.id}>{message.role === 'system' && message.status === 'failed' ? '⚠ ' : ''}{message.role === 'assistant' ? <div className="md chatmd"><AgentMessage source={message.body} answered={answered} busy={busy} answers={answers} /></div> : message.role === 'user' ? <UserBody body={message.body} /> : message.body}</div>
}

/** Mensagem do usuário: anexos como miniaturas em cima e só o texto escrito embaixo (o bloco de caminhos fica por baixo dos panos). */
function UserBody({ body }: { body: string }): React.JSX.Element {
  const context = splitChatReplies(body), { text, files } = splitAttachmentNote(context.text), replies = context.replies
  const review = parseReviewContext(text), screenTest = parseScreenTest(text)
  return <>{files.length > 0 && <AttachmentChips files={files} />}<ReplyContextCards replies={replies} />{review ? <ReviewContext {...review} /> : screenTest ? <ScreenTestCard {...screenTest} /> : text && <div className="usertext">{text}</div>}</>
}

export interface ScreenTestData { skill: string; visible: boolean }

/** Reconhece o pedido do atalho "Testar na tela (Playwright)" para mostrá-lo como um card de configuração, não como texto. */
export function parseScreenTest(body: string): ScreenTestData | null {
  const match = /^Teste os critérios de aceite que dependem da tela usando o Playwright CLI, seguindo a skill (\S+?)\.( Rode com o navegador visível \(--headed\) e com slowMo para eu acompanhar\.| Rode sem janela \(headless\), guardando screenshot e trace do que falhar\.)$/.exec(body.trim())
  return match ? { skill: match[1]!, visible: match[2]!.includes('--headed') } : null
}

/** Card do teste na tela: o que será feito e com quais opções (ferramenta, skill, navegador e evidências). */
function ScreenTestCard({ skill, visible }: ScreenTestData): React.JSX.Element {
  const s = useT().chat.screenTest
  const rows: Array<[string, string]> = [[s.tool, 'Playwright CLI'], [s.skill, skill], [s.browser, visible ? s.browserVisible : s.browserHeadless], [s.evidence, visible ? s.evidenceVisible : s.evidenceFailures]]
  return <div className="testcard" aria-label={s.ariaLabel}>
    <div className="testcard-head"><span className="testcard-ico" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="11" rx="2" /><path d="M7 17.5h6M10 14.5v3" /></svg></span><div><b>{s.title}</b><small>{s.subtitle}</small></div></div>
    <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </div>
}

export interface ReviewContextData { path: string; lines: string; oldCode: boolean; code: string; comment: string }

/** Reconhece o pedido criado ao conversar sobre uma seleção do diff. */
export function parseReviewContext(body: string): ReviewContextData | null {
  const normalized = body.replace(/\r\n?/g, '\n')
  const match = /^Revisão de código em `([^`]+)` \(((?:linha|linhas) [^)]+?|trecho)(, do código antigo)?\):\n\n```diff\n([\s\S]*?)\n```(?:\n\n([\s\S]*))?$/.exec(normalized)
  if (!match) return null
  return { path: match[1]!, lines: match[2]!, oldCode: Boolean(match[3]), code: match[4]!, comment: match[5]?.trim() ?? '' }
}

function FileIcon(): React.JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.75h6l4 4v10.5H5z" /><path d="M11 2.75v4h4" /></svg>
}

function LinesIcon(): React.JSX.Element {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h2M4 10h2M4 15h2M9 5h7M9 10h7M9 15h7" /></svg>
}

/** Contexto visual do comentário: localização compacta e trecho claramente delimitado como código. */
function ReviewContext({ path, lines, oldCode, code, comment }: ReviewContextData): React.JSX.Element {
  const r = useT().chat.reviewContext
  return <div className="reviewctx">
    <div className="reviewctx-meta" aria-label={r.contextLabel}>
      <span className="reviewchip path" data-tip={path}><FileIcon /><span>{path}</span></span>
      <span className="reviewchip lines"><LinesIcon /><span>{lines}{oldCode ? r.oldCode : ''}</span></span>
    </div>
    <div className="reviewcode">
      <div className="reviewcode-head"><span className="reviewcode-dots" aria-hidden="true"><i /><i /><i /></span><span>diff</span></div>
      <pre aria-label={r.selectedSnippet}><code>{code.split('\n').map((line, index) => {
        const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx'
        return <span key={index} className={kind}>{line || ' '}{index < code.split('\n').length - 1 ? '\n' : ''}</span>
      })}</code></pre>
    </div>
    {comment && <div className="reviewcomment">{comment}</div>}
  </div>
}

const pageSize = 10

/**
 * Ações seguidas do agente (Grep, Read…). Uma ação aparece normal; a partir de duas, fica numa caixinha que mostra só a
 * última e expande para o histórico, que desenha 10 por vez e carrega mais ao rolar para cima.
 */
function ToolGroup({ items }: { items: ChatMessage[] }): React.JSX.Element {
  const t = useT()
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
    <button type="button" className="toolgroup-head" aria-expanded={open} onClick={toggle}><span>{t.chat.toolGroup.actions(items.length)}</span><span className="chev" aria-hidden="true">›</span></button>
    {open
      ? <div className="toolgroup-list" ref={list} onScroll={onScroll}>{shown < items.length && <div className="toolgroup-more">{t.chat.toolGroup.scrollForPrevious}</div>}{visible.map((m) => <ChatMessageView key={m.id} message={m} />)}</div>
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
  // Resposta às perguntas do agente: some como balão e aparece dentro do cartão da pergunta.
  const hidden = new Set<string>(), answersOf = new Map<string, Map<string, string>>()
  messages.forEach((m, index) => {
    if (m.role !== 'assistant') return
    const next = messages.slice(index + 1).find((item) => item.role !== 'tool')
    const answers = next?.role === 'user' ? answersFor(m.body, next.body) : null
    if (next && answers) { hidden.add(next.id); answersOf.set(m.id, answers) }
  })
  for (let index = 0; index < messages.length; index++) {
    const m = messages[index]!
    if (hidden.has(m.id)) continue
    if (m.role !== 'tool') { out.push(<ChatMessageView key={m.id} message={m} answered={index < lastUser} busy={busy} answers={answersOf.get(m.id)} />); continue }
    const group: ChatMessage[] = []
    while (index < messages.length && messages[index]!.role === 'tool') group.push(messages[index++]!)
    index--
    if (!busy || index < lastUser) continue
    out.push(group.length === 1 ? <ChatMessageView key={group[0]!.id} message={group[0]!} /> : <ToolGroup key={group[0]!.id} items={group} />)
  }
  return <>{out}</>
}
