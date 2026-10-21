import React from 'react'
import type { AgentProfile, Card } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { ArchiveIcon, ChatIcon, EyeIcon, PlayIcon, SparkIcon, StopIcon } from './icons'

export const priorityLabel: Record<Card['priority'], string> = { urgent: 'Urgente', high: 'Alta', medium: 'Média', low: 'Baixa' }
const plain = (markdown: string): string => markdown.replace(/[#>*_`\-[\]]/g, '').replace(/\s+/g, ' ').trim()

export interface CardTileProps {
  card: Card
  state: 'backlog' | 'todo' | 'doing' | 'test' | 'done'
  dropLabel?: string
  onOpen(): void
  onChat(): void
  onPlan(): void
  onArchive(): void
  onStart(): void
  onStop(): void
  onResume(): void
  agent?: AgentProfile
  dragProps: React.HTMLAttributes<HTMLElement>
}

/** Card do quadro: etiquetas, botão de chat no canto, resumo, contador de tasks e ações por coluna (ícone com tooltip). */
export function CardTile({ card, state, dropLabel, onOpen, onChat, onPlan, onArchive, onStart, onStop, onResume, agent, dragProps }: CardTileProps): React.JSX.Element {
  const { total, done } = card.tasks, run = card.run.state
  const action = (className: string, tip: string, click: () => void, icon: React.ReactNode): React.JSX.Element => <button type="button" className={`ib ${className} tip`} data-tip={tip} aria-label={tip} onClick={(e) => { e.stopPropagation(); click() }}>{icon}</button>
  return <article className={`card ${dropLabel ? 'dropBefore' : ''} ${run === 'finished' ? 'fin' : ''}`} data-plabel={dropLabel} onClick={onOpen} {...dragProps}>
    <div className="pills"><span className={`pill ${card.type}`}>{card.type}</span><span className={`pill ${card.priority}`}>{priorityLabel[card.priority]}</span></div>
    <button type="button" className="cardChat tip" data-tip="Abrir chat" aria-label="Abrir chat" onClick={(e) => { e.stopPropagation(); onChat() }}><ChatIcon /></button>
    <h3>{card.title || 'Novo card'}</h3>
    {card.description && <div className="desc">{plain(card.description)}</div>}
    {run === 'planning' && <span className="badge plan">Planejando…</span>}
    {run === 'paused' && <span className="badge paused">Pausado</span>}
    {run === 'finished' && <span className="badge fin">Terminou</span>}
    {run === 'running' && <button type="button" className="running" onClick={(e) => { e.stopPropagation(); onChat() }}><span className="runRow"><span className="spin" />{agent && <AgentIcon profile={agent} size="sm" />}<span>Executando</span></span><span className="bar"><i /></span><small>Toque para ver a execução</small></button>}
    <div className="cfoot"><span className="cnt">{total ? `${done}/${total} tasks` : 'sem tasks'}</span><div className="btns">
      {(state === 'backlog' || state === 'todo') && (run === 'idle' || run === 'finished') && action('plan', 'Planejar', onPlan, <SparkIcon />)}
      {(state === 'todo' || state === 'doing') && (run === 'idle' || run === 'finished') && action('start', 'Iniciar', onStart, <PlayIcon />)}
      {run === 'paused' && action('view', 'Ver chat', onChat, <EyeIcon />)}
      {run === 'paused' && action('start', 'Continuar', onResume, <PlayIcon />)}
      {run === 'running' && action('stop', 'Parar', onStop, <StopIcon />)}
      {run === 'finished' && action('view', 'Ver resultado', onChat, <EyeIcon />)}
      {state === 'done' && action('archive', 'Arquivar', onArchive, <ArchiveIcon />)}
    </div></div>
  </article>
}
