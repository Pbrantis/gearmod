import React, { useEffect, useState } from 'react'
import type { AgentProfile, AgentPurpose, Card, Chat, ProjectBoard } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { CardChat } from './CardChat'
import { ChatsPanel } from './ChatsPanel'
import { worktreeName } from './workspace'
import { FreeChat } from './FreeChat'
import { blankDraft, CardEditor, type Draft } from './CardEditor'
import { ConfirmDialog } from './ConfirmDialog'
import { ArchiveIcon, BranchIcon, ChatIcon, EyeIcon, FolderGlyph, PlayIcon, SparkIcon, StopIcon } from './icons'
import { NewCardDialog } from './NewCardDialog'
import { PendingDialog } from './PendingDialog'
import { NoAgentDialog } from './ProjectDialogs'
import { StartDialog } from './StartDialog'

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

function CardTile({ card, state, agent, dropLabel, dragProps, onPending, onOpen, onChat, onPlan, onStart, onTest, onStop, onResume, onArchive }: { card: Card; state: State; agent?: AgentProfile; dropLabel?: string; dragProps: React.HTMLAttributes<HTMLElement>; onPending(): void; onOpen(): void; onChat(): void; onPlan(): void; onStart(): void; onTest(): void; onStop(): void; onResume(): void; onArchive(): void }): React.JSX.Element {
  const run = card.run.state, open = card.planningOpen, ready = run === 'idle' && card.hasPlan && (state === 'backlog' || state === 'todo')
  const { done, total } = card.tasks
  const button = (cls: string, tip: string, click: () => void, icon: React.ReactNode): React.JSX.Element => <button type="button" className={`ib ${cls} tip`} data-tip={tip} aria-label={tip} onClick={(e) => { e.stopPropagation(); click() }}>{icon}</button>
  return <article className={`card ${run === 'finished' ? 'fin' : ''} ${open ? 'planopen' : ''} ${dropLabel ? 'drop-before' : ''}`} data-plabel={dropLabel} onClick={() => (run === 'finished' || open ? onChat() : onOpen())} {...dragProps}>
    <div className="pills"><span className={`pill ${card.type}`}>{card.type}</span><span className={`pill ${card.priority}`}>{card.priority}</span></div>
    <button type="button" className="cardchat tip" data-tip="Abrir chat" aria-label="Abrir chat" onClick={(e) => { e.stopPropagation(); onChat() }}><ChatIcon /></button>
    <h3>{card.title || 'Novo card'}</h3>
    {card.description && <div className="desc">{plain(card.description)}</div>}
    {card.pending.changes > 0 && <button type="button" className="badge ask" onClick={(e) => { e.stopPropagation(); onPending() }}><span className="dot pulse" />{card.pending.changes === 1 ? 'Mudança aguardando sua autorização' : `${card.pending.changes} mudanças aguardando você`}</button>}
    {card.pending.questions > 0 && <button type="button" className="badge ask" onClick={(e) => { e.stopPropagation(); onPending() }}><span className="dot pulse" />{card.pending.questions === 1 ? 'Pergunta para você' : `${card.pending.questions} perguntas para você`}</button>}
    {open && <span className="badge plan"><span className="dot" />Em planejamento</span>}
    {run === 'idle' && !card.hasPlan && (state === 'backlog' || state === 'todo') && <button type="button" className="mini planbtn" onClick={(e) => { e.stopPropagation(); onPlan() }}><SparkIcon />{open ? 'Continuar planejamento' : 'Ir para planejamento'}</button>}
    {run === 'planning' && <span className="badge plan"><span className="dot pulse" />Planejando com agente</span>}
    {ready && <span className="badge ready"><span className="dot" />Plano pronto</span>}
    {run === 'paused' && <span className="badge paused"><span className="dot" />Pausado</span>}
    {run === 'finished' && <span className="badge fin"><span className="dot pulse" />Terminou · clique para ver</span>}
    {run === 'running' && <div className="running" data-purpose={card.run.purpose} role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onChat() }} onKeyDown={(e) => { if (e.key === 'Enter') onChat() }}><div className="row"><span className="spin" />{agent && <AgentIcon profile={agent} />}<span style={{ color: '#8d968f' }}>{card.execModel ?? ''}</span></div><div className="bar"><i /></div><span style={{ fontSize: 11, color: 'var(--accent)' }}>{card.run.purpose === 'test' ? 'Testando · toque para ver' : 'Toque para ver execução'}</span></div>}
    {card.workspace && <div className="wsline tip" data-tip={`Worktree: ${card.workspace.path}\nBranch base: ${card.workspace.baseRef}`}><div className="wsb"><BranchIcon /><b>{card.workspace.branch}</b></div><small>Worktree: {worktreeName(card.workspace.path)}</small></div>}
    <div className="cfoot">
      <span className="ownr">{agent && run !== 'running' && <span className="agentchip"><AgentIcon profile={agent} /></span>}{!open && <span className="cnt">{total ? `${done}/${total} tasks` : 'sem tasks'}</span>}</span>
      <div className="btns">
        {(state === 'todo' || state === 'backlog') && (run !== 'idle' || card.hasPlan) && button('plan', 'Planejar', onPlan, <SparkIcon />)}
        {run === 'paused' && button('view', 'Ver chat', onChat, <EyeIcon />)}
        {run === 'paused' && button('start', 'Continuar', onResume, <PlayIcon />)}
        {state === 'doing' && run !== 'running' && run !== 'paused' && button('start', 'Iniciar', onStart, <PlayIcon />)}
        {state === 'test' && run !== 'running' && run !== 'paused' && button('start', 'Testar', onTest, <PlayIcon />)}
        {run === 'running' && button('stop', 'Parar', onStop, <StopIcon />)}
        {state === 'done' && button('view', 'Arquivar', onArchive, <ArchiveIcon />)}
        {run === 'finished' && button('done', 'Ver resultado', onChat, <EyeIcon />)}
      </div>
    </div>
  </article>
}

