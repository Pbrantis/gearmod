import { AgentBackground } from './AgentBackground'
import { AgentPermissions } from './AgentPermissions'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { dropToken, InputMirror, useAtMention } from './AtMention'
import { defaultPermissionMode, permissionModes, type AgentProfile, type AgentPurpose, type Card, type Chat, type ChatMessage, type Project, type ProjectBoard, type Run, type SkillEntry, type SkillRef } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { ConfirmDialog } from './ConfirmDialog'
import { shortcutEvent } from './shortcuts'
import { WindowIcon } from './WindowLayoutMenu'
import { BranchIcon, CheckIcon, CloseIcon, CollapseIcon, ExpandIcon, MicIcon, SendIcon, StopIcon } from './icons'
import { ModelMenu, permissionModeText, useAgentConfig } from './ModelMenu'
import { createPortal } from 'react-dom'
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
import { ChatReplySelection, ReplyContextCards, useChatReplies } from './ChatReplies'
import { withChatReplies } from './chatReplyContext'
import { ThinkingIndicator, useBusySince, useTypewriter } from './Thinking'
import { plainError } from './NoticeDialog'
import { ChangesCard } from './ChangesCard'
import { CommitAsks, DiffPane, GitCardPanel, type DiffTarget } from './GitCardPanel'
import { ApprovalAsks } from './ApprovalCard'
import { SpecKitAsks, SpecKitModeChip, useSpecKit } from './SpecKitAsks'
import { ProgressCard } from './ProgressCard'
import { PopMenu } from './PopMenu'
import { ChatSearch, searchMessages, snippet, useChatSearchShortcut } from './ChatSearch'
import { useFitInView } from './useFitInView'
import { terminal } from './terminalStore'
import { useDictation } from './useDictation'
import { useStickToBottom } from './useStickToBottom'
import { pop } from './popout'
import { useT } from './i18n'

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

const typeColor: Record<Card['type'], string> = { feature: 'var(--blue)', bug: 'var(--danger)', improvement: 'var(--accent-strong)', task: 'var(--muted)', minor: 'var(--warn)' }

const SearchGlyph = (): React.JSX.Element => <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" /><path d="M13.2 13.2L17 17" /></svg>

/** Ações do cabeçalho agrupadas quando o dock estreito não comporta todos os botões. */
export function ChatMoreMenu({ messages, log, projectId, cardId, chatId, purpose, expand, view, openCard, searchRequest = 0 }: { openCard?(): void; messages: ChatMessage[]; log: React.RefObject<HTMLDivElement | null>; projectId: string; cardId?: string; chatId?: string; purpose?: AgentPurpose; expand(): void; close(): void; view?: { git: boolean; set(value: 'chat' | 'git'): void }; searchRequest?: number }): React.JSX.Element {
  const t = useT(), m = t.chat.moreMenu
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
    <button type="button" className="ibtn morebtn" aria-label={m.moreOptions} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open); setPage('main') }}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4" cy="10" r="1.35" /><circle cx="10" cy="10" r="1.35" /><circle cx="16" cy="10" r="1.35" /></svg></button>
    {open && <div className="popmenu dockmore-menu" ref={menu} role={page === 'search' ? 'dialog' : 'menu'} aria-label={m.chatMoreOptions}>
      {page !== 'main' && <button type="button" className="pm-back" onClick={() => setPage('main')}>‹ <span>{page === 'search' ? m.search : pop ? m.moveWindow : m.openInOtherWindow}</span></button>}
      {page === 'main' && <>
        {openCard && <button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => { dismiss(); openCard() }}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="3.5" width="13" height="13" rx="2.5" /><path d="M7 8h6M7 11.5h4" /></svg>{m.openCard}</button>}
        {view && <button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => { dismiss(); view.set(view.git ? 'chat' : 'git') }}><BranchIcon />{view.git ? m.backToChat : m.viewCardGit}</button>}
        <button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => setPage('search')}><SearchGlyph />{m.searchInChat} <small>Ctrl+F</small></button>
        {(cardId || chatId) && <button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => setPage('window')}><WindowIcon />{pop ? m.moveThisWindow : m.openInOtherWindow}</button>}
        <button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => { dismiss(); expand() }}><ExpandIcon />{m.expandFull}</button>
      </>}
      {page === 'search' && <>
        <input ref={input} className="in" value={query} placeholder={m.searchInChat} aria-label={m.searchInChat} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && results[0]) goMessage(results[0].id) }} />
        <div className="cs-list">{query.trim().length < 2 ? <p className="ch-muted">{t.chat.search.minLetters}</p> : !results.length ? <p className="ch-muted">{t.chat.search.nothingFound}</p> : results.slice(0, 40).map((message) => <button type="button" key={message.id} className="cs-item" onClick={() => goMessage(message.id)}><b>{message.role === 'user' ? t.chat.roles.user : message.role === 'assistant' ? t.chat.roles.assistant : t.chat.roles.system}</b><span>{snippet(message.body, query.trim())}</span></button>)}</div>
      </>}
      {page === 'window' && <div className="pm-places">{(['left', 'right', 'top', 'bottom'] as const).map((placement) => <button type="button" role="menuitem" className="pm-item" key={placement} onClick={() => place(placement)}>{m.places[placement]}</button>)}{!pop && <><div className="pm-sep" /><button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => place('new')}><WindowIcon />{m.openInNewWindow}</button></>}</div>}
    </div>}
  </span>
}

