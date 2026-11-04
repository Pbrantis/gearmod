import type { CardChecklist } from '@gearmod/contracts'
import { dateLocale, tr } from './i18n'

export const checklistEvent = 'gearmod:checklist'

/** The user checks or unchecks a test checklist item; the other screens that show the checklist receive the new state. */
export async function toggleChecklist(cardId: string, line: number, text: string, checked: boolean): Promise<CardChecklist> {
  const next = await window.gearmod.invoke('cards:checklist-toggle', { cardId, line, text, checked })
  window.dispatchEvent(new CustomEvent(checklistEvent, { detail: next }))
  return next
}

const when = (iso: string): string => new Date(iso).toLocaleString(dateLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Labels for an item: the agent's OK and/or the user's confirmation, each with the date on hover. */
export function markBadges(mark: CardChecklist['marks'][string] | undefined, checked: boolean): Array<{ key: 'agent' | 'user'; label: string; title: string; faded: boolean }> {
  if (!mark) return []
  const t = tr().board.marks
  const badges: Array<{ key: 'agent' | 'user'; label: string; title: string; faded: boolean }> = []
  if (mark.agent) badges.push({ key: 'agent', label: checked ? t.agent : t.agentOk, title: checked ? t.agentOkAt(when(mark.agent)) : t.agentOkAtUnchecked(when(mark.agent)), faded: !checked })
  if (checked && mark.by === 'user') badges.push({ key: 'user', label: t.you, title: mark.agent ? t.confirmedByYou(when(mark.at)) : t.markedByYou(when(mark.at)), faded: false })
  return badges
}
