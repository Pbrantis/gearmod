import { providerLabels } from '@agentboard/contracts'
import { AgentBackground } from './AgentBackground'
import { AgentPermissions } from './AgentPermissions'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dropToken, InputMirror, useAtMention } from './AtMention'
import { defaultPermissionMode, permissionModes, type AgentProfile, type Chat, type ChatMessage, type Effort, type PermissionMode, type Project } from '@agentboard/contracts'
import { PopMenu } from './PopMenu'
import { ChatSearch, useChatSearchShortcut } from './ChatSearch'
import { ChatMoreMenu, useDockSize } from './CardChat'
import { CheckIcon, CloseIcon, CollapseIcon, ExpandIcon, MicIcon, SendIcon, StopIcon } from './icons'
import { Select } from './Select'
import { ConfirmDialog } from './ConfirmDialog'
import { AgentIcon } from './AgentIcon'
import { ModelMenu, permissionModeText, useAgentConfig } from './ModelMenu'
import { useFitInView } from './useFitInView'
import { ChatMessageList } from './ChatMessageView'
import { FileOpenContext } from './markdown'
import { AgentMessage, QuestionAnswerContext } from './AgentMessage'
import { ViewGrip, useFileViewer } from './FileViewer'
import { FocusedFile } from './editor/FocusedFile'
import { UsageRings } from './UsageRings'
import { QueuedPreview, useQueuedMessage } from './QueuedMessage'
import { AttachButton, AttachmentChips, useAttachments, useContextText } from './Attachments'
import { ChatReplySelection, ReplyContextCards, useChatReplies } from './ChatReplies'
import { withChatReplies } from './chatReplyContext'
import { ThinkingIndicator, useBusySince, useTypewriter } from './Thinking'
import { startVoiceInstall } from './voiceStore'
import { useDictation } from './useDictation'
import { useStickToBottom } from './useStickToBottom'
import { pop } from './popout'
import { plainError } from './NoticeDialog'
import { useT } from './i18n'

type Saved = { profileId: string; model: string | null; effort: Effort | null; mode: PermissionMode }
const savedKey = (projectId: string): string => `agentboard.freeChatAgent.${projectId}`
const readSaved = (projectId: string): Saved | null => { try { return JSON.parse(localStorage.getItem(savedKey(projectId)) ?? 'null') as Saved | null } catch { return null } }

/**
 * Chat livre: conversa solta com um agente, sem card e sem alterar arquivos. Se a conversa virar um planejamento, o agente cria o
 * card (agentboard_criar_card) e este mesmo chat passa a ser o chat de planejamento dele; aí `onConverted` abre o card.
 * Com `mode="constitution"` é o chat da Constituição do projeto; `prompt` já envia o primeiro pedido ao abrir.
 */