function Tile({ card, board, here, profiles, open }: { card: Card; board: ProjectBoard; here: boolean; profiles: AgentProfile[]; open(): void }): React.JSX.Element {
  const t = useT().chat.tile
  const run = card.run.state, agent = profiles.find((profile) => profile.id === (card.run.profileId ?? card.execProfileId))
  const state = board.columns.find((column) => column.id === card.columnId)
  const ready = run === 'idle' && card.hasPlan && (state?.semanticState === 'backlog' || state?.semanticState === 'todo')
  const status = card.planningOpen ? <><span className="dot dot-plan" /><small>{t.inPlanning}</small></> : run === 'running' ? <><span className="spin sm" /><small>{t.running}</small></> : run === 'planning' ? <><span className="dot dot-plan pulse" /><small>{t.planning}</small></> : ready ? <><span className="dot softpulse" style={{ color: 'var(--accent-strong)' }} /><small>{t.planReady}</small></> : run === 'finished' ? <><span className="dot pulse" style={{ color: 'var(--accent)' }} /><small>{t.finished}</small></> : run === 'paused' ? <small style={{ color: 'var(--warn)' }}>{t.paused}</small> : <small>{state?.label}</small>
  return <button type="button" className={`tile ${run === 'running' ? 'run' : ''} ${run === 'planning' ? 'plan' : ''} ${here ? 'here' : ''}`} onClick={open}><span className="tdot" style={{ background: typeColor[card.type] }} /><span className="ttl">{card.title || t.newCard}</span><span className="tfoot">{agent ? <AgentIcon profile={agent} size="sm" /> : <i />}<span className="tst">{status}</span></span></button>
}

/** Visão rápida (protótipo): o que está executando agora e os demais cards, com o estado de cada um. */
function Activity({ board, cardId, profiles, openEdit, hide }: { board: ProjectBoard; cardId: string; profiles: AgentProfile[]; openEdit(card: Card): void; hide(): void }): React.JSX.Element {
  const t = useT().chat.activity
  const cards = board.cards.filter((card) => !card.archivedAt && board.columns.find((column) => column.id === card.columnId)?.semanticState !== 'done'), running = cards.filter((card) => card.run.state === 'running')
  const rank = (card: Card): number => card.id === cardId ? 0 : card.run.state === 'finished' ? 0.5 : card.run.state === 'planning' ? 1 : card.hasPlan && card.run.state === 'idle' ? 2 : 3 + board.columns.findIndex((column) => column.id === card.columnId)
  const rest = cards.filter((card) => card.run.state !== 'running').sort((a, b) => rank(a) - rank(b))
  return <section className="activity qv-wrap"><button type="button" className="side-toggle qv-toggle tip" data-tip={t.hide} aria-label={t.hide} onClick={hide}><svg viewBox="0 0 20 20" aria-hidden="true" style={{ transform: 'rotate(180deg)' }}><path d="m12 4-6 6 6 6" /></svg></button><div className="qv-inner"><div className="qv-head"><div className="eyebrow">{t.quickView}</div></div>
    <div className="agrp"><span>{t.running}</span><b>{running.length}</b></div>
    <div className="tilecol">{running.length ? running.map((card) => <Tile key={card.id} card={card} board={board} here={card.id === cardId} profiles={profiles} open={() => openEdit(card)} />) : <div className="emptyact">{t.nothingRunning}</div>}</div>
    <div className="agrp"><span>{t.otherCards}</span><b>{rest.length}</b></div>
    <div className="tilecol">{rest.map((card) => <Tile key={card.id} card={card} board={board} here={card.id === cardId} profiles={profiles} open={() => openEdit(card)} />)}</div>
  </div></section>
}

