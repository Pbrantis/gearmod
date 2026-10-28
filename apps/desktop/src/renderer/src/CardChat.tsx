import { AgentPermissions } from './AgentPermissions'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAtMention } from './AtMention'
import { defaultPermissionMode, permissionModes, type AgentProfile, type AgentPurpose, type Card, type Chat, type ChatMessage, type Project, type ProjectBoard, type Run, type SkillEntry, type SkillRef } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { ConfirmDialog } from './ConfirmDialog'
import { WindowIcon } from './WindowLayoutMenu'
import { BranchIcon, CheckIcon, CloseIcon, CollapseIcon, ExpandIcon, MicIcon, SendIcon, StopIcon } from './icons'
import { ModelMenu, useAgentConfig } from './ModelMenu'
import { AssessmentDialog, ComplexityBadge } from './Assessment'
import { worktreeName } from './workspace'
import { ChatMessageList } from './ChatMessageView'
import { FileOpenContext } from './markdown'
import { AgentMessage, QuestionAnswerContext } from './AgentMessage'
import { ViewGrip, useFileViewer } from './FileViewer'
import { FocusedFile } from './editor/FocusedFile'
import { UsageRings } from './UsageRings'
import { QueuedPreview, useQueuedMessage } from './QueuedMessage'
import { AttachButton, AttachmentChips, useAttachments, useContextText } from './Attachments'
import { ThinkingIndicator, useBusySince, useTypewriter } from './Thinking'
import { plainError } from './NoticeDialog'
import { ChangesCard } from './ChangesCard'
import { CommitAsks, DiffPane, GitCardPanel, type DiffTarget } from './GitCardPanel'
import { ProgressCard } from './ProgressCard'
import { PopMenu } from './PopMenu'
import { ChatSearch, searchMessages, snippet, useChatSearchShortcut } from './ChatSearch'
import { useFitInView } from './useFitInView'
import { terminal } from './terminalStore'
import { useDictation } from './useDictation'
import { useStickToBottom } from './useStickToBottom'
import { pop } from './popout'

/** Estado do dock que sobrevive à troca de aba (o chat remonta a cada etapa): recolhido/expandido e largura. */
const dockMin = 440
const stored = (): number => { try { return Number(localStorage.getItem('agentboard.dockWidth')) || dockMin } catch { return dockMin } }
const dockState = { expanded: true, width: stored() }
const clampWidth = (value: number): number => Math.max(dockMin, Math.min(Math.round(window.innerWidth * 0.65), value))

/** Recolhido/expandido e largura do dock, compartilhados entre o chat do card e o chat livre. */
export function useDockSize(): { expanded: boolean; setExpanded(value: boolean): void; width: number; setWidth(value: number): void; dragging: boolean; startResize(event: React.PointerEvent<HTMLDivElement>): void; resetWidth(): void } {
  const [expanded, setExpandedState] = useState(dockState.expanded), [width, setWidthState] = useState(() => clampWidth(dockState.width)), [dragging, setDragging] = useState(false)
  const setExpanded = (value: boolean): void => { dockState.expanded = value; setExpandedState(value) }
  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault(); setDragging(true)
    const move = (e: PointerEvent): void => { const next = clampWidth(window.innerWidth - e.clientX); dockState.width = next; setWidthState(next) }
    const up = (): void => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); setDragging(false); try { localStorage.setItem('agentboard.dockWidth', String(dockState.width)) } catch { /* só vale nesta sessão */ } }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up)
  }
  const setWidth = (value: number): void => { dockState.width = value; setWidthState(value); try { localStorage.setItem('agentboard.dockWidth', String(value)) } catch { /* só vale nesta sessão */ } }
  return { expanded, setExpanded, width, setWidth, dragging, startResize, resetWidth: () => { dockState.width = dockMin; setWidthState(dockMin) } }
}

const stepLabel: Record<AgentPurpose, string> = { planning: 'Planejamento', execution: 'Implementação', test: 'Teste' }
const typeColor: Record<Card['type'], string> = { feature: '#8fb8d6', bug: '#ff9d91', improvement: 'var(--accent-strong)', task: 'var(--muted)', minor: '#d9c27a' }

const SearchGlyph = (): React.JSX.Element => <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="M13.2 13.2L17 17" /></svg>