export function Board({ board, profiles, history, refresh, onProjectConfig, openSettings, freeRequest, freeHandled }: { board: ProjectBoard; profiles: AgentProfile[]; history: AgentProfile[]; refresh(): Promise<void>; onProjectConfig(): void; openSettings(): void; freeRequest?: { projectId: string; at: number }; freeHandled(): void }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(), [chatCard, setChatCardState] = useState<Card>(), [chatPurpose, setChatPurpose] = useState<AgentPurpose>('planning'), [starting, setStartingState] = useState<{ card: Card; purpose: 'execution' | 'test' }>(), [choosing, setChoosing] = useState<string>(), [stopping, setStopping] = useState<Card>(), [pendingCard, setPendingCard] = useState<Card>()
  const [dragId, setDragId] = useState<string>(), [dropOn, setDropOn] = useState<string>(), [overColumn, setOverColumn] = useState<string>(), [toast, setToast] = useState('')
  const allowed = profiles.filter((profile) => board.project.allowedProfileIds.includes(profile.id))
  const active = board.cards.filter((card) => !card.archivedAt), archived = board.cards.filter((card) => card.archivedAt)
  const [chatsOpen, setChatsOpen] = useState(false), closeChats = (): void => setChatsOpen(false)
  const [freeChat, setFreeChat] = useState<{ chat?: Chat; key: number }>(), [openAfterRefresh, setOpenAfterRefresh] = useState<string>()
  const setChatCard = (card: Card | undefined, purpose?: AgentPurpose): void => { setChatCardState(card); if (card) { setFreeChat(undefined); setChatPurpose(purpose ?? chatMode(board, card)) } }
  const openFree = (chat?: Chat): void => { setChatCardState(undefined); setFreeChat({ chat, key: Date.now() }); closeChats() }
  // "+" do projeto na barra lateral: abre um chat livre novo neste projeto assim que o quadro dele carrega.
  useEffect(() => {
    if (!freeRequest || freeRequest.projectId !== board.project.id) return
    freeHandled(); setChatCardState(undefined); setFreeChat({ key: Date.now() })
  }, [freeRequest, board.project.id, freeHandled])
  // O chat livre virou planejamento de um card novo: espera o quadro atualizar e abre o chat do card (o mesmo chat, agora de planejamento).
  useEffect(() => {
    if (!openAfterRefresh) return
    const card = board.cards.find((item) => item.id === openAfterRefresh)
    if (card) { setOpenAfterRefresh(undefined); setChatCard(card, 'planning') }
  }, [openAfterRefresh, board.cards])
  const say = (text: string): void => { setToast(text); window.setTimeout(() => setToast(''), 2600) }
  useEffect(() => window.agentboard.onRunEvent((event) => {
    if (!['agentboard/card-updated', 'agentboard/run-started', 'agentboard/run-completed'].includes(event.eventType)) return
    if (event.payload.type === 'moved') say(`O agente moveu o card para ${String(event.payload.column)}`)
    void refresh()
  }), [refresh])
  const move = async (cardId: string, columnId: string, beforeCardId: string | null): Promise<void> => {
    const before = board.cards.find((card) => card.id === cardId)
    try {
      const moved = await window.agentboard.invoke('cards:move', { cardId, columnId, beforeCardId })
      if (before && before.priority !== moved.priority) say(`Prioridade alterada para ${priorityLabel[moved.priority]}`)
    } catch (reason) { say(String(reason).replace(/^Error: /, '')) }
    await refresh()
  }
  const agentStatus = (profileId: string): { key: 'working' | 'paused' | 'idle'; label: string; cards: string } => {
    const mine = active.filter((card) => card.run.profileId === profileId)
    const working = mine.filter((card) => card.run.state === 'running' || card.run.state === 'planning'), paused = mine.filter((card) => card.run.state === 'paused')
    if (working.length) return { key: 'working', label: 'trabalhando', cards: working.map((card) => card.title || 'Novo card').join(', ') }
    if (paused.length) return { key: 'paused', label: 'parado', cards: paused.map((card) => card.title || 'Novo card').join(', ') }
    return { key: 'idle', label: 'livre', cards: '' }
  }
  const dropLabel = (target: Card): string | undefined => { const dragged = board.cards.find((card) => card.id === dragId); if (!dragged || dragged.id === target.id) return undefined; return dragged.priority === target.priority ? 'Mesma prioridade' : `Vira prioridade ${priorityLabel[target.priority]}` }
  const edit = (card: Card): Draft => ({ id: card.id, columnId: card.columnId, sourceId: card.sourceId, title: card.title, type: card.type, priority: card.priority })
  const clear = (): void => { setDragId(undefined); setDropOn(undefined); setOverColumn(undefined) }
  const fresh = (card: Card): Card => board.cards.find((item) => item.id === card.id) ?? card
  const columnLabel = (card: Card): string => board.columns.find((column) => column.id === fresh(card).columnId)?.label ?? ''
  return <div className="content">
    <main>
    <div className="head"><div className="lead"><div><span className="pathchip tip" data-tip="Pasta do projeto"><FolderGlyph />{board.project.localPath}</span><h1>{board.project.name}</h1><p>{active.length} cards ativos</p></div></div><div className="tools">{allowed.length > 0 && <div className="agentsbar" aria-label="Agentes do projeto">{allowed.map((profile) => { const status = agentStatus(profile.id); return <span key={profile.id} className={`agchip ${status.key}`} title={`${profile.label}: ${status.label}${status.cards ? ` (${status.cards})` : ''}`}><AgentIcon profile={profile} size="sm" tip={false} /><span className="agn">{profile.label}</span>{status.key === 'working' ? <span className="spin sm" /> : <span className="agdot" />}<small>{status.label}</small></span> })}</div>}<button type="button" className={`iconbtn chatsbtn ${chatsOpen ? 'on' : ''}`} title="Chats do projeto" aria-label="Chats do projeto" aria-expanded={chatsOpen} onClick={() => setChatsOpen(!chatsOpen)}><ChatIcon /></button><button className="iconbtn" title="Configurar projeto" aria-label="Configurar projeto" onClick={onProjectConfig}>⚙</button></div></div>
    <div className="kanban">{board.columns.map((column) => {
      const cards = active.filter((card) => card.columnId === column.id)
      return <section className={`col ${overColumn === column.id ? 'over' : ''}`} key={column.id} onDragOver={(e) => { e.preventDefault(); setOverColumn(column.id) }} onDragLeave={() => setOverColumn(undefined)} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('card'); clear(); if (id) void move(id, column.id, null) }}>
        <header>{column.label}<span className="colTools"><button type="button" className="colAdd tip" data-tip="Adicionar card" aria-label={`Adicionar card em ${column.label}`} onClick={() => setChoosing(column.id)}>+</button><b>{cards.length}</b></span></header>
        {cards.map((card) => <CardTile key={card.id} card={card} state={column.semanticState} agent={history.find((profile) => profile.id === (card.run.profileId ?? card.execProfileId))} dropLabel={dropOn === card.id ? dropLabel(card) : undefined}
          onPending={() => setPendingCard(card)} onOpen={() => setDraft(edit(card))} onChat={() => setChatCard(card)} onPlan={() => setChatCard(card)} onStart={() => setStartingState({ card, purpose: 'execution' })} onTest={() => setStartingState({ card, purpose: 'test' })} onStop={() => setStopping(card)}
          onResume={() => void window.agentboard.invoke('cards:resume', { cardId: card.id, purpose: card.run.purpose === 'test' ? 'test' : card.run.purpose === 'execution' ? 'execution' : undefined }).then(refresh).catch((reason: unknown) => say(String(reason).replace(/^Error: /, '')))}
          onArchive={() => void window.agentboard.invoke('cards:archive', { cardId: card.id }).then(() => { say('Card arquivado'); return refresh() })}
          dragProps={{ draggable: true, onDragStart: (e) => { e.dataTransfer.setData('card', card.id); setDragId(card.id) }, onDragEnd: clear, onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setDropOn(card.id) }, onDrop: (e) => { e.stopPropagation(); const id = e.dataTransfer.getData('card'); clear(); if (id && id !== card.id) void move(id, column.id, card.id) } }} />)}
        <button className="add" onClick={() => setChoosing(column.id)}>＋ Adicionar card</button>
      </section>
    })}</div>
    {archived.length > 0 && <details className="archivedbox"><summary>Arquivados ({archived.length})</summary>{archived.map((card) => <div className="archrow" key={card.id}><span>{card.title}</span><button type="button" className="mini secondary" onClick={() => void window.agentboard.invoke('cards:restore', { cardId: card.id }).then(refresh)}>Restaurar</button></div>)}</details>}
    {choosing && <NewCardDialog close={() => setChoosing(undefined)} manual={() => { setDraft(blankDraft(choosing)); setChoosing(undefined) }} plan={() => void window.agentboard.invoke('cards:create', { projectId: board.project.id, columnId: choosing, title: '', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] }).then(async (created) => { setChoosing(undefined); await refresh(); setChatCard(created) }).catch((reason: unknown) => say(String(reason)))} />}
    {draft && <CardEditor projectId={board.project.id} sources={board.project.sources} profiles={allowed} pending={draft.id ? (board.cards.find((item) => item.id === draft.id)?.pending) : undefined} onPending={() => { const card = board.cards.find((item) => item.id === draft.id); if (card) setPendingCard(card) }} draft={draft} close={() => setDraft(undefined)} saved={async () => { setDraft(undefined); await refresh() }} openChat={draft.id ? (purpose) => { const card = board.cards.find((item) => item.id === draft.id); setDraft(undefined); if (card) setChatCard(card, purpose) } : undefined} onStart={draft.id ? (purpose) => { const card = board.cards.find((item) => item.id === draft.id); setDraft(undefined); if (card) setStartingState({ card, purpose }) } : undefined} />}
    {starting && <StartDialog card={starting.card} purpose={starting.purpose} profiles={allowed} close={() => setStartingState(undefined)} start={async (config) => { await window.agentboard.invoke('cards:start', { cardId: starting.card.id, config, purpose: starting.purpose }); setStartingState(undefined); await refresh(); setChatCard(starting.card, starting.purpose) }} />}
    {stopping && <ConfirmDialog eyebrow="Execução" title="Parar a execução?" text="O agente para agora. O card fica Pausado e você pode continuar de onde parou pelo card ou pelo chat." ok="Parar execução" danger cancel={() => setStopping(undefined)} confirm={() => { const card = stopping; setStopping(undefined); if (card.run.runId) void window.agentboard.invoke('agents:cancel', { runId: card.run.runId }).then(refresh).catch((reason: unknown) => say(String(reason))) }} />}
    {pendingCard && <PendingDialog card={fresh(pendingCard)} close={() => setPendingCard(undefined)} changed={() => void refresh()} />}
    {toast && <div className="toast" role="status">{toast}</div>}
    </main>
    {chatCard && allowed.length === 0 && <NoAgentDialog project={board.project} profiles={profiles} close={() => setChatCard(undefined)} allowed={() => void refresh()} openSettings={() => { setChatCard(undefined); openSettings() }} />}
    {chatsOpen && <ChatsPanel board={board} close={closeChats} openCard={(card, purpose) => { closeChats(); setChatCard(card, purpose) }} openFree={openFree} />}
    {freeChat && allowed.length > 0 && <FreeChat key={freeChat.key} project={board.project} profiles={allowed} chat={freeChat.chat} close={() => setFreeChat(undefined)} changed={() => void refresh()} onConverted={(cardId) => { void refresh().then(() => setOpenAfterRefresh(cardId)) }} />}
    {freeChat && allowed.length === 0 && <NoAgentDialog project={board.project} profiles={profiles} close={() => setFreeChat(undefined)} allowed={() => void refresh()} openSettings={() => { setFreeChat(undefined); openSettings() }} />}
    {chatCard && allowed.length > 0 && <CardChat key={`${chatCard.id}-${chatPurpose}`} project={board.project} card={fresh(chatCard)} board={board} profiles={history} columnLabel={columnLabel(chatCard)} mode={chatPurpose} onSwitch={setChatPurpose} close={() => setChatCard(undefined)} openEdit={(card) => setDraft(edit(card))} />}
  </div>
}
