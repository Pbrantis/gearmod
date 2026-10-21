import React, { useEffect, useState } from 'react'
import type { AgentProfile, Card, ProjectBoard } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { CardChat } from './CardChat'
import { blankDraft, CardEditor, type Draft } from './CardEditor'
import { ConfirmDialog } from './ConfirmDialog'
import { ArchiveIcon, ChatIcon, EyeIcon, FolderGlyph, PlayIcon, SparkIcon, StopIcon } from './icons'
import { NewCardDialog } from './NewCardDialog'
import { NoAgentDialog } from './ProjectDialogs'
import { StartDialog } from './StartDialog'

export const priorityLabel: Record<Card['priority'], string> = { urgent: 'Urgente', high: 'Alta', medium: 'Média', low: 'Baixa' }
const plain = (markdown: string): string => markdown.replace(/^#+ .*$/gm, '').replace(/\[[ xX]\]/g, '').replace(/[-*`#]/g, '').replace(/\n+/g, ' ').trim()

type State = 'backlog' | 'todo' | 'doing' | 'test' | 'done'
/** Planejar quando o card ainda está no começo; execução quando já roda, parou ou está em Doing/Test/Done. */
export function chatMode(board: ProjectBoard, card: Card): 'planning' | 'execution' {
  const fresh = board.cards.find((item) => item.id === card.id) ?? card, state = board.columns.find((column) => column.id === fresh.columnId)?.semanticState
  if (fresh.run.state === 'planning') return 'planning'
  return fresh.run.state !== 'idle' || state === 'doing' || state === 'test' || state === 'done' ? 'execution' : 'planning'
}

function CardTile({ card, state, agent, dropLabel, dragProps, onOpen, onChat, onPlan, onStart, onStop, onResume, onArchive }: { card: Card; state: State; agent?: AgentProfile; dropLabel?: string; dragProps: React.HTMLAttributes<HTMLElement>; onOpen(): void; onChat(): void; onPlan(): void; onStart(): void; onStop(): void; onResume(): void; onArchive(): void }): React.JSX.Element {
  const run = card.run.state, ready = run === 'idle' && card.hasPlan && (state === 'backlog' || state === 'todo')
  const { done, total } = card.tasks
  const button = (cls: string, tip: string, click: () => void, icon: React.ReactNode): React.JSX.Element => <button type="button" className={`ib ${cls} tip`} data-tip={tip} aria-label={tip} onClick={(e) => { e.stopPropagation(); click() }}>{icon}</button>
  return <article className={`card ${run === 'finished' ? 'fin' : ''} ${dropLabel ? 'drop-before' : ''}`} data-plabel={dropLabel} onClick={() => (run === 'finished' ? onChat() : onOpen())} {...dragProps}>
    <div className="pills"><span className={`pill ${card.type}`}>{card.type}</span><span className={`pill ${card.priority}`}>{card.priority}</span></div>
    <button type="button" className="cardchat tip" data-tip="Abrir chat" aria-label="Abrir chat" onClick={(e) => { e.stopPropagation(); onChat() }}><ChatIcon /></button>
    <h3>{card.title || 'Novo card'}</h3>
    {card.description && <div className="desc">{plain(card.description)}</div>}
    {run === 'planning' && <span className="badge plan"><span className="dot pulse" />Planejando com agente</span>}
    {ready && <span className="badge ready"><span className="dot" />Plano pronto</span>}
    {run === 'paused' && <span className="badge paused"><span className="dot" />Pausado</span>}
    {run === 'finished' && <span className="badge fin"><span className="dot pulse" />Terminou · clique para ver</span>}
    {run === 'running' && <div className="running" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onChat() }} onKeyDown={(e) => { if (e.key === 'Enter') onChat() }}><div className="row"><span className="spin" />{agent && <AgentIcon profile={agent} />}<span style={{ color: '#8d968f' }}>{card.execModel ?? ''}</span></div><div className="bar"><i /></div><span style={{ fontSize: 11, color: 'var(--accent)' }}>Toque para ver execução</span></div>}
    <div className="cfoot">
      <span className="ownr">{agent && run !== 'running' && <span className="agentchip"><AgentIcon profile={agent} /></span>}<span className="cnt">{total ? `${done}/${total} tasks` : 'sem tasks'}</span></span>
      <div className="btns">
        {(state === 'todo' || state === 'backlog') && button('plan', 'Planejar', onPlan, <SparkIcon />)}
        {run === 'paused' && button('view', 'Ver chat', onChat, <EyeIcon />)}
        {run === 'paused' && button('start', 'Continuar', onResume, <PlayIcon />)}
        {state === 'doing' && run !== 'running' && run !== 'paused' && button('start', 'Iniciar', onStart, <PlayIcon />)}
        {run === 'running' && button('stop', 'Parar', onStop, <StopIcon />)}
        {state === 'done' && button('view', 'Arquivar', onArchive, <ArchiveIcon />)}
        {run === 'finished' && button('done', 'Ver resultado', onChat, <EyeIcon />)}
      </div>
    </div>
  </article>
}

