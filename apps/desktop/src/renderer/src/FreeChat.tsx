import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentProfile, Chat, ChatMessage, Project } from '@agentboard/contracts'
import { useDockSize } from './CardChat'
import { CloseIcon, CollapseIcon, ExpandIcon, MicIcon, SendIcon, StopIcon } from './icons'
import { Select } from './Select'
import { AgentIcon } from './AgentIcon'
import { ChatMessageView } from './ChatMessageView'
import { Markdown } from './markdown'
import { ThinkingIndicator, useBusySince, useTypewriter } from './Thinking'
import { startVoiceInstall } from './voiceStore'
import { useDictation } from './useDictation'

/**
 * Chat livre: conversa solta com um agente, sem card e sem alterar arquivos. Se a conversa virar um planejamento, o agente cria o
 * card (agentboard_criar_card) e este mesmo chat passa a ser o chat de planejamento dele; aí `onConverted` abre o card.
 */
export function FreeChat({ project, profiles, chat: start, close, onConverted, changed }: { project: Project; profiles: AgentProfile[]; chat?: Chat; close(): void; onConverted(cardId: string): void; changed(): void }): React.JSX.Element {
  const { expanded, setExpanded, width, dragging, startResize, resetWidth } = useDockSize()
  const [chat, setChat] = useState<Chat | undefined>(start), [messages, setMessages] = useState<ChatMessage[]>([]), [input, setInput] = useState(''), [live, setLive] = useState(''), [error, setError] = useState('')
  const [profileId, setProfileId] = useState(start?.profileId ?? profiles[0]?.id ?? ''), [busy, setBusy] = useState(Boolean(start?.busy))
  const log = useRef<HTMLDivElement>(null), runId = useRef<string | undefined>(undefined), converted = useRef<string | undefined>(undefined)
  const dictation = useDictation(useCallback((text: string) => setInput((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}${text}`), []))
  const voiceReady = Boolean(dictation.status?.modelInstalled && dictation.status.engineInstalled)
  const load = useCallback(async (chatId: string) => setMessages(await window.agentboard.invoke('messages:list', { chatId })), [])
  useEffect(() => { if (start) void load(start.id).catch((reason: unknown) => setError(String(reason))) }, [start, load])
  useEffect(() => window.agentboard.onRunEvent((event) => {
    if (event.eventType === 'agentboard/tool-activity') { const id = String(event.payload.chatId ?? ''); setChat((current) => { if (current && current.id === id) void load(id); return current }); return }
    if (!runId.current || event.runId !== runId.current) return
    if (event.eventType === 'item/agentMessage/delta') setLive((value) => value + String(event.payload.delta ?? ''))
    if (event.eventType === 'agentboard/card-updated' && event.payload.type === 'converted') converted.current = String(event.payload.cardId)
    if (event.eventType === 'agentboard/run-completed') {
      runId.current = undefined; setBusy(false); setLive(''); changed()
      setChat((current) => { if (current) void load(current.id); return current })
      if (converted.current) onConverted(converted.current)
    }
  }), [load, changed, onConverted])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [messages, live])
  const send = async (): Promise<void> => {
    const prompt = input.trim(); if (!prompt || busy) return
    try {
      setError(''); setInput('')
      let current = chat
      if (!current) { if (!profileId) throw new Error('Escolha um agente'); current = await window.agentboard.invoke('chats:create', { projectId: project.id, cardId: null, purpose: 'free', profileId }); setChat(current) }
      const started = await window.agentboard.invoke('agents:start', { chatId: current.id, prompt, planning: true })
      runId.current = started.id; setBusy(true); setLive(''); await load(current.id); changed()
    } catch (reason) { setError(String(reason).replace(/^Error: /, '')); setInput(prompt) }
  }
  const stop = async (): Promise<void> => { if (runId.current) await window.agentboard.invoke('agents:cancel', { runId: runId.current }).catch((reason: unknown) => setError(String(reason))) }
  const typed = useTypewriter(live), busySince = useBusySince(busy)
  const agent = profiles.find((item) => item.id === profileId)
  return <section className={`dock open ${expanded ? 'full' : ''} ${dragging ? 'dragging' : ''}`} aria-label="Chat livre" style={expanded ? undefined : { width }}>
    {!expanded && <div className="dockgrip" role="separator" aria-orientation="vertical" aria-label="Ajustar a largura do chat" onPointerDown={startResize} onDoubleClick={resetWidth} />}
    <div className="dock-in" style={expanded ? undefined : { width }}>
      <div className="dock-head"><div className="top"><div><div className="headrow"><div className="eyebrow">Chat livre</div></div><h2>{chat?.title || 'Conversa livre'}</h2><div className="ctxline"><span className="ctxchip">Sem card · sem execução</span></div></div>
        <div className="dock-tools"><button type="button" className="ibtn tip" data-tip={expanded ? 'Voltar para o canto' : 'Expandir em tela cheia'} aria-label={expanded ? 'Voltar para o canto' : 'Expandir em tela cheia'} onClick={() => setExpanded(!expanded)}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button><button className="x" aria-label="Fechar chat" onClick={close}><CloseIcon /></button></div></div></div>
      <div className="chatlog" ref={log}>
        {!messages.length && !live && <div className="msg sys">Chat livre: conversa solta, não altera arquivos nem cards. Se virar um planejamento, peça e eu crio o card aqui mesmo.</div>}
        {messages.map((m) => <ChatMessageView key={m.id} message={m} />)}
        {live && <div className="msg agent"><div className="md chatmd"><Markdown source={typed} /><span className="caret" /></div></div>}
        {busy && <ThinkingIndicator purpose="free" messages={messages} since={busySince} />}
      </div>
      <div className="composer">
        {(error || dictation.error) && <p className="error">{error || dictation.error}</p>}
        <div className="cbox">
          <textarea rows={1} aria-label="Mensagem para o agente" value={input} placeholder={dictation.recording ? 'Ouvindo…' : 'Converse sobre qualquer coisa…'} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
          {dictation.recording && <span className="wave"><i /><i /><i /><i /><i /><i /><i /></span>}
          {busy ? <button type="button" className="sendbtn stop tip" data-tip="Parar" aria-label="Parar" onClick={() => void stop()}><StopIcon /></button> : <button type="button" className="sendbtn tip" data-tip="Enviar (Enter)" aria-label="Enviar" hidden={!input.trim()} onClick={() => void send()}><SendIcon /></button>}
          <button type="button" className={`micbtn tip ${dictation.recording ? 'on' : ''}`} data-tip={dictation.recording ? 'Parar de ouvir' : dictation.transcribing ? 'Transcrevendo…' : voiceReady ? 'Ditar por voz' : 'Instalar o ditado por voz'} aria-label="Ditar por voz" aria-pressed={dictation.recording} disabled={dictation.transcribing || !dictation.status} onClick={() => (voiceReady ? void dictation.toggle() : void startVoiceInstall())}>{dictation.transcribing ? <span className="spin sm" /> : <MicIcon />}</button>
        </div>
        <div className="cmeta"><span className="mode tip" data-tip="Conversa solta: não altera arquivos nem cards">✦ Só conversar</span>
          <div className="pick">{chat ? (agent && <span className="agentchip"><AgentIcon profile={agent} size="sm" />{agent.label}</span>) : <Select label="Agente" up options={profiles.map((item) => ({ value: item.id, label: item.label, icon: <AgentIcon profile={item} tip={false} />, sub: item.provider === 'codex' ? 'Codex' : 'Claude' }))} value={profileId} onChange={setProfileId} />}</div>
        </div>
      </div>
    </div>
  </section>
}
