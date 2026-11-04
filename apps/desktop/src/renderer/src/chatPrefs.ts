/** Chat-only preferences, stored on this computer: the spacing between one message and the next. */
import { tr } from './i18n'

export type MessageSpacing = 'compact' | 'comfortable' | 'wide'
export const messageSpacings: Array<{ value: MessageSpacing; label: string; gap: number }> = [
  { value: 'compact', get label() { return tr().chat.messageSpacing.compact }, gap: 12 },
  { value: 'comfortable', get label() { return tr().chat.messageSpacing.comfortable }, gap: 22 },
  { value: 'wide', get label() { return tr().chat.messageSpacing.wide }, gap: 34 }
]
const key = 'gearmod.messageSpacing'

export function readMessageSpacing(): MessageSpacing {
  try { const stored = localStorage.getItem(key); if (messageSpacings.some((item) => item.value === stored)) return stored as MessageSpacing } catch { /* no storage: uses the default */ }
  return 'comfortable'
}

export function applyMessageSpacing(value: MessageSpacing = readMessageSpacing()): void {
  document.documentElement.style.setProperty('--msg-gap', `${messageSpacings.find((item) => item.value === value)?.gap ?? 22}px`)
}

export function saveMessageSpacing(value: MessageSpacing): void {
  try { localStorage.setItem(key, value) } catch { /* only valid for this session */ }
  applyMessageSpacing(value)
}