export function FreeChat({ project, profiles, chat: start, close, onConverted, changed, mode = 'free', prompt: firstPrompt }: { project: Project; profiles: AgentProfile[]; chat?: Chat; close(): void; onConverted(cardId: string): void; changed(): void; mode?: 'free' | 'constitution'; prompt?: string }): React.JSX.Element {
  const t = useT(), d = t.chat.dock, f = t.chat.freeChat
  const text = f.modes[mode]
  const { expanded, setExpanded, width, setWidth, dragging, startResize, resetWidth } = useDockSize()
  const chatSearch = useChatSearchShortcut(expanded)
  useEffect(() => { const navigate = (): void => { if (expanded) close() }; window.addEventListener('agentboard:select-view', navigate); return () => window.removeEventListener('agentboard:select-view', navigate) }, [expanded, close])
  const [chat, setChat] = useState<Chat | undefined>(start), [messages, setMessages] = useState<ChatMessage[]>([]), [input, setInput] = useState(''), [live, setLive] = useState(''), [error, setError] = useState('')
  const saved = useMemo(() => (mode === 'free' ? readSaved(project.id) : null), [project.id, mode])
  const [profileId, setProfileId] = useState(start?.profileId ?? (saved && profiles.some((item) => item.id === saved.profileId) ? saved.profileId : undefined) ?? profiles[0]?.id ?? ''), [busy, setBusy] = useState(Boolean(start?.busy))
  const log = useRef<HTMLDivElement>(null), runId = useRef<string | undefined>(undefined), converted = useRef<string | undefined>(undefined)
  const agentState = useAgentConfig('', 'execution', profiles, profileId || undefined), agentConfig = mode === 'free' ? agentState.config : undefined
  const restored = useRef(false)
  // Volta a configuração escolhida da última vez (modelo, esforço e modo) assim que as opções do agente chegam.
  useEffect(() => {
    if (mode !== 'free' || restored.current || !agentState.config || !agentState.options) return
    restored.current = true
    if (saved && saved.profileId === agentState.config.profileId) void agentState.update({ model: saved.model, effort: saved.effort, mode: saved.mode })
  }, [agentState.config, agentState.options])
  useEffect(() => { if (mode === 'free' && restored.current && agentState.config) { try { localStorage.setItem(savedKey(project.id), JSON.stringify({ profileId: agentState.config.profileId, model: agentState.config.model, effort: agentState.config.effort, mode: agentState.config.mode })) } catch { /* só vale nesta sessão */ } } }, [agentState.config])
  const readOnly = mode === 'constitution' || agentConfig?.mode === 'plan'
  // Trocar o agente de um chat que já começou abre uma conversa nova com o outro agente (a atual continua salva em Chats).
  const [switchTo, setSwitchTo] = useState<AgentProfile>()
  useEffect(() => { if (agentState.config && agentState.config.profileId !== profileId && !chat) setProfileId(agentState.config.profileId) }, [agentState.config?.profileId])
  const restartWith = (target: AgentProfile): void => {
    setSwitchTo(undefined); setChat(undefined); setMessages([]); setLive(''); setError(''); setBusy(false); runId.current = undefined; setProfileId(target.id); replies.clear()
    void agentState.update({ profileId: target.id, model: null, effort: null, mode: defaultPermissionMode(target.provider, 'execution') })
  }
  const [modeMenu, setModeMenu] = useState(false), modeBox = useRef<HTMLSpanElement>(null), modeMenuBox = useRef<HTMLDivElement>(null)
  const modeProvider = profiles.find((item) => item.id === agentConfig?.profileId)?.provider ?? 'claude', modeList = permissionModes[modeProvider], currentMode = modeList.find((item) => item.id === agentConfig?.mode)
  useFitInView(modeMenuBox, modeMenu)
  useEffect(() => {
    if (!modeMenu) return
    const away = (event: PointerEvent): void => { if (!modeBox.current?.contains(event.target as Node)) setModeMenu(false) }
    const esc = (event: KeyboardEvent): void => { if (event.key === 'Escape') setModeMenu(false) }
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [modeMenu])
  const attach = useAttachments({ projectId: project.id, cardId: null })
  const replies = useChatReplies()
  const mention = useAtMention({ projectId: project.id, cardId: null, input, setInput })
  useContextText({ projectId: project.id, cardId: null }, (text) => setInput((value) => (value.trim() ? `${value.replace(/\s+$/, '')}\n\n${text}` : text)))
  const dictation = useDictation(useCallback((text: string) => setInput((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}${text}`), []))
  const voiceReady = Boolean(dictation.status?.modelInstalled && dictation.status.engineInstalled)
  const load = useCallback(async (chatId: string) => setMessages(await window.agentboard.invoke('messages:list', { chatId })), [])
  useEffect(() => { if (start) void load(start.id).catch((reason: unknown) => setError(plainError(reason))) }, [start, load])
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
  useStickToBottom(log)
  const deliver = async (prompt: string, queuedFiles?: string[]): Promise<void> => {
    const files = queuedFiles ?? attach.take()
    try {
      setError('')
      let current = chat
      if (!current) { if (!profileId) throw new Error(t.chat.cardChat.chooseAgent); current = await window.agentboard.invoke('chats:create', { projectId: project.id, cardId: null, purpose: mode, profileId }); setChat(current) }
      const started = await window.agentboard.invoke('agents:start', { chatId: current.id, prompt, planning: readOnly, attachments: files.length ? files : undefined, choice: agentConfig ? { model: agentConfig.model, effort: agentConfig.effort, mode: agentConfig.mode } : undefined })
      runId.current = started.id; setBusy(true); setLive(''); await load(current.id); changed()
    } catch (reason) { setError(plainError(reason)); const restored = replies.restore(prompt); setInput((value) => [restored, value].filter(Boolean).join('\n\n')); attach.add(files) }
  }
  const cancel = async (): Promise<void> => { if (runId.current) await window.agentboard.invoke('agents:cancel', { runId: runId.current }).catch((reason: unknown) => setError(plainError(reason))) }
  const later = useQueuedMessage(busy, deliver)
  // Pedido que veio de fora (ex.: aplicar uma mudança sugerida na Constituição): envia uma vez ao abrir.
  const sentFirst = useRef(false)
  useEffect(() => { if (firstPrompt && !sentFirst.current && profileId) { sentFirst.current = true; if (busy) later.queue(firstPrompt); else void deliver(firstPrompt) } }, [firstPrompt, profileId])
  const send = async (): Promise<void> => {
    const prompt = withChatReplies(input, replies.items) || (attach.files.length ? 'Veja os arquivos anexados.' : ''); if (!prompt) return
    if (prompt.length + (busy && later.queued ? later.queued.length + 2 : 0) > 100_000) { setError(d.messageTooLong); return }
    setInput(''); replies.clear()
    if (busy) later.queue(prompt, attach.take()); else await deliver(prompt)
  }
  const stop = async (): Promise<void> => { later.markStopped(); await cancel() }
  const detachChat = async (point: { x: number; y: number }): Promise<void> => {
    if (!chat?.id || pop) return
    try { await window.agentboard.invoke('windows:open', { kind: 'chat', projectId: project.id, chatId: chat.id, placement: 'new', ...point }); close() } catch (reason) { setError(plainError(reason)) }
  }
  // Respostas das perguntas do agente voltam como mensagem normal (na fila, se ele ainda estiver trabalhando).
  const answerQuestions = (text: string): void => { if (busy) later.queue(text); else void deliver(text) }
  const viewer = useFileViewer(width, setWidth), viewing = !expanded && viewer.requested !== null
  const openFile = useCallback((path: string) => { setExpanded(false); viewer.open(path) }, [viewer.open])
  const typed = useTypewriter(live), busySince = useBusySince(busy)
  const agent = profiles.find((item) => item.id === profileId)
  return <section ref={chatSearch.ref} className={`dock open ${expanded ? 'full' : ''} ${viewing ? 'withviewer' : ''} ${dragging || viewer.dragging ? 'dragging' : ''}`} aria-label={text.eyebrow} style={expanded ? undefined : { width: width + (viewing ? viewer.width : 0) }}>
    {viewer.dialog}{!expanded && <div className="dockgrip" role="separator" aria-orientation="vertical" aria-label={viewing ? d.adjustFileWidth : d.adjustChatWidth} onPointerDown={viewing ? viewer.startResize : startResize} onDoubleClick={viewing ? undefined : resetWidth} />}
    {viewing && viewer.request && <><FocusedFile projectId={project.id} cardId={null} chatId={chat?.id} request={viewer.request} close={viewer.close} setDirty={viewer.setDirty} style={{ width: viewer.width }} /><ViewGrip viewer={viewer} /></>}
    <FileOpenContext.Provider value={openFile}><QuestionAnswerContext.Provider value={answerQuestions}>
    <div className="dock-in" style={expanded ? undefined : { width }}>
      <div className="dock-head" draggable={Boolean(chat?.id) && !pop} onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest('button,input,textarea,.dock-tools')) setExpanded(!expanded) }} onDragStart={(event) => { if ((event.target as HTMLElement).closest('button,input,textarea,.dock-tools')) { event.preventDefault(); return }; event.preventDefault(); void detachChat({ x: Math.round(event.screenX), y: Math.round(event.screenY) }) }}><div className="top"><div><div className="headrow"><div className="eyebrow">{text.eyebrow}</div></div><h2>{mode === 'constitution' ? text.title : chat?.title || text.title}</h2><div className="ctxline"><span className="ctxchip">{text.chip}</span></div></div>
        <div className="dock-tools"><div className="dock-tools-wide"><ChatSearch messages={messages} log={log} request={chatSearch.request} />{chat?.id && <PopMenu target={{ kind: 'chat', projectId: project.id, chatId: chat.id }} />}<button type="button" className="ibtn tip" data-tip={expanded ? d.backToCorner : d.expandFull} aria-label={expanded ? d.backToCorner : d.expandFull} onClick={() => setExpanded(!expanded)}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button><button className="x" aria-label={d.closeChat} onClick={close}><CloseIcon /></button></div><div className="dock-tools-compact"><ChatMoreMenu searchRequest={chatSearch.request} messages={messages} log={log} projectId={project.id} chatId={chat?.id} expand={() => setExpanded(true)} close={close} /><button className="x" aria-label={d.closeChat} onClick={close}><CloseIcon /></button></div></div></div></div>
      <div className="chatlog" ref={log}>
        {!messages.length && !live && <div className="msg sys">{text.empty}</div>}
        <ChatMessageList messages={messages} busy={busy} />
        <AgentPermissions chatId={chat?.id} />
        {live && <div className="msg agent"><div className="md chatmd"><AgentMessage source={typed} live /><span className="caret" /></div></div>}
        {busy && <ThinkingIndicator purpose="free" messages={messages} since={busySince} />}
      </div>
      <ChatReplySelection log={log} scope={`${project.id}:${mode}:${chat?.id ?? ''}`} add={(reply) => { replies.add(reply); mention.ref.current?.focus() }} />
      <div className="composer">
        {(error || dictation.error) && <p className="error">{error || dictation.error}</p>}
        {later.queued && <QueuedPreview text={later.queued} files={later.files} busy={busy} sendNow={() => later.sendNow(cancel)} edit={() => { const item = later.take(), text = replies.restore(item.text); setInput((value) => `${text}${value ? `\n${value}` : ''}`); attach.add(item.files) }} discard={later.discard} />}
        <div className={`cbox ${attach.dragging ? 'dropping' : ''}`} {...attach.dropProps}>
          {(attach.files.length > 0 || replies.items.length > 0) && <div className="cbox-top"><AttachmentChips files={attach.files} remove={attach.remove} /><ReplyContextCards replies={replies.items} remove={replies.remove} /></div>}
          <AttachButton onClick={() => void attach.choose()} />
          {mention.menu}<div className="hlwrap"><InputMirror text={input} skillNames={[]} area={mention.ref} /><textarea rows={1} aria-label={d.messageToAgent} value={input} placeholder={dictation.recording ? d.listening : text.placeholder} ref={mention.ref} onSelect={(e) => mention.caret(e.currentTarget.selectionStart)} onChange={(e) => { setInput(e.target.value); mention.caret(e.target.selectionStart) }} onKeyDown={(e) => { if (mention.keyDown(e)) return; const dropped = dropToken(e, input, []); if (dropped) { e.preventDefault(); setInput(dropped.text); mention.caret(dropped.at); window.requestAnimationFrame(() => mention.ref.current?.setSelectionRange(dropped.at, dropped.at)); return }; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} /></div>
          {dictation.recording && <span className="wave"><i /><i /><i /><i /><i /><i /><i /></span>}
          {busy && <button type="button" className="sendbtn stop tip" data-tip={d.stop} aria-label={d.stop} onClick={() => void stop()}><StopIcon /></button>}<button type="button" className="sendbtn tip" data-tip={busy ? d.queueTip : d.sendTip} aria-label={busy ? d.queue : d.send} hidden={!input.trim() && !replies.items.length && !attach.files.length} onClick={() => void send()}><SendIcon /></button>
          <button type="button" className={`micbtn tip ${dictation.recording ? 'on' : ''}`} data-tip={dictation.recording ? d.stopListening : dictation.transcribing ? d.transcribing : voiceReady ? d.dictate : f.installDictation} aria-label={d.dictate} aria-pressed={dictation.recording} disabled={dictation.transcribing || !dictation.status} onClick={() => (voiceReady ? void dictation.toggle() : void startVoiceInstall())}>{dictation.transcribing ? <span className="spin sm" /> : <MicIcon />}</button>
        </div>
        <div className="cmeta">{mode === 'free' && agentConfig ? <span className="modewrap" ref={modeBox}><button type="button" className={`modechip ${modeMenu ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={modeMenu} data-tip={readOnly ? f.readOnlyTip : f.canEditTip} onClick={() => setModeMenu(!modeMenu)}>{currentMode ? permissionModeText(modeProvider, currentMode).label : d.mode}</button>
            {modeMenu && <div className="modemenu" role="menu" ref={modeMenuBox}><div className="mm-title">{d.mode}</div>{modeList.map((item, index) => <button type="button" role="menuitem" key={item.id} disabled={item.needsApprovalUi} data-tip={item.needsApprovalUi ? d.needsApproval : undefined} className="modeopt" onClick={() => { setModeMenu(false); void agentState.update({ mode: item.id }) }}><span className="mo-t"><b>{permissionModeText(modeProvider, item).label}</b>{item.recommended && <em>{d.recommended}</em>}<small>{permissionModeText(modeProvider, item).description}</small></span><span className="mo-r">{agentConfig.mode === item.id ? <CheckIcon /> : index + 1}</span></button>)}</div>}</span>
          : <span className="mode tip" data-tip={text.badgeTip}>{text.badge}</span>}
          <div className="pick"><AgentBackground chatId={chat?.id} /><UsageRings profileId={agentConfig?.profileId ?? chat?.profileId ?? profileId} />{agentConfig ? <ModelMenu profiles={profiles} purpose="execution" state={agentState} lockProfile={Boolean(chat)} onLockedPick={setSwitchTo} /> : chat ? (agent && <span className="agentchip"><AgentIcon profile={agent} size="sm" />{agent.label}</span>) : <Select label={t.common.agent} up options={profiles.map((item) => ({ value: item.id, label: item.label, icon: <AgentIcon profile={item} tip={false} />, sub: providerLabels[item.provider] }))} value={profileId} onChange={setProfileId} />}</div>
        </div>
      </div>
    </div>
    {switchTo && <ConfirmDialog eyebrow={d.switchAgent} title={f.chatWith(switchTo.label)} text={f.openNewText} ok={f.openNew} cancel={() => setSwitchTo(undefined)} confirm={() => restartWith(switchTo)} />}
    </QuestionAnswerContext.Provider></FileOpenContext.Provider>
  </section>
}
