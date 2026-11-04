import React from 'react'
import type { CardChecklist } from '@gearmod/contracts'
import { markBadges } from './checklistToggle'

/** Tags for a checklist item: "agent" (its OK) and "you" (your confirmation). An unchecked item with the agent's OK shows a dimmed "Agent OK". */
export function MarkBadges({ mark, checked }: { mark: CardChecklist['marks'][string] | undefined; checked: boolean }): React.JSX.Element | null {
  const badges = markBadges(mark, checked)
  if (!badges.length) return null
  return <span className="pg-badges">{badges.map((badge) => <span key={badge.key} className={`pg-by ${badge.key} ${badge.faded ? 'faded' : ''}`} data-tip={badge.title}>{badge.label}</span>)}</span>
}
