import type { CardChecklist } from '@agentboard/contracts'

export const checklistEvent = 'agentboard:checklist'

/** O usuário marca ou desmarca um item do checklist do teste; as outras telas que mostram o checklist recebem o novo estado. */
export async function toggleChecklist(cardId: string, line: number, text: string, checked: boolean): Promise<CardChecklist> {
  const next = await window.agentboard.invoke('cards:checklist-toggle', { cardId, line, text, checked })
  window.dispatchEvent(new CustomEvent(checklistEvent, { detail: next }))
  return next
}

/** Texto da etiqueta de quem marcou o item, para mostrar ao passar o mouse. */
export function markTitle(mark: CardChecklist['marks'][string] | undefined, checked: boolean): string | undefined {
  if (!mark) return undefined
  const when = new Date(mark.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  return `${checked ? 'Marcado' : 'Desmarcado'} ${mark.by === 'user' ? 'por você' : 'pelo agente'} em ${when}`
}
