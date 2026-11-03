import React from 'react'
import type { CardChecklist } from '@gearmod/contracts'
import { markBadges } from './checklistToggle'

/** Etiquetas de um item do checklist: "agente" (o OK dele) e "você" (a sua confirmação). Item desmarcado com OK do agente mostra "OK do agente" apagado. */
export function MarkBadges({ mark, checked }: { mark: CardChecklist['marks'][string] | undefined; checked: boolean }): React.JSX.Element | null {
  const badges = markBadges(mark, checked)
  if (!badges.length) return null
  return <span className="pg-badges">{badges.map((badge) => <span key={badge.key} className={`pg-by ${badge.key} ${badge.faded ? 'faded' : ''}`} data-tip={badge.title}>{badge.label}</span>)}</span>
}