/** Ações do cabeçalho agrupadas quando o dock estreito não comporta todos os botões. */
export function ChatMoreMenu({ messages, log, projectId, cardId, chatId, purpose, expand, view, searchRequest = 0 }: { messages: ChatMessage[]; log: React.RefObject<HTMLDivElement | null>; projectId: string; cardId?: string; chatId?: string; purpose?: AgentPurpose; expand(): void; close(): void; view?: { git: boolean; set(value: 'chat' | 'git'): void }; searchRequest?: number }): React.JSX.Element {
  const [open, setOpen] = useState(false), [page, setPage] = useState<'main' | 'search' | 'window'>('main'), [query, setQuery] = useState('')
  const box = useRef<HTMLSpanElement>(null), input = useRef<HTMLInputElement>(null), menu = useRef<HTMLDivElement>(null), results = searchMessages(messages, query)
  useFitInView(menu, open)
  useEffect(() => { if (!searchRequest || !box.current?.getClientRects().length) return; setPage('search'); setOpen(true); window.setTimeout(() => { input.current?.focus(); input.current?.select() }, 0) }, [searchRequest])
  useEffect(() => {
    if (!open) return
    if (page === 'search') input.current?.focus()
    const away = (event: PointerEvent): void => { if (!box.current?.contains(event.target as Node)) { setOpen(false); setPage('main') } }
    const esc = (event: KeyboardEvent): void => { if (event.key === 'Escape') { setOpen(false); setPage('main') } }
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open, page])
  const dismiss = (): void => { setOpen(false); setPage('main') }
  const goMessage = (id: string): void => {
    if (view?.git) view.set('chat'); dismiss()
    window.setTimeout(() => {
      const target = [...(log.current?.querySelectorAll<HTMLElement>('[data-mid]') ?? [])].find((element) => element.dataset.mid === id)
      if (!target) return
      target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.add('searchhit'); window.setTimeout(() => target.classList.remove('searchhit'), 1800)
    }, view?.git ? 80 : 0)
  }
  const place = (placement: 'left' | 'right' | 'top' | 'bottom' | 'new'): void => {
    dismiss()
    if (pop) { if (placement !== 'new') void window.agentboard.invoke('windows:place', { placement }); return }
    if (cardId || chatId) void window.agentboard.invoke('windows:open', { kind: 'chat', projectId, ...(cardId ? { cardId, purpose } : {}), ...(chatId ? { chatId } : {}), placement })
  }
  return <span className="popwrap dockmore" ref={box}>
    <button type="button" className="ibtn morebtn" aria-label="Mais opções" aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open); setPage('main') }}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.35" /><circle cx="10" cy="10" r="1.35" /><circle cx="16" cy="10" r="1.35" /></svg></button>
    {open && <div className="popmenu dockmore-menu" ref={menu} role={page === 'search' ? 'dialog' : 'menu'} aria-label="Mais opções do chat">
      {page !== 'main' && <button type="button" className="pm-back" onClick={() => setPage('main')}>‹ <span>{page === 'search' ? 'Pesquisar' : pop ? 'Mover janela' : 'Abrir em outra janela'}</span></button>}
      {page === 'main' && <>
        {view && <button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => { dismiss(); view.set(view.git ? 'chat' : 'git') }}><BranchIcon />{view.git ? 'Voltar ao chat' : 'Ver Git do card'}</button>}
        <button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => setPage('search')}><SearchGlyph />Pesquisar no chat <small>Ctrl+F</small></button>
        {(cardId || chatId) && <button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => setPage('window')}><WindowIcon />{pop ? 'Mover esta janela' : 'Abrir em outra janela'}</button>}
        <button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => { dismiss(); expand() }}><ExpandIcon />Expandir em tela cheia</button>
      </>}
      {page === 'search' && <>
        <input ref={input} className="in" value={query} placeholder="Pesquisar no chat" aria-label="Pesquisar no chat" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && results[0]) goMessage(results[0].id) }} />
        <div className="cs-list">{query.trim().length < 2 ? <p className="ch-muted">Digite pelo menos 2 letras.</p> : !results.length ? <p className="ch-muted">Nada encontrado.</p> : results.slice(0, 40).map((message) => <button type="button" key={message.id} className="cs-item" onClick={() => goMessage(message.id)}><b>{message.role === 'user' ? 'Você' : message.role === 'assistant' ? 'Agente' : 'Sistema'}</b><span>{snippet(message.body, query.trim())}</span></button>)}</div>
      </>}
      {page === 'window' && <div className="pm-places">{(['left', 'right', 'top', 'bottom'] as const).map((placement) => <button type="button" role="menuitem" className="pm-item" key={placement} onClick={() => place(placement)}>{{ left: 'À esquerda', right: 'À direita', top: 'Em cima', bottom: 'Embaixo' }[placement]}</button>)}{!pop && <><div className="pm-sep" /><button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => place('new')}><WindowIcon />Abrir em nova janela</button></>}</div>}
    </div>}
  </span>
}

function Tile({ card, board, here, profiles, open }: { card: Card; board: ProjectBoard; here: boolean; profiles: AgentProfile[]; open(): void }): React.JSX.Element {
  const run = card.run.state, agent = profiles.find((profile) => profile.id === (card.run.profileId ?? card.execProfileId))
  const state = board.columns.find((column) => column.id === card.columnId)
  const ready = run === 'idle' && card.hasPlan && (state?.semanticState === 'backlog' || state?.semanticState === 'todo')
  const status = card.planningOpen ? <><span className="dot" style={{ color: '#b9b9f0' }} /><small>Em planejamento</small></> : run === 'running' ? <><span className="spin sm" /><small>Executando</small></> : run === 'planning' ? <><span className="dot pulse" style={{ color: '#b9b9f0' }} /><small>Planejando</small></> : ready ? <><span className="dot softpulse" style={{ color: 'var(--accent-strong)' }} /><small>Plano pronto</small></> : run === 'finished' ? <><span className="dot pulse" style={{ color: 'var(--accent)' }} /><small>Terminou</small></> : run === 'paused' ? <small style={{ color: 'var(--warn)' }}>Pausado</small> : <small>{state?.label}</small>
  return <button type="button" className={`tile ${run === 'running' ? 'run' : ''} ${run === 'planning' ? 'plan' : ''} ${here ? 'here' : ''}`} onClick={open}><span className="tdot" style={{ background: typeColor[card.type] }} /><span className="ttl">{card.title || 'Novo card'}</span><span className="tfoot">{agent ? <AgentIcon profile={agent} size="sm" /> : <i />}<span className="tst">{status}</span></span></button>
}

