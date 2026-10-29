import { SettingsIcon } from './SettingsIcon'
import { toast } from './toasts'
import { ColumnMenu } from './ColumnMenu'
import { useToolsPending } from './ToolsPanel'
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentProfile, AgentPurpose, Card, Chat, ProjectBoard } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { CardChat } from './CardChat'
import { CardContextMenu } from './CardContextMenu'
import { ChatsPage } from './ChatsPage'
import { GitPage } from './GitPage'
import { PopMenu } from './PopMenu'
import { pop } from './popout'
import { terminal } from './terminalStore'
import { worktreeName } from './workspace'
import { FreeChat } from './FreeChat'
import { blankDraft, CardEditor, type Draft } from './CardEditor'
import { ConfirmDialog } from './ConfirmDialog'
import { ArchiveIcon, BoardIcon, BranchIcon, ChatIcon, EyeIcon, PlayIcon, SparkIcon, StopIcon } from './icons'
import { NewCardDialog } from './NewCardDialog'
import { PendingDialog } from './PendingDialog'
import { NoAgentDialog } from './ProjectDialogs'
import { WindowIcon } from './WindowLayoutMenu'
import { StartDialog } from './StartDialog'
import { AssessmentDialog, ComplexityBadge } from './Assessment'
import { plainError } from './NoticeDialog'