export function Board({ board, profiles, refresh, onProjectConfig, openSettings }: { board: ProjectBoard; profiles: AgentProfile[]; refresh(): Promise<void>; onProjectConfig(): void; openSettings(): void }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(), [chatCard, setChatCard] = useState<Card>(), [choosing, setChoosing] = useState<string>(), [starting, setStarting] = useState<Card>(), [stopping, setStopping] = useState<Card>()
  const [dragId, setDragId] = useState<string>(), [dropOn, setDropOn] = useState<string>(), [overColumn, setOverColumn] = useState<string>(), [toast, setToast] = useState('')
  const allowed = profiles.filter((profile) => board.project.allowedProfileIds.includes(profile.id))
  const active = board.cards.filter((card) => !card.archivedAt), archived = board.cards.filter((card) => card.archivedAt)
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
  const dropLabel = (target: Card): string | undefined => { const dragged = board.cards.find((card) => card.id === dragId); if (!dragged || dragged.id === target.id) return undefined; return dragged.priority === target.priority ? 'Mesma prioridade' : `Vira prioridade ${priorityLabel[target.priority]}` }
  const edit = (card: Card): Draft => ({ id: card.id, columnId: card.columnId, sourceId: card.sourceId, title: card.title, type: card.type, priority: card.priority })
  const clear = (): void => { setDragId(undefined); setDropOn(undefined); setOverColumn(undefined) }
  const fresh = (card: Card): Card => board.cards.find((item) => item.id === card.id) ?? card
  const columnLabel = (card: Card): string => board.columns.find((column) => column.id === fresh(card).columnId)?.label ?? ''
  return <div className="content">
    <main>
    <div className="head"><div className="lead"><div><span className="pathchip tip" data-tip="Pasta do projeto"><FolderGlyph />{board.project.localPath}</span><h1>{board.project.name}</h1><p>{active.length} cards ativos</p></div></div><div className="tools"><button className="iconbtn" title="Configurar projeto" aria-label="Configurar projeto" onClick={onProjectConfig}>⚙</button></div></div>
    <div className="kanban">{board.columns.map((column) => {
      const cards = active.filter((card) => card.columnId === column.id)
      return <section className={`col ${overColumn === column.id ? 'over' : ''}`} key={column.id} onDragOver={(e) => { e.preventDefault(); setOverColumn(column.id) }} onDragLeave={() => setOverColumn(undefined)} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('card'); clear(); if (id) void move(id, column.id, null) }}>
        <header>{column.label}<b>{cards.length}</b></header>
        {cards.map((card) => <CardTile key={card.id} card={card} state={column.semanticState} agent={profiles.find((profile) => profile.id === (card.run.profileId ?? card.execProfileId))} dropLabel={dropOn === card.id ? dropLabel(card) : undefined}
          onOpen={() => setDraft(edit(card))} onChat={() => setChatCard(card)} onPlan={() => setChatCard(card)} onStart={() => setStarting(card)} onStop={() => setStopping(card)}
          onResume={() => void window.agentboard.invoke('cards:resume', { cardId: card.id }).then(refresh).catch((reason: unknown) => say(String(reason).replace(/^Error: /, '')))}
          onArchive={() => void window.agentboard.invoke('cards:archive', { cardId: card.id }).then(() => { say('Card arquivado'); return refresh() })}
          dragProps={{ draggable: true, onDragStart: (e) => { e.dataTransfer.setData('card', card.id); setDragId(card.id) }, onDragEnd: clear, onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setDropOn(card.id) }, onDrop: (e) => { e.stopPropagation(); const id = e.dataTransfer.getData('card'); clear(); if (id && id !== card.id) void move(id, column.id, card.id) } }} />)}
        <button className="add" onClick={() => setChoosing(column.id)}>＋ Adicionar card</button>
      </section>
    })}</div>
    {archived.length > 0 && <details className="archivedbox"><summary>Arquivados ({archived.length})</summary>{archived.map((card) => <div className="archrow" key={card.id}><span>{card.title}</span><button type="button" className="mini secondary" onClick={() => void window.agentboard.invoke('cards:restore', { cardId: card.id }).then(refresh)}>Restaurar</button></div>)}</details>}
    {choosing && <NewCardDialog close={() => setChoosing(undefined)} manual={() => { setDraft(blankDraft(choosing)); setChoosing(undefined) }} plan={() => void window.agentboard.invoke('cards:create', { projectId: board.project.id, columnId: choosing, title: '', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] }).then(async (created) => { setChoosing(undefined); await refresh(); setChatCard(created) }).catch((reason: unknown) => say(String(reason)))} />}
    {draft && <CardEditor projectId={board.project.id} sources={board.project.sources} profiles={allowed} draft={draft} close={() => setDraft(undefined)} saved={async () => { setDraft(undefined); await refresh() }} openChat={draft.id ? () => { const card = board.cards.find((item) => item.id === draft.id); setDraft(undefined); if (card) setChatCard(card) } : undefined} />}
    {starting && <StartDialog card={starting} profiles={allowed} close={() => setStarting(undefined)} start={async (config) => { await window.agentboard.invoke('cards:start', { cardId: starting.id, config }); setStarting(undefined); await refresh(); setChatCard(starting) }} />}
    {stopping && <ConfirmDialog eyebrow="Execução" title="Parar a execução?" text="O agente para agora. O card fica Pausado e você pode continuar de onde parou pelo card ou pelo chat." ok="Parar execução" danger cancel={() => setStopping(undefined)} confirm={() => { const card = stopping; setStopping(undefined); if (card.run.runId) void window.agentboard.invoke('agents:cancel', { runId: card.run.runId }).then(refresh).catch((reason: unknown) => say(String(reason))) }} />}
    {toast && <div className="toast" role="status">{toast}</div>}
    </main>
    {chatCard && allowed.length === 0 && <NoAgentDialog project={board.project} profiles={profiles} close={() => setChatCard(undefined)} allowed={() => void refresh()} openSettings={() => { setChatCard(undefined); openSettings() }} />}
    {chatCard && allowed.length > 0 && <CardChat key={chatCard.id} project={board.project} card={fresh(chatCard)} board={board} profiles={profiles} columnLabel={columnLabel(chatCard)} mode={chatMode(board, chatCard)} close={() => setChatCard(undefined)} openEdit={(card) => setDraft(edit(card))} />}
  </div>
}
