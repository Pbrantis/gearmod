import React from 'react'
import type { Card } from '@agentboard/contracts'
import { ArchiveIcon, ChatIcon, SparkIcon } from './icons'

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
  dragProps: React.HTMLAttributes<HTMLElement>
}

/** Card do quadro: etiquetas, botão de chat no canto, resumo, contador de tasks e ações por coluna (ícone com tooltip). */
export function CardTile({ card, state, dropLabel, onOpen, onChat, onPlan, onArchive, dragProps }: CardTileProps): React.JSX.Element {
  const total = card.acceptanceCriteria.length, done = card.acceptanceCriteria.filter((item) => item.checked).length
  const action = (className: string, tip: string, click: () => void, icon: React.ReactNode): React.JSX.Element => <button type="button" className={`ib ${className} tip`} data-tip={tip} aria-label={tip} onClick={(e) => { e.stopPropagation(); click() }}>{icon}</button>
  return <article className={`card ${dropLabel ? 'dropBefore' : ''}`} data-plabel={dropLabel} onClick={onOpen} {...dragProps}>
    <div className="pills"><span className={`pill ${card.type}`}>{card.type}</span><span className={`pill ${card.priority}`}>{priorityLabel[card.priority]}</span></div>
    <button type="button" className="cardChat tip" data-tip="Abrir chat" aria-label="Abrir chat" onClick={(e) => { e.stopPropagation(); onChat() }}><ChatIcon /></button>
    <h3>{card.title}</h3>
    {card.description && <div className="desc">{plain(card.description)}</div>}
    <div className="cfoot"><span className="cnt">{total ? `${done}/${total} tasks` : 'sem tasks'}</span><div className="btns">
      {(state === 'backlog' || state === 'todo') && action('plan', 'Planejar', onPlan, <SparkIcon />)}
      {state === 'done' && action('archive', 'Arquivar', onArchive, <ArchiveIcon />)}
    </div></div>
  </article>
}