export const priorityLabel: Record<Card['priority'], string> = { urgent: 'Urgente', high: 'Alta', medium: 'Média', low: 'Baixa' }
const plain = (markdown: string): string => markdown.replace(/^#+ .*$/gm, '').replace(/\[[ xX]\]/g, '').replace(/[-*`#]/g, '').replace(/\n+/g, ' ').trim()

type State = 'backlog' | 'todo' | 'doing' | 'test' | 'done'
/** Etapa do chat ao abrir o card: a que está rodando; senão a da coluna (Test = teste, Doing/Done = implementação, o resto = planejamento). */
export function chatMode(board: ProjectBoard, card: Card): AgentPurpose {
  const fresh = board.cards.find((item) => item.id === card.id) ?? card, state = board.columns.find((column) => column.id === fresh.columnId)?.semanticState
  if (fresh.run.state === 'planning') return 'planning'
  if (fresh.run.state !== 'idle' && fresh.run.purpose) return fresh.run.purpose
  if (state === 'test') return 'test'
  return state === 'doing' || state === 'done' ? 'execution' : 'planning'
}

/** Card "virtual" (ainda não existe no banco) do planejamento aberto sem card: id vazio até a primeira mensagem. */
function draftCard(board: ProjectBoard, columnId: string): Card {
  const now = new Date().toISOString()
  return { id: '', projectId: board.project.id, columnId, sourceId: null, type: 'task', title: '', description: '', priority: 'medium', orderKey: 0, createdAt: now, updatedAt: now, archivedAt: null, acceptanceCriteria: [], tasks: { done: 0, total: 0 }, run: { state: 'idle', runId: null, profileId: null, purpose: null }, hasPlan: false, planningOpen: false, workspace: null, pending: { changes: 0, questions: 0, commits: 0, toSend: 0 }, execProfileId: null, execModel: null, agentIds: [], complexity: null, repoIds: null } as Card
}

function CardTile({ card, state, agent, agents, dropLabel, dragProps, onPending, onSend, onGit, onOpen, onChat, onPlan, onStart, onTest, onStop, onResume, onArchive, onComplexity }: { card: Card; state: State; agent?: AgentProfile; agents: AgentProfile[]; dropLabel?: string; dragProps: React.HTMLAttributes<HTMLElement>; onPending(): void; onSend(): void; onGit(): void; onOpen(): void; onChat(): void; onPlan(): void; onStart(): void; onTest(): void; onStop(): void; onResume(): void; onArchive(): void; onComplexity(): void }): React.JSX.Element {
  const run = card.run.state, open = card.planningOpen, ready = run === 'idle' && card.hasPlan && (state === 'backlog' || state === 'todo')
  const { done, total } = card.tasks
  const button = (cls: string, tip: string, click: () => void, icon: React.ReactNode): React.JSX.Element => <button type="button" className={`ib ${cls} tip`} data-tip={tip} aria-label={tip} onClick={(e) => { e.stopPropagation(); click() }}>{icon}</button>
  return <article className={`card ${run === 'finished' ? 'fin' : ''} ${run === 'paused' ? 'paused' : ''} ${open ? 'planopen' : ''} ${ready ? 'ready' : ''} ${dropLabel ? 'drop-before' : ''}`} data-plabel={dropLabel} onClick={onOpen} {...dragProps}>
    <div className="pills"><span className={`pill ${card.type}`}>{card.type === 'minor' ? 'pequena' : card.type}</span><span className={`pill ${card.priority}`}>{card.priority}</span><ComplexityBadge complexity={card.complexity} onClick={onComplexity} /></div>
    <button type="button" className="cardchat tip" data-tip="Abrir chat" aria-label="Abrir chat" onClick={(e) => { e.stopPropagation(); onChat() }}><ChatIcon /></button>
    <h3>{card.title || 'Novo card'}</h3>
    {card.description && <div className="desc">{plain(card.description)}</div>}
    {card.pending.changes > 0 && <button type="button" className="badge ask" onClick={(e) => { e.stopPropagation(); onPending() }}><span className="dot pulse" />{card.pending.changes === 1 ? 'Mudança aguardando sua autorização' : `${card.pending.changes} mudanças aguardando você`}</button>}
    {card.pending.toSend > 0 && <button type="button" className="badge ask" title="A mudança já foi autorizada. Clique para mandar o desenvolvedor implementar." onClick={(e) => { e.stopPropagation(); onSend() }}><span className="dot pulse" />{card.pending.toSend === 1 ? 'Mudança autorizada · mandar implementar' : `${card.pending.toSend} mudanças · mandar implementar`}</button>}
    {card.pending.questions > 0 && <button type="button" className="badge ask" onClick={(e) => { e.stopPropagation(); onPending() }}><span className="dot pulse" />{card.pending.questions === 1 ? 'Pergunta para você' : `${card.pending.questions} perguntas para você`}</button>}
    {card.pending.commits > 0 && <button type="button" className="badge ask" onClick={(e) => { e.stopPropagation(); onGit() }}><span className="dot pulse" />{card.pending.commits === 1 ? 'Commit aguardando você' : `${card.pending.commits} commits aguardando você`}</button>}
    {open && <span className="badge plan"><span className="dot" />Em planejamento</span>}
    {run === 'idle' && !card.hasPlan && (state === 'backlog' || state === 'todo') && <button type="button" className="mini planbtn" onClick={(e) => { e.stopPropagation(); onPlan() }}><SparkIcon />{open ? 'Continuar planejamento' : 'Ir para planejamento'}</button>}
    {run === 'planning' && <span className="badge plan"><span className="dot pulse" />Planejando com agente</span>}
    {ready && <span className="badge ready"><span className="dot softpulse" />Plano pronto</span>}
    {run === 'paused' && <span className="badge paused"><span className="dot softpulse" />Pausado</span>}
    {run === 'finished' && <button type="button" className="badge fin" onClick={(e) => { e.stopPropagation(); onChat() }}><span className="dot pulse" />Terminou · ver chat</button>}
    {run === 'running' && <div className="running" data-purpose={card.run.purpose} role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onChat() }} onKeyDown={(e) => { if (e.key === 'Enter') onChat() }}><div className="row"><span className="spin" />{agent && <AgentIcon profile={agent} />}<span style={{ color: '#8d968f' }}>{card.execModel ?? ''}</span></div><span style={{ fontSize: 11, color: 'var(--accent)' }}>{card.run.purpose === 'test' ? 'Testando · toque para ver' : 'Toque para ver execução'}</span></div>}
    <div className="cfoot">
      <span className="ownr">{(agents.length ? agents : agent ? [agent] : []).length > 0 && <span className="agentstack">{(agents.length ? agents : [agent!]).map((profile) => <AgentIcon key={profile.id} profile={profile} />)}</span>}{!open && <span className="cnt">{card.type === 'minor' ? 'um agente só' : total ? `${done}/${total} tasks` : 'sem tasks'}</span>}</span>
      <div className="btns">
        {card.workspace && <button type="button" className="ib view ws tip" data-tip={`Branch: ${card.workspace.branch}\nWorktree: ${worktreeName(card.workspace.path)}\nBase: ${card.workspace.baseRef}`} aria-label={`Branch ${card.workspace.branch}: abrir o Git do card`} onClick={(e) => { e.stopPropagation(); onGit() }}><BranchIcon /></button>}
        {(state === 'todo' || state === 'backlog') && (run !== 'idle' || card.hasPlan) && button('plan', 'Planejar', onPlan, <SparkIcon />)}
        {run === 'paused' && button('view', 'Ver chat', onChat, <EyeIcon />)}
        {run === 'paused' && button('start', 'Continuar', onResume, <PlayIcon />)}
        {state === 'doing' && run !== 'running' && run !== 'paused' && button('start', 'Iniciar', onStart, <PlayIcon />)}
        {state === 'test' && card.type !== 'minor' && run !== 'running' && run !== 'paused' && button('start', 'Testar', onTest, <PlayIcon />)}
        {run === 'running' && button('stop', 'Parar', onStop, <StopIcon />)}
        {state === 'done' && button('view', 'Arquivar', onArchive, <ArchiveIcon />)}
        {run === 'finished' && button('done', 'Ver resultado', onChat, <EyeIcon />)}
      </div>
    </div>
  </article>
}

type ProjectView = 'board' | 'chats' | 'git'
const dockPinKey = 'agentboard.viewDockPinned'
const dockPointKey = 'agentboard.viewDockPoint'
const readDockPoint = (): { x: number; y: number } | null => { try { const value = JSON.parse(localStorage.getItem(dockPointKey) ?? 'null') as { x?: unknown; y?: unknown } | null; return value && typeof value.x === 'number' && typeof value.y === 'number' ? { x: value.x, y: value.y } : null } catch { return null } }