/** Visão rápida (protótipo): o que está executando agora e os demais cards, com o estado de cada um. */
function Activity({ board, cardId, profiles, openEdit, hide }: { board: ProjectBoard; cardId: string; profiles: AgentProfile[]; openEdit(card: Card): void; hide(): void }): React.JSX.Element {
  const cards = board.cards.filter((card) => !card.archivedAt), running = cards.filter((card) => card.run.state === 'running')
  const rank = (card: Card): number => card.id === cardId ? 0 : card.run.state === 'finished' ? 0.5 : card.run.state === 'planning' ? 1 : card.hasPlan && card.run.state === 'idle' ? 2 : 3 + board.columns.findIndex((column) => column.id === card.columnId)
  const rest = cards.filter((card) => card.run.state !== 'running').sort((a, b) => rank(a) - rank(b))
  return <section className="activity"><div className="qv-head"><div className="eyebrow">Visão rápida</div><button type="button" className="ch-icon tip" data-tip="Ocultar visão rápida" aria-label="Ocultar visão rápida" onClick={hide}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6M15 4v12" /></svg></button></div>
    <div className="agrp"><span>Executando</span><b>{running.length}</b></div>
    <div className="tilecol">{running.length ? running.map((card) => <Tile key={card.id} card={card} board={board} here={card.id === cardId} profiles={profiles} open={() => openEdit(card)} />) : <div className="emptyact">Nada executando agora.</div>}</div>
    <div className="agrp"><span>Demais cards</span><b>{rest.length}</b></div>
    <div className="tilecol">{rest.map((card) => <Tile key={card.id} card={card} board={board} here={card.id === cardId} profiles={profiles} open={() => openEdit(card)} />)}</div>
  </section>
}

