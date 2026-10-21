import React, { useCallback, useEffect, useRef, useState } from 'react'
import { cardDocumentKinds, type AgentProfile, type Card, type CardDocumentKind, type CardDocuments, type Chat, type ChatMessage, type Project, type Run } from '@agentboard/contracts'
import { AgentMenu, useAgentConfig } from './AgentMenu'
import { priorityLabel } from './CardTile'
import { CloseIcon, CollapseIcon, ExpandIcon, MicIcon, SendIcon, SparkIcon, StopIcon } from './icons'
import { Markdown } from './markdown'
import { QualityPanel } from './QualityPanel'

const docLabels: Record<CardDocumentKind, string> = { resumo: 'Resumo', especificacao: 'Especificação', plano: 'Plano', tasks: 'Tasks' }
type Tab = CardDocumentKind | 'quality'

/** Chat do card (planejamento ou execução): conversa à esquerda e, expandido, a visão rápida do card à direita. */
export function CardChat({ project, card: initial, profiles, columnLabel, mode, close, openCard }: { project: Project; card: Card; profiles: AgentProfile[]; columnLabel: string; mode: 'planning' | 'execution'; close(): void; openCard(): void }): React.JSX.Element {
  const usable = profiles.filter((profile) => project.allowedProfileIds.includes(profile.id))
  const [card, setCard] = useState(initial), [docs, setDocs] = useState<CardDocuments>(), [chat, setChat] = useState<Chat>(), [messages, setMessages] = useState<ChatMessage[]>([]), [run, setRun] = useState<Run>(), [live, setLive] = useState('')
  const [profileId, setProfileId] = useState(usable[0]?.id ?? ''), [input, setInput] = useState(''), [expanded, setExpanded] = useState(true), [tab, setTab] = useState<Tab>('resumo'), [error, setError] = useState('')
  const log = useRef<HTMLDivElement>(null), runId = useRef<string | undefined>(undefined)
  const planning = mode === 'planning'
  const agentState = useAgentConfig(initial.id, mode, usable, chat?.profileId)
  const loadMessages = useCallback(async (chatId: string) => setMessages(await window.agentboard.invoke('messages:list', { chatId })), [])
  const loadCard = useCallback(async () => { const [fresh, documents] = await Promise.all([window.agentboard.invoke('cards:get', { cardId: initial.id }), window.agentboard.invoke('cards:documents', { cardId: initial.id })]); setCard(fresh); setDocs(documents) }, [initial.id])
  useEffect(() => { void window.agentboard.invoke('cards:mark-viewed', { cardId: initial.id }).then(() => loadCard()).catch((reason: unknown) => setError(String(reason))) }, [initial.id, loadCard])
  useEffect(() => { void window.agentboard.invoke('chats:list', { projectId: project.id, cardId: initial.id }).then((items) => { const found = items.find((item) => item.purpose === mode); if (found) { setChat(found); setProfileId(found.profileId); void loadMessages(found.id) } }).catch((reason: unknown) => setError(String(reason))) }, [project.id, initial.id, mode, loadMessages])
  useEffect(() => window.agentboard.onRunEvent((event) => {
    if (event.eventType === 'agentboard/card-updated' && event.payload.cardId === initial.id) void loadCard()
    if (event.runId !== runId.current) return
    if (event.eventType === 'item/agentMessage/delta') setLive((value) => value + String(event.payload.delta ?? ''))
    if (event.eventType === 'agentboard/run-completed') { runId.current = undefined; setRun(undefined); setLive(''); setChat((current) => { if (current) void loadMessages(current.id); return current }); void window.agentboard.invoke('cards:mark-viewed', { cardId: initial.id }).then(() => loadCard()) }
  }), [initial.id, loadCard, loadMessages])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [messages, live])
  useEffect(() => { document.body.classList.add('dockOpen'); return () => document.body.classList.remove('dockOpen') }, [])
  useEffect(() => { document.body.classList.toggle('dockFull', expanded); return () => document.body.classList.remove('dockFull') }, [expanded])

  const send = async (): Promise<void> => {
    const prompt = input.trim(); if (!prompt || run) return
    try {
      setError(''); setInput('')
      let current = chat
      const chosen = agentState.config?.profileId ?? profileId
      if (!current) { current = await window.agentboard.invoke('chats:create', { projectId: project.id, cardId: card.id, purpose: mode, profileId: chosen }); setChat(current) }
      const started = await window.agentboard.invoke('agents:start', { chatId: current.id, prompt, planning })
      runId.current = started.id; setRun(started); setLive(''); await loadMessages(current.id)
    } catch (reason) { setError(String(reason)); setInput(prompt) }
  }
  const stop = async (): Promise<void> => { if (run) await window.agentboard.invoke('agents:cancel', { runId: run.id }).catch((reason: unknown) => setError(String(reason))) }
  const toggleTask = async (line: number, checked: boolean): Promise<void> => { await window.agentboard.invoke('cards:toggle-task', { cardId: card.id, line, checked }); await loadCard() }
  const busy = Boolean(run)

  return <aside className={`dock ${expanded ? 'full' : ''}`} aria-label="Chat do card">
    <div className="dockIn">
      <div className="dockHead"><div className="top"><div><p className="eyebrow">{planning ? 'Planejando card' : card.run.state === 'running' || run ? 'Executando' : card.run.state === 'paused' ? 'Pausado' : 'Execução'}</p><h2>{card.title || 'Novo card'}</h2><div className="ctxline"><span className="ctxchip">{columnLabel}</span></div></div>
        <div className="dockTools"><button type="button" className="ibtn tip" data-tip={expanded ? 'Voltar para o canto' : 'Expandir em tela cheia'} aria-label={expanded ? 'Voltar para o canto' : 'Expandir em tela cheia'} onClick={() => setExpanded(!expanded)}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button><button type="button" className="ibtn tip" data-tip="Fechar chat" aria-label="Fechar chat" onClick={close}><CloseIcon /></button></div></div></div>
      <div className="chatlog" ref={log}>
        {!messages.length && !live && <div className="msg sys">{planning ? 'Skill de planejamento carregada. Este chat só planeja, não altera arquivos.' : 'Chat de execução do card.'}</div>}
        {messages.map((m) => <div className={`msg ${m.role}`} key={m.id}>{m.role === 'system' && m.status === 'failed' ? '⚠ ' : ''}{m.body}</div>)}
        {live && <div className="msg assistant">{live}</div>}
        {busy && !live && <div className="msg assistant typing" aria-label="O agente está escrevendo"><i /><i /><i /></div>}
      </div>
      <div className="composer">
        {error && <p className="error">{error}</p>}
        <div className="cbox"><textarea rows={2} aria-label="Mensagem para o agente" value={input} placeholder={planning ? 'Descreva o que você quer planejar…' : 'Envie uma instrução ao agente…'} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
          <button type="button" className="micbtn tip" data-tip="Ditado por voz em breve" aria-label="Ditado por voz" disabled><MicIcon /></button>
          {busy ? <button type="button" className="sendbtn stop tip" data-tip="Parar" aria-label="Parar" onClick={() => void stop()}><StopIcon /></button> : <button type="button" className="sendbtn tip" data-tip="Enviar (Enter)" aria-label="Enviar" disabled={!input.trim() || !(agentState.config?.profileId ?? profileId)} onClick={() => void send()}><SendIcon /></button>}</div>
        <div className="cmeta">
          <span className="mode tip" data-tip={planning ? 'Este chat não altera arquivos' : 'Executa na worktree do card'}>{planning ? '✦ Só planejar' : 'Executar'}</span>
          <span className="skillChip tip" data-tip="Skill do sistema"><SparkIcon /> {planning ? 'Planejamento' : 'Execução'}</span>
          <AgentMenu profiles={usable} purpose={mode} state={agentState} lockProfile={Boolean(chat)} />
        </div>
      </div>
    </div>
    {expanded && <section className="quick" aria-label="Visão rápida do card">
      <div className="quickHead"><div className="pills"><span className={`pill ${card.type}`}>{card.type}</span><span className={`pill ${card.priority}`}>{priorityLabel[card.priority]}</span></div><button type="button" className="mini secondary" onClick={openCard}>Abrir card</button></div>
      <div className="quickTabs" role="tablist">{cardDocumentKinds.map((kind) => <button type="button" role="tab" aria-selected={tab === kind} key={kind} className={tab === kind ? 'on' : ''} onClick={() => setTab(kind)}>{docLabels[kind]}{kind === 'tasks' && card.tasks.total > 0 && <small>{card.tasks.done}/{card.tasks.total}</small>}</button>)}{!planning && <button type="button" role="tab" aria-selected={tab === 'quality'} className={tab === 'quality' ? 'on' : ''} onClick={() => setTab('quality')}>Qualidade</button>}</div>
      <div className="quickBody">{tab === 'quality' ? <QualityPanel cardId={card.id} /> : <Markdown source={docs?.[tab].contentMd ?? ''} onToggle={tab === 'tasks' ? (line, checked) => void toggleTask(line, checked) : undefined} />}</div>
    </section>}
  </aside>
}