/** Seletor de visão destacável: a marca é a alça para mover o dock e também abre as opções de fixação. */
function ViewDock({ projectId, view, select }: { projectId: string; view: ProjectView; select(value: ProjectView): void }): React.JSX.Element {
  const [pinned, setPinned] = useState(() => { try { return localStorage.getItem(dockPinKey) === '1' } catch { return false } })
  const [point, setPoint] = useState(readDockPoint)
  const [snapping, setSnapping] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'dock' | ProjectView }>()
  const dock = useRef<HTMLDivElement>(null), moved = useRef(false)
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(undefined)
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key) }
  }, [menu])
  const pin = (value: boolean): void => { setPinned(value); setMenu(undefined); try { localStorage.setItem(dockPinKey, value ? '1' : '0') } catch { /* preferência apenas desta instalação */ } }
  const beginMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); moved.current = false
    const rect = dock.current?.getBoundingClientRect(); if (!rect) return
    const startX = event.clientX, startY = event.clientY, left = rect.left, top = rect.top, snapLine = 48
    let detached = !pinned, lastY = startY
    const move = (next: PointerEvent): void => {
      lastY = next.clientY
      if (!detached && Math.abs(next.clientX - startX) + Math.abs(next.clientY - startY) < 6) return
      if (Math.abs(next.clientX - startX) + Math.abs(next.clientY - startY) >= 6) moved.current = true
      if (!detached) { detached = true; pin(false) }
      setSnapping(next.clientY <= snapLine)
      const x = Math.round(Math.max(8, Math.min(window.innerWidth - rect.width - 8, left + next.clientX - startX)))
      const y = Math.round(Math.max(44, Math.min(window.innerHeight - rect.height - 8, top + next.clientY - startY)))
      setPoint({ x, y })
    }
    const up = (): void => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); setSnapping(false)
      if (!detached) return
      if (lastY <= snapLine) { pin(true); return }
      const rectNow = dock.current?.getBoundingClientRect(); if (rectNow) try { localStorage.setItem(dockPointKey, JSON.stringify({ x: Math.round(rectNow.left), y: Math.round(rectNow.top) })) } catch { /* preferência apenas desta instalação */ }
    }
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up)
  }
  const openViewWindow = (kind: ProjectView): void => { setMenu(undefined); void window.agentboard.invoke('windows:open', { kind, projectId, placement: 'new' }) }
  const context = (event: React.MouseEvent, kind: 'dock' | ProjectView): void => { event.preventDefault(); event.stopPropagation(); setMenu({ x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 70), kind }) }
  return <div ref={dock} className={`viewdock ${pinned ? 'pinned' : 'floating'} ${!point ? 'default' : ''} ${snapping ? 'snapping' : ''}`} style={!pinned && point ? { left: point.x, top: point.y } : undefined}>
    <div className="viewtoggle" role="group" aria-label="Visão do projeto">
      <button type="button" className="viewdock-handle tip" data-tip="Opções do menu · arraste para mover" aria-label="Opções do menu de visões" aria-haspopup="menu" aria-expanded={menu?.kind === 'dock'} onPointerDown={beginMove} onClick={(event) => { if (moved.current) { moved.current = false; return }; const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: Math.max(8, Math.min(rect.left, window.innerWidth - 220)), y: Math.min(rect.bottom + 4, window.innerHeight - 70), kind: 'dock' }) }} onContextMenu={(event) => context(event, 'dock')}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></button>
      <button type="button" className={view === 'board' ? 'on' : ''} aria-pressed={view === 'board'} onContextMenu={(event) => context(event, 'board')} onClick={() => select('board')}><BoardIcon />Quadro</button>
      <button type="button" className={view === 'chats' ? 'on' : ''} aria-pressed={view === 'chats'} onContextMenu={(event) => context(event, 'chats')} onClick={() => select('chats')}><ChatIcon />Chats</button>
      <button type="button" className={view === 'git' ? 'on' : ''} aria-pressed={view === 'git'} onContextMenu={(event) => context(event, 'git')} onClick={() => select('git')}><BranchIcon />Git</button>
    </div>
    {menu && createPortal(<div className="popmenu viewdock-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>{menu.kind === 'dock' ? <button type="button" role="menuitem" className="pm-item" onClick={() => pin(!pinned)}>{pinned ? 'Desfixar do header' : 'Fixar no header'}</button> : <button type="button" role="menuitem" className="pm-item pm-ico" onClick={() => openViewWindow(menu.kind as ProjectView)}><WindowIcon />Abrir em nova janela</button>}</div>, document.body)}
  </div>
}

export function Board({ board, profiles, history, refresh, onProjectConfig, openSettings, freeRequest, freeHandled, constitutionRequest, constitutionHandled, openTarget, targetHandled, slots }: { slots?: { view: HTMLElement | null; gear: HTMLElement | null; tray?: HTMLElement | null }; board: ProjectBoard; profiles: AgentProfile[]; history: AgentProfile[]; refresh(): Promise<void>; onProjectConfig(tab?: 'general' | 'git'): void; openSettings(): void; freeRequest?: { projectId: string; at: number }; freeHandled(): void; constitutionRequest?: { projectId: string; prompt?: string; at: number }; constitutionHandled(): void; openTarget?: { projectId: string; cardId: string | null; chatId: string | null; purpose: string | null }; targetHandled(): void }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(), [chatCard, setChatCardState] = useState<Card>(), [chatPurpose, setChatPurpose] = useState<AgentPurpose>('planning'), [starting, setStartingState] = useState<{ card: Card; purpose: 'execution' | 'test' }>(), [choosing, setChoosing] = useState<string>(), [stopping, setStopping] = useState<Card>(), [pendingCard, setPendingCard] = useState<Card>(), [assessing, setAssessing] = useState<Card>()
  /** Manda ao desenvolvedor cada mudança já autorizada do card que ainda não foi enviada. */
  const sendChanges = async (cardId: string): Promise<void> => {
    try { const { changes } = await window.agentboard.invoke('collab:list', { cardId }); for (const change of changes) if ((change.status === 'accepted' || change.status === 'applied') && !change.sentAt) await window.agentboard.invoke('collab:send-change', { changeId: change.id }); await refresh() } catch (reason) { say(String(reason).replace(/^Error: /, ''), 'error') }
  }
  const [gate, setGate] = useState<{ cardId: string; columnId: string; beforeCardId: string | null; stage: 'test' | 'review' }>(), [dragId, setDragId] = useState<string>(), [dropOn, setDropOn] = useState<string>(), [overColumn, setOverColumn] = useState<string>()
  const [filtersOpen, setFiltersOpen] = useState(false), [boardQuery, setBoardQuery] = useState(''), [priorityFilter, setPriorityFilter] = useState<Card['priority'] | ''>(''), [typeFilter, setTypeFilter] = useState<Card['type'] | ''>(''), [agentFilter, setAgentFilter] = useState('')
  const allowed = profiles.filter((profile) => board.project.allowedProfileIds.includes(profile.id))
  // O terminal abre na pasta do projeto (o chat de um card troca para a worktree dele).
  useEffect(() => { terminal.setContext({ projectId: board.project.id, cardId: null }) }, [board.project.id])
  const active = board.cards.filter((card) => !card.archivedAt)
  const filtering = Boolean(boardQuery.trim() || priorityFilter || typeFilter || agentFilter)
  const visibleCards = active.filter((card) => (!priorityFilter || card.priority === priorityFilter) && (!typeFilter || card.type === typeFilter) && (!agentFilter || card.agentIds.includes(agentFilter) || card.execProfileId === agentFilter || card.run.profileId === agentFilter) && `${card.title} ${card.description}`.toLocaleLowerCase().includes(boardQuery.trim().toLocaleLowerCase()))
  const [archivingColumn, setArchivingColumn] = useState<string>(), toolsPending = useToolsPending(board.project.id)
  const archiveColumn = async (columnId: string): Promise<void> => {
    const targets = board.cards.filter((card) => !card.archivedAt && card.columnId === columnId)
    const results = await Promise.allSettled(targets.map((card) => window.agentboard.invoke('cards:archive', { cardId: card.id })))
    const failed = results.filter((item) => item.status === 'rejected').length
    say(failed ? `${targets.length - failed} arquivados; ${failed} não puderam ser arquivados (em andamento?)` : `${targets.length} ${targets.length === 1 ? 'card arquivado' : 'cards arquivados'}`, failed ? 'error' : undefined)
    await refresh()
  }
  const [chatsOpen, setChatsOpen] = useState(pop?.kind === 'chats'), [gitOpen, setGitOpen] = useState(pop?.kind === 'git'), [gitCardId, setGitCardId] = useState<string>(), [gitFocus, setGitFocus] = useState<{ cardId: string; at: number }>()
  const [menu, setMenu] = useState<{ x: number; y: number; card: Card }>(), [deleting, setDeleting] = useState<Card>()
  // Excluiu o card (pelo menu, pelo editor ou por outro caminho) com o chat dele aberto: fecha o chat junto.
  useEffect(() => { if (chatCard && !board.cards.some((item) => item.id === chatCard.id)) setChatCardState(undefined) }, [board.cards, chatCard])
  // Planejamento aberto sem card: o card só é criado na primeira mensagem (ensureCard); fechar sem escrever não cria nada.
  const [draftPlan, setDraftPlan] = useState<{ columnId: string }>(), [chatInstance, setChatInstance] = useState(0)
  const [freeChat, setFreeChat] = useState<{ chat?: Chat; key: number; mode?: 'free' | 'constitution'; prompt?: string }>(), [openAfterRefresh, setOpenAfterRefresh] = useState<string>()
  const setChatCard = (card: Card | undefined, purpose?: AgentPurpose): void => {
    const open = (next: AgentPurpose): void => { setChatCardState(card); setDraftPlan(undefined); setFreeChat(undefined); setChatPurpose(next); setChatInstance((value) => value + 1) }
    if (!card) { setChatCardState(undefined); setDraftPlan(undefined); return }
    // Tarefa pequena tem um chat só: abre o que existe (o do planejamento, se foi ele que trabalhou), não uma etapa que nunca teve conversa.
    if (card.type === 'minor' && card.id) { const fallback = purpose ?? chatMode(board, card); void window.agentboard.invoke('chats:list', { projectId: board.project.id, cardId: card.id }).then((items) => { const steps = items.map((item) => item.purpose).filter((value): value is AgentPurpose => value === 'planning' || value === 'execution' || value === 'test'); open(steps.find((value) => value === 'execution') ?? steps[0] ?? fallback) }).catch(() => open(fallback)); return }
    open(purpose ?? chatMode(board, card))
  }
  const openFree = (chat?: Chat): void => { setChatCardState(undefined); setFreeChat({ chat, key: Date.now(), mode: chat?.purpose === 'constitution' ? 'constitution' : 'free' }) }
  // "+" do projeto na barra lateral: abre um chat livre novo neste projeto assim que o quadro dele carrega.
  useEffect(() => {
    if (!freeRequest || freeRequest.projectId !== board.project.id) return
    freeHandled(); setChatCardState(undefined); setFreeChat({ key: Date.now() })
  }, [freeRequest, board.project.id, freeHandled])
  // Aba Constituição do projeto: abre o chat dela (continua o último, se houver), opcionalmente já com um pedido.
  useEffect(() => {
    if (!constitutionRequest || constitutionRequest.projectId !== board.project.id) return
    const { prompt } = constitutionRequest
    constitutionHandled()
    void window.agentboard.invoke('chats:list', { projectId: board.project.id, cardId: null }).catch(() => [] as Chat[]).then((items) => {
      setChatsOpen(false); setChatCardState(undefined)
      setFreeChat({ chat: items.find((item) => item.purpose === 'constitution'), key: Date.now(), mode: 'constitution', prompt })
    })
  }, [constitutionRequest, board.project.id, constitutionHandled])
  // Clique numa notificação do sistema: abre o chat do card (na etapa certa) ou o chat livre.
  useEffect(() => {
    if (!openTarget || openTarget.projectId !== board.project.id) return
    if (openTarget.cardId) {
      const card = board.cards.find((item) => item.id === openTarget.cardId)
      if (!card) return
      targetHandled(); setChatsOpen(false); setChatCard(card, openTarget.purpose === 'planning' || openTarget.purpose === 'execution' || openTarget.purpose === 'test' ? openTarget.purpose : undefined)
    } else if (openTarget.chatId) {
      const chatId = openTarget.chatId
      targetHandled(); void window.agentboard.invoke('chats:list', { projectId: board.project.id }).then((items) => { const chat = items.find((item) => item.id === chatId); if (chat) { setChatsOpen(false); openFree(chat) } })
    }
  }, [openTarget, board.project.id, board.cards])
  // O chat livre virou planejamento de um card novo: espera o quadro atualizar e abre o chat do card (o mesmo chat, agora de planejamento).
  useEffect(() => {
    if (!openAfterRefresh) return
    const card = board.cards.find((item) => item.id === openAfterRefresh)
    if (card) { setOpenAfterRefresh(undefined); setChatCard(card, 'planning') }
  }, [openAfterRefresh, board.cards])
  // Painel Git do card: abre o chat da etapa atual (implementação ou teste) já na visão Git.
  const openCardGit = (cardId: string): void => { const card = board.cards.find((item) => item.id === cardId); if (!card) return; const mode = chatMode(board, card); setGitCardId(cardId); setChatsOpen(false); setChatCard(card, mode === 'planning' ? 'execution' : mode) }
  // Ações do usuário que deram certo ou erraram, e o que o agente fez sozinho (notificação).
  const say = (text: string, kind: 'success' | 'error' | 'notify' = 'success'): void => { if (kind === 'error') toast.error('Não foi possível concluir', text); else if (kind === 'notify') toast.notify(text); else toast.success(text) }
  useEffect(() => { const again = (): void => void refresh(); window.addEventListener('agentboard:board-changed', again); return () => window.removeEventListener('agentboard:board-changed', again) }, [refresh])
  // O agente mexeu na worktree de outro card: oferece usar a mesma (uma pergunta por card e dono, enquanto o app está aberto).
  const [foreign, setForeign] = useState<{ cardId: string; ownerCardId: string; ownerTitle: string }>(), asked = useRef(new Set<string>())
  useEffect(() => window.agentboard.onRunEvent((event) => {
    if (event.eventType !== 'agentboard/worktree-foreign') return
    const info = event.payload as { cardId: string; ownerCardId: string; ownerTitle: string }, key = `${info.cardId}:${info.ownerCardId}`
    if (!asked.current.has(key)) { asked.current.add(key); setForeign(info) }
  }), [])
  useEffect(() => window.agentboard.onRunEvent((event) => {
    if (!['agentboard/card-updated', 'agentboard/run-started', 'agentboard/run-completed'].includes(event.eventType)) return
    if (event.payload.type === 'moved') say(`O agente moveu o card para ${String(event.payload.column)}`, 'notify')
    void refresh()
  }), [refresh])
  const move = async (cardId: string, columnId: string, beforeCardId: string | null, skipGate = false): Promise<void> => {
    const before = board.cards.find((card) => card.id === cardId)
    try {
      // Indo para Done sem teste automatizado aprovado e revisão: pergunta antes, em vez de só dar erro.
      if (!skipGate && before && before.columnId !== columnId && board.columns.find((column) => column.id === columnId)?.semanticState === 'done') {
        const quality = await window.agentboard.invoke('quality:status', { cardId })
        const passed = quality.test?.status === 'passed', reviewed = quality.review?.state === 'approved' || quality.review?.state === 'merged'
        if (!passed || !reviewed) { setGate({ cardId, columnId, beforeCardId, stage: passed ? 'review' : 'test' }); return }
      }
      const moved = await window.agentboard.invoke('cards:move', { cardId, columnId, beforeCardId, skipGate })
      if (before && before.priority !== moved.priority) say(`Prioridade alterada para ${priorityLabel[moved.priority]}`)
    } catch (reason) { say(plainError(reason), 'error') }
    await refresh()
  }
  const runGateTests = (card: Card): void => {
    let command = ''; try { command = localStorage.getItem(`agentboard.testCommand.${board.project.id}`) ?? '' } catch { /* sem comando salvo */ }
    const parts = command.trim().split(/\s+/).filter(Boolean)
    if (!parts.length) { setChatCard(card, 'test'); say('Defina o comando de teste do projeto no painel Alterações do chat de Teste.', 'notify'); return }
    say('Rodando os testes automatizados do card…', 'notify')
    void window.agentboard.invoke('tests:run', { cardId: card.id, executable: parts[0]!, args: parts.slice(1) }).then((run) => { if (run.status === 'passed') say('Testes automatizados passaram. Falta revisar as alterações para ir para Done.'); else say('Os testes automatizados falharam.', 'error'); return refresh() }).catch((reason: unknown) => say(plainError(reason), 'error'))
  }
  const dropLabel = (target: Card): string | undefined => { const dragged = board.cards.find((card) => card.id === dragId); if (!dragged || dragged.id === target.id) return undefined; return dragged.priority === target.priority ? 'Mesma prioridade' : `Vira prioridade ${priorityLabel[target.priority]}` }
  const edit = (card: Card): Draft => ({ id: card.id, columnId: card.columnId, sourceId: card.sourceId, title: card.title, type: card.type, priority: card.priority })
  const clear = (): void => { setDragId(undefined); setDropOn(undefined); setOverColumn(undefined) }
  const fresh = (card: Card): Card => board.cards.find((item) => item.id === card.id) ?? card
  const columnLabel = (card: Card): string => board.columns.find((column) => column.id === fresh(card).columnId)?.label ?? ''
  // Quadro/Chats/Git, o botão de janela e a engrenagem ficam na barra de título (portais nos espaços dela); sem os espaços, ficam aqui no cabeçalho.
  const gearControl = <button type="button" className={slots?.gear ? 'ibtn tip tb-gearbtn' : 'iconbtn'} title="Configurar projeto" aria-label="Configurar projeto" data-tip="Configurar projeto" onClick={() => onProjectConfig()}>{toolsPending && <i className="gear-dot" aria-hidden="true" />}{slots?.gear ? <SettingsIcon /> : '⚙'}</button>
  const currentView: ProjectView = gitOpen ? 'git' : chatsOpen ? 'chats' : 'board'
  const selectView = (value: ProjectView): void => { setDraft(undefined); window.dispatchEvent(new Event('agentboard:select-view')); setChatsOpen(value === 'chats'); setGitOpen(value === 'git') }
  const popMenu = <PopMenu target={{ kind: currentView, projectId: board.project.id }} />
  const viewControls = <><ViewDock projectId={board.project.id} view={currentView} select={selectView} />{slots?.view && slots?.gear && gearControl}{!slots?.tray && popMenu}</>
  return <div className="content">
    {slots?.view && createPortal(viewControls, slots.view)}{slots?.tray && createPortal(popMenu, slots.tray)}{slots?.gear && !slots?.view && createPortal(gearControl, slots.gear)}
    <main>
    {!(slots?.view && slots?.gear) && <div className="head"><div className="lead"><div>{!slots?.gear && <h1>{board.project.name}</h1>}</div></div><div className="tools">{!slots?.view && viewControls}{!slots?.gear && gearControl}</div></div>}
    {gitOpen ? <GitPage board={board} profiles={history} openCardGit={openCardGit} focusRequest={gitFocus} /> : chatsOpen ? <ChatsPage board={board} changed={() => void refresh()} current={freeChat?.chat?.id} openCard={(card, purpose) => setChatCard(card, purpose)} openCardEditor={(card) => setDraft(edit(card))} openFree={openFree} deleted={(chatId) => { if (freeChat?.chat?.id === chatId) setFreeChat(undefined) }} /> : <><div className="board-filterbar"><button type="button" className={`board-filter-toggle ${filtering ? 'on' : ''}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>Pesquisar e filtrar{filtering && <span> · {visibleCards.length}/{active.length}</span>}</button>{filtering && <button type="button" className="board-filter-clear" onClick={() => { setBoardQuery(''); setPriorityFilter(''); setTypeFilter(''); setAgentFilter('') }}>Limpar filtros</button>}</div>{filtersOpen && <div className="board-filters" role="search" aria-label="Filtrar cards do quadro"><input className="in" type="search" aria-label="Buscar cards" placeholder="Buscar cards…" value={boardQuery} onChange={(event) => setBoardQuery(event.target.value)} /><select className="in" aria-label="Filtrar por prioridade" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as Card['priority'] | '')}><option value="">Todas as prioridades</option>{(Object.entries(priorityLabel) as Array<[Card['priority'], string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className="in" aria-label="Filtrar por tipo" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as Card['type'] | '')}><option value="">Todos os tipos</option><option value="feature">Feature</option><option value="bug">Bug</option><option value="improvement">Melhoria</option><option value="task">Tarefa</option><option value="minor">Pequena</option></select><select className="in" aria-label="Filtrar por agente" value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}><option value="">Todos os agentes</option>{history.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></div>}<div className="kanban">{board.columns.map((column) => {
      const allCards = active.filter((card) => card.columnId === column.id), cards = visibleCards.filter((card) => card.columnId === column.id)
      return <section className={`col ${overColumn === column.id ? 'over' : ''}`} key={column.id} onDragOver={(e) => { e.preventDefault(); setOverColumn(column.id) }} onDragLeave={() => setOverColumn(undefined)} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('card'); clear(); if (id) void move(id, column.id, null) }}>
        <header>{column.label}<span className="colTools"><b title={filtering ? `${cards.length} de ${allCards.length} cards visíveis` : undefined}>{filtering ? `${cards.length}/${allCards.length}` : cards.length}</b><ColumnMenu label={column.label} count={allCards.length} add={() => setChoosing(column.id)} archiveAll={() => setArchivingColumn(column.id)} /></span></header>
        {cards.map((card) => <CardTile key={card.id} card={card} onComplexity={() => setAssessing(card)} state={column.semanticState} agent={history.find((profile) => profile.id === (card.run.profileId ?? card.execProfileId))} agents={card.agentIds.map((id) => history.find((profile) => profile.id === id)).filter((profile): profile is AgentProfile => Boolean(profile))} dropLabel={dropOn === card.id ? dropLabel(card) : undefined}
          onPending={() => setPendingCard(card)} onSend={() => void sendChanges(card.id)} onGit={() => openCardGit(card.id)} onOpen={() => setDraft(edit(card))} onChat={() => setChatCard(card)} onPlan={() => setChatCard(card)} onStart={() => setStartingState({ card, purpose: 'execution' })} onTest={() => setStartingState({ card, purpose: 'test' })} onStop={() => setStopping(card)}
          onResume={() => void window.agentboard.invoke('cards:resume', { cardId: card.id, purpose: card.run.purpose === 'test' ? 'test' : card.run.purpose === 'execution' ? 'execution' : undefined }).then(refresh).catch((reason: unknown) => say(String(reason).replace(/^Error: /, ''), 'error'))}
          onArchive={() => void window.agentboard.invoke('cards:archive', { cardId: card.id }).then(() => { say('Card arquivado'); return refresh() })}
          dragProps={{ draggable: true, onContextMenu: (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, card }) }, onDragStart: (e) => { e.dataTransfer.setData('card', card.id); setDragId(card.id) }, onDragEnd: clear, onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setDropOn(card.id) }, onDrop: (e) => { e.stopPropagation(); const id = e.dataTransfer.getData('card'); clear(); if (id && id !== card.id) void move(id, column.id, card.id) } }} />)}
        {filtering && !cards.length && allCards.length > 0 && <p className="board-filter-empty">Nenhum card corresponde aos filtros.</p>}<button className="add" onClick={() => setChoosing(column.id)}>＋ Adicionar card</button>
      </section>
    })}</div></>}
    {choosing && <NewCardDialog close={() => setChoosing(undefined)} manual={() => { setDraft(blankDraft(choosing)); setChoosing(undefined) }} plan={() => { const columnId = choosing; setChoosing(undefined); setChatCardState(undefined); setFreeChat(undefined); setChatPurpose('planning'); setChatInstance(Date.now()); setDraftPlan({ columnId }) }} />}
    {draft && <CardEditor projectId={board.project.id} sources={board.project.sources} profiles={allowed} pending={draft.id ? (board.cards.find((item) => item.id === draft.id)?.pending) : undefined} onPending={() => { const card = board.cards.find((item) => item.id === draft.id); if (card) setPendingCard(card) }} draft={draft} close={() => setDraft(undefined)} saved={async () => { setDraft(undefined); await refresh() }} openChat={draft.id ? (purpose) => { const card = board.cards.find((item) => item.id === draft.id); setDraft(undefined); if (card) setChatCard(card, purpose) } : undefined} onStart={draft.id ? (purpose) => { const card = board.cards.find((item) => item.id === draft.id); setDraft(undefined); if (card) setStartingState({ card, purpose }) } : undefined} />}
    {starting && <StartDialog card={starting.card} purpose={starting.purpose} profiles={allowed} close={() => setStartingState(undefined)} start={async (config, baseBranch) => { await window.agentboard.invoke('cards:start', { cardId: starting.card.id, config, purpose: starting.purpose, baseBranch }); setStartingState(undefined); await refresh(); setChatCard(starting.card, starting.purpose) }} />}
    {gate && (() => { const card = board.cards.find((item) => item.id === gate.cardId); if (!card) return null; return <ConfirmDialog eyebrow="Mover para Done" title={card.title || 'Novo card'} text={gate.stage === 'test' ? 'Você ainda não rodou os testes automatizados deste card (ou eles não passaram) e nem revisou as alterações. Quer mover para Done mesmo assim? O app registra que essas etapas foram puladas.' : 'Os testes automatizados passaram, mas você ainda não revisou as alterações. Quer mover para Done mesmo assim? O app registra que a revisão foi pulada.'} ok={gate.stage === 'test' ? 'Rodar testes automatizados' : 'Abrir Alterações para revisar'} secondary={{ label: 'Mover mesmo assim', run: () => { const next = gate; setGate(undefined); void move(next.cardId, next.columnId, next.beforeCardId, true) } }} cancel={() => setGate(undefined)} confirm={() => { const next = gate; setGate(undefined); if (next.stage === 'test') runGateTests(card); else setChatCard(card, 'test') }} /> })()}
    {stopping && <ConfirmDialog eyebrow="Execução" title="Parar a execução?" text="O agente para agora. O card fica Pausado e você pode continuar de onde parou pelo card ou pelo chat." ok="Parar execução" danger cancel={() => setStopping(undefined)} confirm={() => { const card = stopping; setStopping(undefined); if (card.run.runId) void window.agentboard.invoke('agents:cancel', { runId: card.run.runId }).then(refresh).catch((reason: unknown) => say(String(reason))) }} />}
    {assessing && <AssessmentDialog card={fresh(assessing)} close={() => setAssessing(undefined)} changed={() => void refresh()} />}
    {pendingCard && <PendingDialog card={fresh(pendingCard)} close={() => setPendingCard(undefined)} changed={() => void refresh()} />}
    {menu && <CardContextMenu x={menu.x} y={menu.y} card={menu.card} close={() => setMenu(undefined)} open={() => { const card = menu.card; setMenu(undefined); setDraft(edit(card)) }} chat={() => { const card = menu.card; setMenu(undefined); setChatCard(card) }} git={() => { const card = menu.card; setMenu(undefined); openCardGit(card.id) }} remove={() => { const card = menu.card; setMenu(undefined); setDeleting(card) }} />}
    {foreign && <ConfirmDialog eyebrow="Worktree" title="Este card trabalhou na worktree de outro" text={`O agente alterou arquivos na worktree do card "${foreign.ownerTitle}". Quer que este card passe a usar essa worktree? Assim ele mostra as Alterações e o Git dela. A worktree continua sendo do outro card.`} ok="Usar essa worktree" cancel={() => setForeign(undefined)} confirm={() => { const info = foreign; setForeign(undefined); void window.agentboard.invoke('worktrees:link', { cardId: info.cardId, fromCardId: info.ownerCardId }).then(() => refresh()).catch((reason: unknown) => say(String(reason).replace(/^Error: /, ''), 'error')) }} />}
    {archivingColumn && <ConfirmDialog eyebrow="Arquivar coluna" title={`Arquivar todos os cards de ${board.columns.find((column) => column.id === archivingColumn)?.label ?? 'a coluna'}?`} text={`${active.filter((card) => card.columnId === archivingColumn).length} cards saem do quadro. Dá para restaurar depois pelo botão Arquivados, na página de chats.`} ok="Arquivar todos" cancel={() => setArchivingColumn(undefined)} confirm={() => { const id = archivingColumn; setArchivingColumn(undefined); void archiveColumn(id) }} />}
    {deleting && <ConfirmDialog eyebrow="Excluir card" title={deleting.title || 'Novo card'} text="O card, os documentos, os planos e o histórico de conversas dele serão removidos. Isso não pode ser desfeito." ok="Excluir" danger cancel={() => setDeleting(undefined)} confirm={() => { const card = deleting; setDeleting(undefined); void window.agentboard.invoke('cards:delete', { cardId: card.id }).then(() => { say('Card excluído'); return refresh() }).catch((reason: unknown) => say(String(reason))) }} />}
    </main>
    {chatCard && allowed.length === 0 && <NoAgentDialog project={board.project} profiles={profiles} close={() => setChatCard(undefined)} allowed={() => void refresh()} openSettings={() => { setChatCard(undefined); openSettings() }} />}
    {freeChat && allowed.length > 0 && <FreeChat key={freeChat.key} mode={freeChat.mode} prompt={freeChat.prompt} project={board.project} profiles={allowed} chat={freeChat.chat} close={() => { setFreeChat(undefined) }} changed={() => void refresh()} onConverted={(cardId) => { void refresh().then(() => setOpenAfterRefresh(cardId)) }} />}
    {freeChat && allowed.length === 0 && <NoAgentDialog project={board.project} profiles={profiles} close={() => setFreeChat(undefined)} allowed={() => void refresh()} openSettings={() => { setFreeChat(undefined); openSettings() }} />}
    {draftPlan && allowed.length === 0 && <NoAgentDialog project={board.project} profiles={profiles} close={() => setDraftPlan(undefined)} allowed={() => void refresh()} openSettings={() => { setDraftPlan(undefined); openSettings() }} />}
    {(chatCard || draftPlan) && allowed.length > 0 && <CardChat key={`chat-${chatInstance}-${chatPurpose}`} project={board.project} card={chatCard ? fresh(chatCard) : draftCard(board, draftPlan!.columnId)} board={board} profiles={history} columnLabel={chatCard ? columnLabel(chatCard) : board.columns.find((column) => column.id === draftPlan?.columnId)?.label ?? ''} mode={chatPurpose} onSwitch={setChatPurpose} close={() => { setChatCard(undefined); setDraftPlan(undefined); setGitCardId(undefined) }} openEdit={(card) => setDraft(edit(card))} initialView={gitCardId === chatCard?.id ? 'git' : 'chat'} openRules={() => onProjectConfig('git')} openGraph={(id) => { setChatCardState(undefined); setGitCardId(undefined); setChatsOpen(false); setGitOpen(true); setGitFocus({ cardId: id, at: Date.now() }) }}
      ensureCard={draftPlan && !chatCard ? async () => { const created = await window.agentboard.invoke('cards:create', { projectId: board.project.id, columnId: draftPlan.columnId, title: '', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] }); await refresh(); setDraftPlan(undefined); setChatCardState(created); return created } : undefined} />}
  </div>
}