/** Chat do card (planejamento ou execução) como o dock do protótipo: encaixado à direita ou em tela cheia com a visão rápida. */
export function CardChat({ project, card, board, profiles, columnLabel, mode, close, openEdit, onSwitch, ensureCard, initialView = 'chat', openRules, openGraph }: { initialView?: 'chat' | 'git'; openRules?(): void; openGraph?(cardId: string): void; project: Project; card: Card; board: ProjectBoard; profiles: AgentProfile[]; columnLabel: string; mode: AgentPurpose; close(): void; openEdit(card: Card): void; onSwitch(purpose: AgentPurpose): void; ensureCard?(): Promise<Card> }): React.JSX.Element {
  const usable = profiles.filter((profile) => project.allowedProfileIds.includes(profile.id))
  const [assessing, setAssessing] = useState(false), [chat, setChat] = useState<Chat>(), [messages, setMessages] = useState<ChatMessage[]>([]), [run, setRun] = useState<Run>(), [live, setLive] = useState('')
  const [input, setInput] = useState(''), [error, setError] = useState(''), [skills, setSkills] = useState<SkillEntry[]>([]), [skill, setSkill] = useState<SkillRef | null>(null)
  const [menu, setMenu] = useState<'mode' | 'skill' | null>(null), [voiceSetup, setVoiceSetup] = useState(false)
  const log = useRef<HTMLDivElement>(null), runId = useRef<string | undefined>(undefined), wrap = useRef<HTMLDivElement>(null)
  const [chats, setChats] = useState<Chat[]>([])
  // Tarefa pequena tem um agente e um chat só (planeja, executa e valida): a aba não distingue etapas.
  const singleChat = card.type === 'minor' && chats.length <= 1
  // Depois que esse agente já mexeu na worktree (ou o card saiu do planejamento), o chat é completo (altera arquivos, mostra Alterações, testes e Git), mesmo sendo o chat que nasceu como planejamento.
  const columnState = board.columns.find((column) => column.id === card.columnId)?.semanticState
  const fullAgent = singleChat && (Boolean(card.workspace) || columnState === 'doing' || columnState === 'test' || columnState === 'done')
  const planning = mode === 'planning' && !fullAgent
  const [view, setView] = useState<'chat' | 'git'>(initialView), [diff, setDiff] = useState<DiffTarget>()
  const gitView = view === 'git' && Boolean(card.id) && !planning
  const { expanded, setExpanded, width, setWidth, dragging, startResize, resetWidth } = useDockSize()
  const chatSearch = useChatSearchShortcut(expanded)
  useEffect(() => { const navigate = (): void => { if (expanded) close() }; window.addEventListener('agentboard:select-view', navigate); return () => window.removeEventListener('agentboard:select-view', navigate) }, [expanded, close])
  const [quickHidden, setQuickHiddenState] = useState(() => { try { return localStorage.getItem('agentboard.quickView.hidden') === '1' } catch { return false } })
  const setQuickHidden = (value: boolean): void => { setQuickHiddenState(value); try { localStorage.setItem('agentboard.quickView.hidden', value ? '1' : '0') } catch { /* só conveniência */ } }
  useEffect(() => { if (!card.id) return; terminal.setContext({ projectId: project.id, cardId: card.id }); return () => terminal.setContext({ projectId: project.id, cardId: null }) }, [card.id, project.id])
  const viewer = useFileViewer(width, setWidth)
  const openFile = useCallback((path: string) => { setExpanded(false); viewer.open(path) }, [viewer.open])
  const [switchTo, setSwitchTo] = useState<AgentProfile>()
  const agentState = useAgentConfig(card.id, mode, usable, chat?.profileId)
  const attach = useAttachments({ projectId: project.id, cardId: card.id || null })
  const mention = useAtMention({ projectId: project.id, cardId: card.id || null, input, setInput })
  useContextText({ projectId: project.id, cardId: card.id || null }, (text) => setInput((value) => (value.trim() ? `${value.replace(/\s+$/, '')}\n\n${text}` : text)))
  const dictation = useDictation(useCallback((text: string) => setInput((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}${text}`), []), card.title || undefined)
  const voiceReady = Boolean(dictation.status?.modelInstalled && dictation.status.engineInstalled)
  const loadMessages = useCallback(async (chatId: string) => setMessages(await window.agentboard.invoke('messages:list', { chatId })), [])
  useEffect(() => { if (card.id) void window.agentboard.invoke('cards:mark-viewed', { cardId: card.id }).catch(() => undefined) }, [card.id])
  useEffect(() => { if (!card.id) return; void window.agentboard.invoke('chats:list', { projectId: project.id, cardId: card.id }).then((items) => { setChats(items); const found = items.find((item) => item.purpose === mode); if (found) { setChat(found); void loadMessages(found.id) } }).catch((reason: unknown) => setError(String(reason))) }, [project.id, card.id, mode, loadMessages])
  useEffect(() => window.agentboard.onRunEvent((event) => {
    if (event.eventType === 'agentboard/tool-activity') { const id = String(event.payload.chatId ?? ''); setChat((current) => { if (current && current.id === id) void loadMessages(id); return current }); return }
    if (event.runId !== runId.current) return
    if (event.eventType === 'item/agentMessage/delta') setLive((value) => value + String(event.payload.delta ?? ''))
    if (event.eventType === 'agentboard/run-completed') { runId.current = undefined; setRun(undefined); setLive(''); setChat((current) => { if (current) void loadMessages(current.id); return current }); void window.agentboard.invoke('cards:mark-viewed', { cardId: card.id }).catch(() => undefined) }
  }), [card.id, loadMessages])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [messages, live])
  useStickToBottom(log)
  useEffect(() => { void Promise.all([window.agentboard.invoke('skills:list', { scope: 'global' }), window.agentboard.invoke('skills:list', { scope: 'project', projectId: project.id })]).then(([global, local]) => setSkills([...local, ...global])).catch(() => undefined) }, [project.id])
  useEffect(() => { setSkill(chat?.skill ?? null) }, [chat?.id, chat?.skill])
  useEffect(() => {
    if (!menu) return
    const close = (event: Event): void => { if (!wrap.current?.contains(event.target as Node)) setMenu(null) }
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const provider = usable.find((item) => item.id === (agentState.config?.profileId ?? chat?.profileId))?.provider
  const available = skills.filter((item) => provider && item.paths[provider])
  const chooseSkill = async (next: SkillRef | null): Promise<void> => { setMenu(null); try { setError(''); if (chat) setChat(await window.agentboard.invoke('chats:set-skill', { chatId: chat.id, skill: next })); setSkill(next) } catch (reason) { setError(String(reason)) } }
  const deliver = async (prompt: string, queuedFiles?: string[]): Promise<void> => {
    const files = queuedFiles ?? attach.take()
    if (inactive) { setError(`O agente ${inactive.label.replace(' (desativado)', '')} foi removido e não pode mais executar. Reinicie o chat com outro agente.`); attach.add(files); return }
    try {
      setError('')
      let current = chat
      const chosen = agentState.config?.profileId
      let cardId = card.id
      // Planejamento começado sem card: ele só nasce agora, na primeira mensagem, para o chat ter a que se referir.
      if (!cardId) {
        if (!ensureCard) throw new Error('Card não encontrado')
        cardId = (await ensureCard()).id
        if (agentState.touched && agentState.config) await window.agentboard.invoke('cards:set-agent-config', { cardId, purpose: mode, config: agentState.config })
      }
      if (!current) { if (!chosen) throw new Error('Escolha um agente'); current = await window.agentboard.invoke('chats:create', { projectId: project.id, cardId, purpose: mode, profileId: chosen, skill }); setChat(current) }
      const started = await window.agentboard.invoke('agents:start', { chatId: current.id, prompt, planning, attachments: files.length ? files : undefined })
      runId.current = started.id; setRun(started); setLive(''); await loadMessages(current.id)
    } catch (reason) { setError(String(reason).replace(/^Error: /, '')); setInput(prompt); attach.add(files) }
  }
  const cancel = async (): Promise<void> => { const id = run?.id ?? card.run.runId; if (id) await window.agentboard.invoke('agents:cancel', { runId: id }).catch((reason: unknown) => setError(String(reason))) }
  const send = async (): Promise<void> => {
    const prompt = input.trim() || (attach.files.length ? 'Veja os arquivos anexados.' : ''); if (!prompt) return
    setInput('')
    if (busy) later.queue(prompt, attach.take()); else await deliver(prompt)
  }
  const stop = async (): Promise<void> => { later.markStopped(); await cancel() }
  // Respostas das perguntas do agente voltam como mensagem normal (na fila, se ele ainda estiver trabalhando).
  const answerQuestions = (text: string): void => { if (busy) later.queue(text); else void deliver(text) }
  /** Comentário feito sobre o diff é feedback de implementação: sempre segue para o desenvolvedor. */
  const sendReview = async (text: string): Promise<boolean> => {
    if (mode === 'execution') { answerQuestions(text); setDiff(undefined); setView('chat'); return true }
    if (!card.id) return false
    try {
      setError('')
      const currentChats = await window.agentboard.invoke('chats:list', { projectId: project.id, cardId: card.id })
      let developer = currentChats.find((item) => item.purpose === 'execution')
      if (developer?.busy) throw new Error('O desenvolvedor já está trabalhando. Aguarde ele terminar para enviar este comentário.')
      if (!developer) {
        const config = (await window.agentboard.invoke('cards:agent-config', { cardId: card.id })).execution
        if (!config) throw new Error('Escolha um agente de implementação antes de comentar no diff.')
        developer = await window.agentboard.invoke('chats:create', { projectId: project.id, cardId: card.id, purpose: 'execution', profileId: config.profileId })
      }
      await window.agentboard.invoke('agents:start', { chatId: developer.id, prompt: text, planning: false })
      setDiff(undefined); setView('chat'); onSwitch('execution'); return true
    } catch (reason) { setError(plainError(reason)); return false }
  }
  const detachChat = async (point: { x: number; y: number }): Promise<void> => {
    if (!card.id || pop) return
    try { await window.agentboard.invoke('windows:open', { kind: 'chat', projectId: project.id, cardId: card.id, purpose: mode, placement: 'new', ...point }); close() } catch (reason) { setError(plainError(reason)) }
  }
  // Atalhos do modo teste, acima da caixa de conversa: cada botão manda um pedido pronto ao testador (entra na fila se ele estiver ocupado).
  const [headed, setHeaded] = useState(() => { try { return localStorage.getItem('agentboard.testHeaded') === '1' } catch { return false } })
  const toggleHeaded = (): void => { const next = !headed; setHeaded(next); try { localStorage.setItem('agentboard.testHeaded', next ? '1' : '0') } catch { /* só vale nesta sessão */ } }
  const testShortcuts = mode === 'test' ? [
    { label: 'Rodar testes do projeto', prompt: 'Rode os testes, o lint e o typecheck do projeto e registre cada resultado no checklist do teste.' },
    { label: 'Testar na tela (Playwright)', prompt: `Teste os critérios de aceite que dependem da tela usando o Playwright CLI, seguindo a skill agentboard-testar.${headed ? ' Rode com o navegador visível (--headed) e com slowMo para eu acompanhar.' : ' Rode sem janela (headless), guardando screenshot e trace do que falhar.'}` },
    { label: 'Testar de novo', prompt: 'Refaça o teste deste card do começo: monte o checklist de novo, rode tudo e me diga o que passou e o que falhou.' }
  ] : []
  const resetAndSwitch = async (target: AgentProfile): Promise<void> => {
    setSwitchTo(undefined)
    try {
      setError('')
      if (chat) { await window.agentboard.invoke('chats:reset', { chatId: chat.id }); setChat(undefined); setMessages([]); setSkill(null) }
      await agentState.update({ profileId: target.id, model: null, effort: null, mode: defaultPermissionMode(target.provider, mode) })
      if (card.id) setChats(await window.agentboard.invoke('chats:list', { projectId: project.id, cardId: card.id }))
    } catch (reason) { setError(String(reason).replace(/^Error: /, '')) }
  }
  // Agente removido (desativado): o histórico fica, mas ele não executa mais; para continuar é preciso reiniciar o chat com outro.
  const inactive = chat && !usable.some((item) => item.id === chat.profileId) ? profiles.find((item) => item.id === chat.profileId) : undefined
  const resetInactive = async (): Promise<void> => {
    if (!chat) return
    try { setError(''); await window.agentboard.invoke('chats:reset', { chatId: chat.id }); setChat(undefined); setMessages([]); setSkill(null); setChats(await window.agentboard.invoke('chats:list', { projectId: project.id, cardId: card.id })) }
    catch (reason) { setError(plainError(reason)) }
  }
  const typed = useTypewriter(live)
  const busy = Boolean(run) || ((card.run.state === 'running' || card.run.state === 'planning') && card.run.purpose === mode)
  const busySince = useBusySince(busy, run?.startedAt)
  const later = useQueuedMessage(busy, deliver)
  const execModes = provider ? permissionModes[provider].filter((item) => item.purposes.includes('execution')) : []
  const currentMode = execModes.find((item) => item.id === agentState.config?.mode)
  const testing = mode === 'test'

  const diffOpen = Boolean(diff) && view === 'git' && Boolean(card.id) && !planning
  const viewing = !expanded && (viewer.requested !== null || diffOpen)
  return <section ref={chatSearch.ref} className={`dock open ${expanded ? 'full' : ''} ${expanded && quickHidden ? 'noactivity' : ''} ${viewing ? 'withviewer' : ''} ${dragging || viewer.dragging ? 'dragging' : ''}`} aria-label="Chat do card" style={expanded ? undefined : { width: width + (viewing ? viewer.width : 0) }}>
    {!expanded && <div className="dockgrip" role="separator" aria-orientation="vertical" aria-label={viewing ? 'Ajustar a largura do arquivo' : 'Ajustar a largura do chat'} onPointerDown={viewing ? viewer.startResize : startResize} onDoubleClick={viewing ? undefined : resetWidth} />}
    {viewing && <>{diffOpen && diff ? <DiffPane cardId={card.id} target={diff} close={() => setDiff(undefined)} ask={sendReview} style={{ width: viewer.width }} /> : viewer.request && <FocusedFile projectId={project.id} cardId={card.id || null} chatId={chat?.id} request={viewer.request} close={viewer.close} setDirty={viewer.setDirty} style={{ width: viewer.width }} />}<ViewGrip viewer={viewer} /></>}
    <FileOpenContext.Provider value={openFile}><QuestionAnswerContext.Provider value={answerQuestions}>
    <div className="dock-in" style={expanded ? undefined : { width }}>
      <div className="dock-head" draggable={Boolean(card.id) && !pop} onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest('button,input,textarea,[role="tab"],.dock-tools')) setExpanded(!expanded) }} onDragStart={(event) => { if ((event.target as HTMLElement).closest('button,input,textarea,[role="tab"],.dock-tools')) { event.preventDefault(); return }; event.preventDefault(); void detachChat({ x: Math.round(event.screenX), y: Math.round(event.screenY) }) }}><div className="top"><div><div className="headrow">          <div className="tabs stepTabs" role="tablist" aria-label="Chats do card">{(['planning', 'execution', 'test'] as const).filter((step) => singleChat ? step === (chats[0]?.purpose ?? mode) : step === mode || chats.some((item) => item.purpose === step)).map((step) => { const working = card.run.purpose === step && (card.run.state === 'running' || card.run.state === 'planning'); return <button key={step} role="tab" aria-selected={mode === step} className={`tab ${mode === step ? 'on' : ''}`} onClick={() => step !== mode && onSwitch(step)}>{singleChat ? 'Agente' : stepLabel[step]}{working ? <span className="spin sm" /> : null}</button> })}</div></div>
          <h2>{card.title || 'Novo card'}</h2><div className="ctxline"><span className="ctxchip">{columnLabel}</span>{card.id && <ComplexityBadge complexity={card.complexity} onClick={() => setAssessing(true)} />}{assessing && <AssessmentDialog card={card} close={() => setAssessing(false)} changed={() => undefined} />}{card.workspace && <span className="ctxchip ws tip" data-tip={`Worktree: ${card.workspace.path}`}><BranchIcon /><span className="wsname">{card.workspace.branch} · {worktreeName(card.workspace.path)}</span></span>}</div></div>
        <div className="dock-tools"><div className="dock-tools-wide">{card.id && !planning && <div className="viewtoggle sm" role="group" aria-label="Chat ou Git"><button type="button" className={gitView ? '' : 'on'} aria-pressed={!gitView} onClick={() => setView('chat')}>Chat</button><button type="button" className={gitView ? 'on' : ''} aria-pressed={gitView} onClick={() => setView('git')}><BranchIcon />Git{card.pending.commits > 0 && <i className="pendot" />}</button></div>}<ChatSearch messages={messages} log={log} request={chatSearch.request} reveal={gitView ? () => setView('chat') : undefined} />{card.id && <PopMenu target={{ kind: 'chat', projectId: project.id, cardId: card.id, purpose: mode }} />}<button type="button" className="ibtn tip" data-tip={expanded ? 'Voltar para o canto' : 'Expandir em tela cheia'} aria-label={expanded ? 'Voltar para o canto' : 'Expandir em tela cheia'} onClick={() => setExpanded(!expanded)}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button><button className="x" aria-label="Fechar chat" onClick={close}><CloseIcon /></button></div><div className="dock-tools-compact"><ChatMoreMenu searchRequest={chatSearch.request} messages={messages} log={log} projectId={project.id} cardId={card.id || undefined} purpose={mode} expand={() => setExpanded(true)} close={close} view={card.id && !planning ? { git: gitView, set: setView } : undefined} /><button className="x" aria-label="Fechar chat" onClick={close}><CloseIcon /></button></div></div></div></div>
      {gitView && <GitCardPanel cardId={card.id} profiles={profiles} openRules={() => openRules?.()} openGraph={(id) => openGraph?.(id)} diff={diff} setDiff={setDiff} />}
      <div className="chatlog" ref={log} style={gitView ? { display: 'none' } : undefined}>
        {!messages.length && !live && <div className="msg sys">{planning ? 'Skill de planejamento carregada. Este chat só planeja, não altera arquivos.' : testing ? 'Chat de teste do card. Use Testar no card ou escreva o que o agente deve conferir.' : 'Chat de implementação do card. Use Iniciar no card ou escreva uma instrução.'}</div>}
        <ChatMessageList messages={messages} busy={busy} />
        <AgentPermissions chatId={chat?.id} />
        {live && <div className="msg agent"><div className="md chatmd"><AgentMessage source={typed} live /><span className="caret" /></div></div>}
        {mode === 'execution' && card.id && <CommitAsks cardId={card.id} branch={card.workspace?.branch} profiles={profiles} openGit={() => setView('git')} />}
        {busy && <ThinkingIndicator purpose={mode} messages={messages} since={busySince} />}
      </div>
      <div className="composer" ref={wrap} style={gitView ? { display: 'none' } : undefined}>
        {inactive && <div className="convbox"><p>O agente <b>{inactive.label.replace(' (desativado)', '')}</b> foi removido (desativado) e não pode mais executar nada neste chat. O histórico continua aqui para consulta. Para seguir neste card, reinicie o chat com outro agente.</p><div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => void resetInactive()}>Reiniciar chat</button></div></div>}
        {(error || dictation.error) && <p className="error">{error || dictation.error}</p>}
        {voiceSetup && !voiceReady && dictation.status?.cloud && <div className="convbox"><p>O ditado está configurado para o Groq, mas falta a chave da API. Cadastre em Configurações › Geral.</p><div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setVoiceSetup(false)}>Fechar</button></div></div>}
        {voiceSetup && !voiceReady && dictation.status && !dictation.status.cloud && <div className="convbox"><p>O ditado por voz roda no seu computador, sem gastar token. Falta baixar {!dictation.status.engineInstalled ? (dictation.status.canInstallEngine ? 'o programa de transcrição e ' : 'o programa de transcrição (whisper-cli no PATH) e ') : ''}o modelo ({dictation.status.sizeMb} MB), só uma vez.</p><div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setVoiceSetup(false)}>Agora não</button><button type="button" disabled={Boolean(dictation.progress) || (!dictation.status.engineInstalled && !dictation.status.canInstallEngine)} onClick={() => void dictation.install().then(() => setVoiceSetup(false))}>{dictation.progress || 'Baixar'}</button></div></div>}
        {later.queued && <QueuedPreview text={later.queued} files={later.files} busy={busy} sendNow={() => later.sendNow(cancel)} edit={() => { const item = later.take(); setInput((value) => `${item.text}${value ? `\n${value}` : ''}`); attach.add(item.files) }} discard={later.discard} />}
        <div className={`cbox ${attach.dragging ? 'dropping' : ''}`} {...attach.dropProps}>
          {((!inactive && testShortcuts.length > 0) || attach.files.length > 0) && <div className="cbox-top">
            {!inactive && testShortcuts.length > 0 && <div className="testbar" role="group" aria-label="Atalhos do teste">{testShortcuts.map((item) => <button type="button" key={item.label} className="mini secondary" onClick={() => answerQuestions(item.prompt)}>{item.label}</button>)}
          <label className="autosave tip" data-tip="Abre o navegador na sua tela quando o Playwright testar"><input type="checkbox" role="switch" checked={headed} onChange={toggleHeaded} /><span className="sw" aria-hidden="true" />Ver o navegador</label></div>}
            <AttachmentChips files={attach.files} remove={attach.remove} />
          </div>}
          <AttachButton onClick={() => void attach.choose()} />
          {mention.menu}<textarea rows={1} aria-label="Mensagem para o agente" value={input} placeholder={dictation.recording ? 'Ouvindo…' : planning ? 'Descreva o que você quer planejar…' : testing ? 'Diga o que o agente deve testar…' : 'Envie uma instrução ao agente…'} ref={mention.ref} onSelect={(e) => mention.caret(e.currentTarget.selectionStart)} onChange={(e) => { setInput(e.target.value); mention.caret(e.target.selectionStart) }} onKeyDown={(e) => { if (mention.keyDown(e)) return; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
          {dictation.recording && <span className="wave"><i /><i /><i /><i /><i /><i /><i /></span>}
          {busy && <button type="button" className="sendbtn stop tip" data-tip="Parar" aria-label="Parar" onClick={() => void stop()}><StopIcon /></button>}<button type="button" className="sendbtn tip" data-tip={busy ? 'Colocar na fila (Enter)' : 'Enviar (Enter)'} aria-label={busy ? 'Colocar na fila' : 'Enviar'} hidden={!input.trim()} onClick={() => void send()}><SendIcon /></button>
          <button type="button" className={`micbtn tip ${dictation.recording ? 'on' : ''}`} data-tip={dictation.recording ? 'Parar de ouvir' : dictation.transcribing ? 'Transcrevendo…' : 'Ditar por voz'} aria-label="Ditar por voz" aria-pressed={dictation.recording} disabled={dictation.transcribing || !dictation.status} onClick={() => (voiceReady ? void dictation.toggle() : setVoiceSetup(true))}>{dictation.transcribing ? <span className="spin sm" /> : <MicIcon />}</button>
        </div>
        <div className="cmeta">
          {planning ? <><span className="mode tip" data-tip="Este chat não altera arquivos">✦ Só planejar</span>
            <span className="modewrap"><button type="button" className={`skillchip ${menu === 'skill' ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={menu === 'skill'} title="Skill de planejamento" onClick={() => setMenu(menu === 'skill' ? null : 'skill')}>{skill?.name ?? 'Planejamento SDD'}</button>
              {menu === 'skill' && <div className="modemenu skillmenu" role="menu"><div className="mm-title">Skill de planejamento</div>
                <button type="button" role="menuitem" className="modeopt" onClick={() => void chooseSkill(null)}><span className="mo-t"><b>Planejamento SDD</b><em>Padrão</em><small>Sistema</small></span><span className="mo-r">{!skill && <CheckIcon />}</span></button>
                {available.map((item) => { const path = provider ? item.paths[provider]! : ''; return <button type="button" role="menuitem" key={item.id} className="modeopt" onClick={() => void chooseSkill({ name: item.name, path })}><span className="mo-t"><b>{item.name}</b><small>{item.scope === 'project' ? 'Do projeto' : 'Global'}</small></span><span className="mo-r">{skill?.path === path && <CheckIcon />}</span></button> })}</div>}</span></>
            : <span className="modewrap"><button type="button" className={`modechip ${menu === 'mode' ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={menu === 'mode'} onClick={() => setMenu(menu === 'mode' ? null : 'mode')}>{currentMode?.label ?? 'Modo'}</button>
              {menu === 'mode' && <div className="modemenu" role="menu"><div className="mm-title">Modo</div>{execModes.map((item, index) => <button type="button" role="menuitem" key={item.id} disabled={item.needsApprovalUi} title={item.needsApprovalUi ? 'Precisa da tela de aprovação (em breve)' : undefined} className="modeopt" onClick={() => { setMenu(null); void agentState.update({ mode: item.id }) }}><span className="mo-t"><b>{item.label}</b>{item.recommended && <em>Recomendado</em>}<small>{item.description}</small></span><span className="mo-r">{agentState.config?.mode === item.id ? <CheckIcon /> : index + 1}</span></button>)}</div>}</span>}
          <div className="pick"><UsageRings profileId={agentState.config?.profileId ?? chat?.profileId} /><ModelMenu profiles={usable} purpose={mode} state={agentState} lockProfile={Boolean(chat)} onLockedPick={setSwitchTo} /></div>
        </div>
      </div>
    </div>
    </QuestionAnswerContext.Provider></FileOpenContext.Provider>
    {switchTo && <ConfirmDialog eyebrow="Trocar agente" title={`Reiniciar o chat com ${switchTo.label}?`} text="Este chat já começou com outro agente. Trocar apaga as mensagens e as execuções deste chat e ele recomeça do zero com o novo agente. Os documentos do card ficam como estão." ok="Trocar e reiniciar" danger cancel={() => setSwitchTo(undefined)} confirm={() => void resetAndSwitch(switchTo)} />}
    {/* Só com o chat em tela cheia: coluna à esquerda com o progresso (Tasks ou checklist do teste) e as Alterações. Dividindo a tela com o quadro, não aparece. */}
    {expanded && diffOpen && diff && <DiffPane cardId={card.id} target={diff} close={() => setDiff(undefined)} ask={sendReview} />}
    {expanded && !diffOpen && !planning && card.id && <div className="dockside"><ProgressCard key={`${card.id}-${mode}-${columnState}`} cardId={card.id} purpose={mode === 'test' || (fullAgent && columnState === 'test') ? 'test' : 'execution'} />{(card.workspace || fullAgent) && <ChangesCard key={card.id} cardId={card.id} projectId={project.id} busy={busy} shared={card.workspace?.sharedFrom ?? null} />}</div>}
    {expanded && !diffOpen && !quickHidden && <Activity board={board} cardId={card.id} profiles={profiles} openEdit={openEdit} hide={() => setQuickHidden(true)} />}
    {expanded && !diffOpen && quickHidden && <button type="button" className="qv-show tip" data-tip="Mostrar visão rápida" aria-label="Mostrar visão rápida" onClick={() => setQuickHidden(false)}>Visão rápida</button>}
  </section>
}