/** Chat do card (planejamento ou execução) como o dock do protótipo: encaixado à direita ou em tela cheia com a visão rápida. */
export function CardChat({ project, card, board, profiles, columnLabel, mode, close, openEdit, onSwitch, ensureCard, initialView = 'chat', openRules, openGraph }: { initialView?: 'chat' | 'git'; openRules?(): void; openGraph?(cardId: string): void; project: Project; card: Card; board: ProjectBoard; profiles: AgentProfile[]; columnLabel: string; mode: AgentPurpose; close(): void; openEdit(card: Card): void; onSwitch(purpose: AgentPurpose): void; ensureCard?(): Promise<Card> }): React.JSX.Element {
  const t = useT(), c = t.chat.cardChat, d = t.chat.dock, act = t.chat.activity
  const usable = profiles.filter((profile) => project.allowedProfileIds.includes(profile.id))
  const [assessing, setAssessing] = useState(false), [chat, setChat] = useState<Chat>(), [messages, setMessages] = useState<ChatMessage[]>([]), [run, setRun] = useState<Run>(), [live, setLive] = useState('')
  const [input, setInput] = useState(''), [inputCaret, setInputCaret] = useState(0), [skillIndex, setSkillIndex] = useState(0), [closedSkillAt, setClosedSkillAt] = useState(-1), [error, setError] = useState(''), [skills, setSkills] = useState<SkillEntry[]>([]), [skill, setSkill] = useState<SkillRef | null>(null)
  const [menu, setMenu] = useState<'mode' | 'skill' | null>(null), [skillFilter, setSkillFilter] = useState(''), [voiceSetup, setVoiceSetup] = useState(false)
  const chatRef = useRef<Chat | undefined>(undefined)
  const log = useRef<HTMLDivElement>(null), runId =useRef<string | undefined>(undefined), wrap = useRef<HTMLDivElement>(null), skillFilterInput = useRef<HTMLInputElement>(null)
  const [chats, setChats] = useState<Chat[]>([])
  // Fluxo curto tem um agente e um chat só (planeja, executa e valida): a aba não distingue etapas.
  const singleChat = card.workflow === 'light' && chats.length <= 1
  // A worktree já existe durante o planejamento; a coluna define quando o chat único entra em execução.
  const columnState = board.columns.find((column) => column.id === card.columnId)?.semanticState
  const fullAgent = singleChat && (columnState === 'doing' || columnState === 'test' || columnState === 'done')
  const planning = mode === 'planning' && !fullAgent
  const specKit = useSpecKit(card.id), [dockHost, setDockHost] = useState<HTMLElement | null>(null)
  const [view, setView] = useState<'chat' | 'git'>(initialView), [diff, setDiff] = useState<DiffTarget>()
  const gitView = view === 'git' && Boolean(card.id) && !planning
  const { expanded, setExpanded, width, setWidth, dragging, startResize, resetWidth } = useDockSize()
  const chatSearch = useChatSearchShortcut(expanded)
  useEffect(() => { const navigate = (): void => { if (expanded) close() }; window.addEventListener('agentboard:select-view', navigate); return () => window.removeEventListener('agentboard:select-view', navigate) }, [expanded, close])
  const [quickHidden, setQuickHiddenState] = useState(() => { try { return localStorage.getItem('agentboard.quickView.hidden') === '1' } catch { return false } })
  const quickHiddenRef = useRef(quickHidden), expandedRef = useRef(expanded), diffOpenRef = useRef(false)
  quickHiddenRef.current = quickHidden; expandedRef.current = expanded
  useEffect(() => {
    const onShortcut = (event: Event): void => { if ((event as CustomEvent<{ id: string }>).detail.id === 'toggleQuickView' && expandedRef.current && !diffOpenRef.current) setQuickHidden(!quickHiddenRef.current) }
    window.addEventListener(shortcutEvent, onShortcut); return () => window.removeEventListener(shortcutEvent, onShortcut)
  }, [])
  const setQuickHidden = (value: boolean): void => { setQuickHiddenState(value); try { localStorage.setItem('agentboard.quickView.hidden', value ? '1' : '0') } catch { /* só conveniência */ } }
  useEffect(() => { if (!card.id) return; terminal.setContext({ projectId: project.id, cardId: card.id }); return () => terminal.setContext({ projectId: project.id, cardId: null }) }, [card.id, project.id])
  const viewer = useFileViewer(width, setWidth)
  const openFile = useCallback((path: string) => { setExpanded(false); viewer.open(path) }, [viewer.open])
  const [switchTo, setSwitchTo] = useState<AgentProfile>()
  const agentState = useAgentConfig(card.id, mode, usable, chat?.profileId)
  const attach = useAttachments({ projectId: project.id, cardId: card.id || null })
  const replies = useChatReplies()
  const mention = useAtMention({ projectId: project.id, cardId: card.id || null, input, setInput })
  useContextText({ projectId: project.id, cardId: card.id || null }, (text) => setInput((value) => (value.trim() ? `${value.replace(/\s+$/, '')}\n\n${text}` : text)))
  const dictation = useDictation(useCallback((text: string) => setInput((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}${text}`), []), card.title || undefined)
  const voiceReady = Boolean(dictation.status?.modelInstalled && dictation.status.engineInstalled)
  const loadMessages = useCallback(async (chatId: string) => setMessages(await window.agentboard.invoke('messages:list', { chatId })), [])
  useEffect(() => { if (card.id) void window.agentboard.invoke('cards:mark-viewed', { cardId: card.id }).catch(() => undefined) }, [card.id])
  useEffect(() => { if (!card.id) return; void window.agentboard.invoke('chats:list', { projectId: project.id, cardId: card.id }).then((items) => { setChats(items); const found = items.find((item) => item.purpose === mode); if (found) { setChat(found); void loadMessages(found.id) } }).catch((reason: unknown) => setError(plainError(reason))) }, [project.id, card.id, mode, loadMessages])
  useEffect(() => window.agentboard.onRunEvent((event) => {
    if (event.eventType === 'agentboard/tool-activity') { const id = String(event.payload.chatId ?? ''); setChat((current) => { if (current && current.id === id) void loadMessages(id); return current }); return }
    const own = Boolean(chatRef.current) && event.payload.chatId === chatRef.current?.id
    // Run que começou fora deste componente (mensagem da fila, retomada, encadeamento): o chat a adota para mostrar o stream.
    if (event.eventType === 'agentboard/run-started' && own && event.runId) { runId.current = event.runId; setLive(''); void loadMessages(chatRef.current!.id); return }
    if (event.eventType !== 'agentboard/run-completed' || !own) { if (event.runId !== runId.current) return }
    if (event.eventType === 'item/agentMessage/delta') setLive((value) => value + String(event.payload.delta ?? ''))
    if (event.eventType === 'agentboard/run-completed') { runId.current = undefined; setRun(undefined); setLive(''); setChat((current) => { if (current) void loadMessages(current.id); return current }); void window.agentboard.invoke('cards:mark-viewed', { cardId: card.id }).catch(() => undefined) }
  }), [card.id, loadMessages])
  useEffect(() => { chatRef.current = chat }, [chat])
  // Chat aberto com a run já em andamento (saiu e voltou): adota a run para voltar a receber o stream.
  useEffect(() => { if (!runId.current && card.run.runId && card.run.purpose === mode && (card.run.state === 'running' || card.run.state === 'planning')) runId.current = card.run.runId }, [card.run.runId, card.run.state, card.run.purpose, mode])
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
  const skillNames = available.map((item) => item.name)
  const skillPreferenceKey = provider ? `agentboard.lastSkill.${project.id}.${provider}.${mode}` : null
  useEffect(() => {
    if (chat || !provider || !skillPreferenceKey || !available.length) return
    try {
      const saved = JSON.parse(localStorage.getItem(skillPreferenceKey) ?? 'null') as SkillRef | null
      if (saved && available.some((item) => item.name === saved.name && item.paths[provider] === saved.path)) setSkill(saved)
    } catch { /* preferência opcional inválida */ }
  }, [chat?.id, skillPreferenceKey, skills, provider])
  useEffect(() => { if (menu === 'skill') window.setTimeout(() => skillFilterInput.current?.focus(), 0) }, [menu])
  const chooseSkill = async (next: SkillRef | null): Promise<void> => {
    setMenu(null); setSkillFilter('')
    try {
      setError(''); if (chat) setChat(await window.agentboard.invoke('chats:set-skill', { chatId: chat.id, skill: next })); setSkill(next)
      if (skillPreferenceKey) { if (next) localStorage.setItem(skillPreferenceKey, JSON.stringify(next)); else localStorage.removeItem(skillPreferenceKey) }
    } catch (reason) { setError(plainError(reason)) }
  }
  const slash = /(^|\s)\/([^\s/]*)$/.exec(input.slice(0, inputCaret)), slashQuery = slash?.[2] ?? '', slashStart = slash ? inputCaret - slashQuery.length - 1 : -1
  const slashSkills = slash ? available.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(slashQuery.toLocaleLowerCase())) : []
  const slashOpen = slashStart !== closedSkillAt && slashSkills.length > 0
  const slashMenu = useRef<HTMLDivElement>(null)
  useEffect(() => { if (slashOpen) slashMenu.current?.querySelector<HTMLElement>('.atitem.on')?.scrollIntoView({ block: 'nearest' }) }, [slashOpen, skillIndex])
  const chooseSlashSkill = (entry: SkillEntry): void => {
    const path = provider ? entry.paths[provider] : null
    if (!path) return
    const written = `/${entry.name} `, next = input.slice(0, slashStart) + written + input.slice(inputCaret), caret = slashStart + written.length
    setInput(next); setInputCaret(caret); setClosedSkillAt(-1); void chooseSkill({ name: entry.name, path })
    window.requestAnimationFrame(() => { const area = mention.ref.current; if (area) { area.focus(); area.setSelectionRange(caret, caret) } })
  }
  const slashKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!slashOpen || event.nativeEvent.isComposing) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSkillIndex((value) => (value + (event.key === 'ArrowDown' ? 1 : slashSkills.length - 1)) % slashSkills.length); return true }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); const entry = slashSkills[skillIndex]; if (entry) chooseSlashSkill(entry); return true }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setClosedSkillAt(slashStart); return true }
    return false
  }
  const deliver = async (prompt: string, queuedFiles?: string[]): Promise<void> => {
    const files = queuedFiles ?? attach.take()
    if (inactive) { setError(c.agentRemoved(inactive.label.replace(' (desativado)', ''))); setInput(replies.restore(prompt)); attach.add(files); return }
    try {
      setError('')
      let current = chat
      const chosen = agentState.config?.profileId
      let cardId = card.id
      // Planejamento começado sem card: ele só nasce agora, na primeira mensagem, para o chat ter a que se referir.
      if (!cardId) {
        if (!ensureCard) throw new Error(c.cardNotFound)
        cardId = (await ensureCard()).id
        if (agentState.touched && agentState.config) await window.agentboard.invoke('cards:set-agent-config', { cardId, purpose: mode, config: agentState.config })
      }
      if (!current) { if (!chosen) throw new Error(c.chooseAgent); current = await window.agentboard.invoke('chats:create', { projectId: project.id, cardId, purpose: mode, profileId: chosen, skill }); setChat(current) }
      const started = await window.agentboard.invoke('agents:start', { chatId: current.id, prompt, planning, attachments: files.length ? files : undefined })
      runId.current = started.id; setRun(started); setLive(''); await loadMessages(current.id)
    } catch (reason) { setError(plainError(reason)); const restored = replies.restore(prompt); setInput((value) => [restored, value].filter(Boolean).join('\n\n')); attach.add(files) }
  }
  const cancel = async (): Promise<void> => { const id = run?.id ?? card.run.runId; if (id) await window.agentboard.invoke('agents:cancel', { runId: id }).catch((reason: unknown) => setError(plainError(reason))) }
  const send = async (): Promise<void> => {
    const prompt = withChatReplies(input, replies.items) || (attach.files.length ? 'Veja os arquivos anexados.' : ''); if (!prompt) return
    if (prompt.length + (busy && later.queued ? later.queued.length + 2 : 0) > 100_000) { setError(d.messageTooLong); return }
    setInput(''); replies.clear()
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
      if (developer?.busy) throw new Error(c.developerBusy)
      if (!developer) {
        const config = (await window.agentboard.invoke('cards:agent-config', { cardId: card.id })).execution
        if (!config) throw new Error(c.chooseDevAgent)
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
  // Um botão só: a skill de teste já roda os testes, o lint e o typecheck e, com o Playwright CLI ligado no projeto, também os critérios de tela.
  // Com o Playwright ligado, pergunta se é para ver o navegador ou rodar em segundo plano.
  const [pwReady, setPwReady] = useState(false), [testChoice, setTestChoice] = useState(false)
  useEffect(() => { if (mode !== 'test') return; void window.agentboard.invoke('playwright:status', { projectId: project.id }).then((status) => setPwReady(status.enabled && Boolean(status.selected))).catch(() => setPwReady(false)) }, [mode, project.id])
  const retestPrompt = (headed?: boolean): string => `Refaça o teste deste card do começo: reabra o checklist que já existe (mantenha os mesmos itens, desmarque todos e revalide um a um, acrescentando só o que for novo), rode os testes automatizados, o lint e o typecheck${pwReady ? ' e confira os critérios de tela com o Playwright CLI, seguindo a skill agentboard-test.' : '.'}${headed === undefined ? '' : headed ? ' Rode o Playwright com o navegador visível (--headed) e com slowMo para eu acompanhar.' : ' Rode o Playwright sem janela (headless), guardando screenshot e trace do que falhar.'} Me diga o que passou e o que falhou.`
  const testShortcuts = mode === 'test' ? [{ label: c.testAgain, run: () => { if (pwReady) setTestChoice(true); else answerQuestions(retestPrompt()) } }] : []
  const resetAndSwitch = async (target: AgentProfile): Promise<void> => {
    setSwitchTo(undefined)
    try {
      setError('')
      if (chat) { await window.agentboard.invoke('chats:reset', { chatId: chat.id }); setChat(undefined); setMessages([]); setSkill(null) }
      await agentState.update({ profileId: target.id, model: null, effort: null, mode: defaultPermissionMode(target.provider, mode) })
      if (card.id) setChats(await window.agentboard.invoke('chats:list', { projectId: project.id, cardId: card.id }))
    } catch (reason) { setError(plainError(reason)) }
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
  const modeText = (item: (typeof execModes)[number]): { label: string; description: string } => permissionModeText(provider!, item)
  const testing = mode === 'test'

  const diffOpen = Boolean(diff) && view === 'git' && Boolean(card.id) && !planning
  diffOpenRef.current = diffOpen
  const viewing = !expanded && (viewer.requested !== null || diffOpen)
  return <section ref={chatSearch.ref} className={`dock open ${expanded ? 'full' : ''} ${expanded && quickHidden ? 'noactivity' : ''} ${viewing ? 'withviewer' : ''} ${dragging || viewer.dragging ? 'dragging' : ''}`} aria-label={c.ariaChat} style={expanded ? undefined : { width: width + (viewing ? viewer.width : 0) }}>
    {viewer.dialog}{!expanded && <div className="dockgrip" role="separator" aria-orientation="vertical" aria-label={viewing ? d.adjustFileWidth : d.adjustChatWidth} onPointerDown={viewing ? viewer.startResize : startResize} onDoubleClick={viewing ? undefined : resetWidth} />}
    {viewing && <>{diffOpen && diff ? <DiffPane cardId={card.id} target={diff} close={() => setDiff(undefined)} ask={sendReview} style={{ width: viewer.width }} /> : viewer.request && <FocusedFile projectId={project.id} cardId={card.id || null} chatId={chat?.id} request={viewer.request} close={viewer.close} setDirty={viewer.setDirty} style={{ width: viewer.width }} />}<ViewGrip viewer={viewer} /></>}
    <FileOpenContext.Provider value={openFile}><QuestionAnswerContext.Provider value={answerQuestions}>
    <div className="dock-in" style={expanded ? undefined : { width }}>
      <div className="dock-head" draggable={Boolean(card.id) && !pop} onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest('button,input,textarea,[role="tab"],.dock-tools')) setExpanded(!expanded) }} onDragStart={(event) => { if ((event.target as HTMLElement).closest('button,input,textarea,[role="tab"],.dock-tools')) { event.preventDefault(); return }; event.preventDefault(); void detachChat({ x: Math.round(event.screenX), y: Math.round(event.screenY) }) }}><div className="top"><div><div className="headrow">          <div className="tabs stepTabs" role="tablist" aria-label={c.cardChats}>{(['planning', 'execution', 'test'] as const).filter((step) => singleChat ? step === (chats[0]?.purpose ?? mode) : step === mode || chats.some((item) => item.purpose === step)).map((step) => { const working = card.run.purpose === step && (card.run.state === 'running' || card.run.state === 'planning'); return <button key={step} role="tab" aria-selected={mode === step} className={`tab ${mode === step ? 'on' : ''}`} onClick={() => step !== mode && onSwitch(step)}>{singleChat ? t.chat.roles.assistant : t.chat.steps[step]}{working ? <span className="spin sm" /> : null}</button> })}</div></div>
          <h2>{card.title || t.chat.tile.newCard}</h2><div className="ctxline"><span className="ctxchip">{columnLabel}</span>{card.id && <ComplexityBadge complexity={card.complexity} onClick={() => setAssessing(true)} />}{assessing && createPortal(<AssessmentDialog card={card} close={() => setAssessing(false)} changed={() => undefined} />, document.body)}{card.workspace && <span className="ctxchip ws tip" data-tip={c.worktreeTip(card.workspace.path)}><BranchIcon /><span className="wsname">{card.workspace.branch} · {worktreeName(card.workspace.path)}</span></span>}</div></div>
        <div className="dock-tools"><div className="dock-tools-wide">{card.id && !planning && <div className="viewtoggle sm" role="group" aria-label={c.chatOrGit}><button type="button" className={gitView ? '' : 'on'} aria-pressed={!gitView} onClick={() => setView('chat')}>{c.chatTab}</button><button type="button" className={gitView ? 'on' : ''} aria-pressed={gitView} onClick={() => setView('git')}><BranchIcon />Git{card.pending.commits > 0 && <i className="pendot" />}</button></div>}<ChatSearch messages={messages} log={log} request={chatSearch.request} reveal={gitView ? () => setView('chat') : undefined} />{card.id && <button type="button" className="ibtn tip" data-tip={t.chat.contextMenu.openCard} aria-label={t.chat.contextMenu.openCard} onClick={() => openEdit(card)}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="3.5" width="13" height="13" rx="2.5" /><path d="M7 8h6M7 11.5h4" /></svg></button>}{card.id && <PopMenu target={{ kind: 'chat', projectId: project.id, cardId: card.id, purpose: mode }} />}<button type="button" className="ibtn tip" data-tip={expanded ? d.backToCorner : d.expandFull} aria-label={expanded ? d.backToCorner : d.expandFull} onClick={() => setExpanded(!expanded)}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button><button className="x" aria-label={d.closeChat} onClick={close}><CloseIcon /></button></div><div className="dock-tools-compact"><ChatMoreMenu openCard={card.id ? () => openEdit(card) : undefined} searchRequest={chatSearch.request} messages={messages} log={log} projectId={project.id} cardId={card.id || undefined} purpose={mode} expand={() => setExpanded(true)} close={close} view={card.id && !planning ? { git: gitView, set: setView } : undefined} /><button className="x" aria-label={d.closeChat} onClick={close}><CloseIcon /></button></div></div></div></div>
      {gitView && <GitCardPanel cardId={card.id} profiles={profiles} openRules={() => openRules?.()} openGraph={(id) => openGraph?.(id)} diff={diff} setDiff={setDiff} />}
      <div className="chatlog" ref={log} style={gitView ? { display: 'none' } : undefined}>
        {!messages.length && !live && <div className="msg sys">{planning ? (specKit.state?.active ? c.emptySpecKit : c.emptyPlanning) : testing ? c.emptyTest : c.emptyExecution}</div>}
        <ChatMessageList messages={messages} busy={busy} />
        <AgentPermissions chatId={chat?.id} />
        {live && <div className="msg agent"><div className="md chatmd"><AgentMessage source={typed} live /><span className="caret" /></div></div>}
        {mode === 'execution' && card.id && <CommitAsks cardId={card.id} branch={card.workspace?.branch} profiles={profiles} openGit={() => setView('git')} />}
        {card.id && <SpecKitAsks card={card} spec={specKit.state} reload={specKit.reload} mode={mode} profiles={usable} onStarted={() => undefined} runNext={answerQuestions} onSwitch={onSwitch} busy={busy} dockHost={dockHost} />}
        {card.id && <ApprovalAsks cardId={card.id} />}
        {busy && <ThinkingIndicator purpose={mode} messages={messages} since={busySince} />}
      </div>
      <ChatReplySelection log={log} scope={`${project.id}:${card.id}:${mode}:${chat?.id ?? ''}:${view}`} add={(reply) => { replies.add(reply); mention.ref.current?.focus() }} />
      <div className="composer" ref={wrap} style={gitView ? { display: 'none' } : undefined}>
        {inactive && <div className="convbox"><p>{c.inactiveBefore}<b>{inactive.label.replace(' (desativado)', '')}</b>{c.inactiveAfter}</p><div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => void resetInactive()}>{c.restartChat}</button></div></div>}
        {(error || dictation.error) && <p className="error">{error || dictation.error}</p>}
        {voiceSetup && !voiceReady && dictation.status?.cloud && <div className="convbox"><p>{c.voiceGroq}</p><div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setVoiceSetup(false)}>{t.common.close}</button></div></div>}
        {voiceSetup && !voiceReady && dictation.status && !dictation.status.cloud && <div className="convbox"><p>{c.voiceLocal(dictation.status.engineInstalled ? 'none' : dictation.status.canInstallEngine ? 'engine' : 'enginePath', dictation.status.sizeMb)}</p><div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setVoiceSetup(false)}>{d.notNow}</button><button type="button" disabled={Boolean(dictation.progress) || (!dictation.status.engineInstalled && !dictation.status.canInstallEngine)} onClick={() => void dictation.install().then(() => setVoiceSetup(false))}>{dictation.progress || d.download}</button></div></div>}
        {later.queued && <QueuedPreview text={later.queued} files={later.files} busy={busy} sendNow={() => later.sendNow(cancel)} edit={() => { const item = later.take(), text = replies.restore(item.text); setInput((value) => `${text}${value ? `\n${value}` : ''}`); attach.add(item.files) }} discard={later.discard} />}
        <div className="skdock-host" ref={setDockHost} />
        <div className={`cbox ${attach.dragging ? 'dropping' : ''}`} {...attach.dropProps}>
          {((!inactive && testShortcuts.length > 0) || attach.files.length > 0 || replies.items.length > 0) && <div className="cbox-top">
            {!inactive && testShortcuts.length > 0 && <div className="testbar" role="group" aria-label={c.testShortcuts}>{testShortcuts.map((item) => <button type="button" key={item.label} className="mini secondary" onClick={item.run}>{item.label}</button>)}</div>}
            <AttachmentChips files={attach.files} remove={attach.remove} />
            <ReplyContextCards replies={replies.items} remove={replies.remove} />
          </div>}
          <AttachButton onClick={() => void attach.choose()} />
          {mention.menu}{slashOpen && <div ref={slashMenu} className="atmenu skillslash-menu" role="listbox" aria-label={c.availableSkills} onMouseDown={(event) => event.preventDefault()}>{slashSkills.map((entry, index) => <button type="button" role="option" aria-selected={index === skillIndex} key={entry.id} className={`atitem ${index === skillIndex ? 'on' : ''}`} onMouseEnter={() => setSkillIndex(index)} onClick={() => chooseSlashSkill(entry)}><span className="skillslash-name">/{entry.name}</span><span className="atpath">{entry.description || (entry.scope === 'project' ? c.projectSkill : c.globalSkill)}</span></button>)}</div>}<div className="hlwrap"><InputMirror text={input} skillNames={skillNames} area={mention.ref} /><textarea rows={1} aria-label={d.messageToAgent} value={input} placeholder={dictation.recording ? d.listening : planning ? c.placeholderPlanning : testing ? c.placeholderTest : c.placeholderExecution} ref={mention.ref} onSelect={(e) => { mention.caret(e.currentTarget.selectionStart); setInputCaret(e.currentTarget.selectionStart) }} onChange={(e) => { setInput(e.target.value); mention.caret(e.target.selectionStart); setInputCaret(e.target.selectionStart); setSkillIndex(0) }} onKeyDown={(e) => { if (mention.keyDown(e) || slashKeyDown(e)) return; const dropped = dropToken(e, input, skillNames); if (dropped) { e.preventDefault(); setInput(dropped.text); setInputCaret(dropped.at); mention.caret(dropped.at); if (dropped.token.kind === 'skill' && skill?.name === dropped.token.word.slice(1)) void chooseSkill(null); window.requestAnimationFrame(() => mention.ref.current?.setSelectionRange(dropped.at, dropped.at)); return }; if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} /></div>
          {dictation.recording && <span className="wave"><i /><i /><i /><i /><i /><i /><i /></span>}
          {busy && <button type="button" className="sendbtn stop tip" data-tip={d.stop} aria-label={d.stop} onClick={() => void stop()}><StopIcon /></button>}<button type="button" className="sendbtn tip" data-tip={busy ? d.queueTip : d.sendTip} aria-label={busy ? d.queue : d.send} hidden={!input.trim() && !replies.items.length && !attach.files.length} onClick={() => void send()}><SendIcon /></button>
          <button type="button" className={`micbtn tip ${dictation.recording ? 'on' : ''}`} data-tip={dictation.recording ? d.stopListening : dictation.transcribing ? d.transcribing : d.dictate} aria-label={d.dictate} aria-pressed={dictation.recording} disabled={dictation.transcribing || !dictation.status} onClick={() => (voiceReady ? void dictation.toggle() : setVoiceSetup(true))}>{dictation.transcribing ? <span className="spin sm" /> : <MicIcon />}</button>
        </div>
        <div className="cmeta">
          {planning ? <><SpecKitModeChip cardId={card.id} spec={specKit.state} reload={specKit.reload} />
            <span className="modewrap" style={{ display: "none" }}><button type="button" className={`skillchip ${menu === 'skill' ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={menu === 'skill'} data-tip={c.planningSkill} onClick={() => { setSkillFilter(''); setMenu(menu === 'skill' ? null : 'skill') }}>{skill?.name ?? c.sddPlanning}</button>
              {menu === 'skill' && <div className="modemenu skillmenu" role="menu"><div className="mm-title">{c.planningSkill}</div>
                <input ref={skillFilterInput} className="in" type="search" value={skillFilter} placeholder={c.filterSkills} aria-label={c.filterSkillsLabel} onChange={(event) => setSkillFilter(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setMenu(null) }} />
                {!skillFilter.trim() && <button type="button" role="menuitem" className="modeopt" onClick={() => void chooseSkill(null)}><span className="mo-t"><b>{c.sddPlanning}</b><em>{c.default}</em><small>{c.system}</small></span><span className="mo-r">{!skill && <CheckIcon />}</span></button>}
                {available.filter((item) => `${item.name} ${item.description}`.toLocaleLowerCase().includes(skillFilter.trim().toLocaleLowerCase())).map((item) => { const path = provider ? item.paths[provider]! : ''; return <button type="button" role="menuitem" key={item.id} className="modeopt" onClick={() => void chooseSkill({ name: item.name, path })}><span className="mo-t"><b>{item.name}</b><small>{item.scope === 'project' ? c.fromProject : c.global}</small></span><span className="mo-r">{skill?.path === path && <CheckIcon />}</span></button> })}</div>}</span></>
            : <span className="modewrap"><button type="button" className={`modechip ${menu === 'mode' ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={menu === 'mode'} onClick={() => setMenu(menu === 'mode' ? null : 'mode')}>{currentMode ? modeText(currentMode).label : d.mode}</button>
              {menu === 'mode' && <div className="modemenu" role="menu"><div className="mm-title">{d.mode}</div>{execModes.map((item, index) => <button type="button" role="menuitem" key={item.id} disabled={item.needsApprovalUi} data-tip={item.needsApprovalUi ? d.needsApproval : undefined} className="modeopt" onClick={() => { setMenu(null); void agentState.update({ mode: item.id }) }}><span className="mo-t"><b>{modeText(item).label}</b>{item.recommended && <em>{d.recommended}</em>}<small>{modeText(item).description}</small></span><span className="mo-r">{agentState.config?.mode === item.id ? <CheckIcon /> : index + 1}</span></button>)}</div>}</span>}
          <div className="pick"><AgentBackground chatId={chat?.id} /><UsageRings profileId={agentState.config?.profileId ?? chat?.profileId} /><ModelMenu profiles={usable} purpose={mode} state={agentState} lockProfile={Boolean(chat)} onLockedPick={setSwitchTo} /></div>
        </div>
      </div>
    </div>
    </QuestionAnswerContext.Provider></FileOpenContext.Provider>
    {testChoice && <ConfirmDialog eyebrow={c.testChoiceEyebrow} title={c.testChoiceTitle} text={c.testChoiceText} ok={c.watchBrowser} secondary={{ label: c.runBackground, run: () => { setTestChoice(false); answerQuestions(retestPrompt(false)) } }} cancel={() => setTestChoice(false)} confirm={() => { setTestChoice(false); answerQuestions(retestPrompt(true)) }} />}
    {switchTo && <ConfirmDialog eyebrow={d.switchAgent} title={c.restartWith(switchTo.label)} text={c.restartText} ok={c.switchAndRestart} danger cancel={() => setSwitchTo(undefined)} confirm={() => void resetAndSwitch(switchTo)} />}
    {/* Só com o chat em tela cheia: coluna à esquerda com o progresso (Tasks ou checklist do teste) e as Alterações. Dividindo a tela com o quadro, não aparece. */}
    {expanded && diffOpen && diff && <DiffPane cardId={card.id} target={diff} close={() => setDiff(undefined)} ask={sendReview} />}
    {expanded && !diffOpen && !planning && card.id && <div className="dockside"><ProgressCard key={`${card.id}-${mode}-${columnState}`} cardId={card.id} purpose={mode === 'test' || (fullAgent && columnState === 'test') ? 'test' : 'execution'} />{(card.workspace || fullAgent) && <ChangesCard key={card.id} cardId={card.id} projectId={project.id} busy={busy} shared={card.workspace?.sharedFrom ?? null} />}</div>}
    {expanded && !diffOpen && !quickHidden && <Activity board={board} cardId={card.id} profiles={profiles} openEdit={openEdit} hide={() => setQuickHidden(true)} />}
    {expanded && !diffOpen && quickHidden && <button type="button" className="qv-show tip" data-tip={act.show} aria-label={act.show} onClick={() => setQuickHidden(false)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 4-6 6 6 6" /></svg>{act.quickView}</button>}
  </section>
}
