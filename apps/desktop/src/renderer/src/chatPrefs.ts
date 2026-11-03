/** Preferências só do chat, guardadas neste computador: o espaço entre uma mensagem e a seguinte. */
import { tr } from './i18n'

export type MessageSpacing = 'compact' | 'comfortable' | 'wide'
export const messageSpacings: Array<{ value: MessageSpacing; label: string; gap: number }> = [
  { value: 'compact', get label() { return tr().chat.messageSpacing.compact }, gap: 12 },
  { value: 'comfortable', get label() { return tr().chat.messageSpacing.comfortable }, gap: 22 },
  { value: 'wide', get label() { return tr().chat.messageSpacing.wide }, gap: 34 }
]
const key = 'gearmod.messageSpacing'

export function readMessageSpacing(): MessageSpacing {
  try { const stored = localStorage.getItem(key); if (messageSpacings.some((item) => item.value === stored)) return stored as MessageSpacing } catch { /* sem armazenamento: usa o padrão */ }
  return 'comfortable'
}

export function applyMessageSpacing(value: MessageSpacing = readMessageSpacing()): void {
  document.documentElement.style.setProperty('--msg-gap', `${messageSpacings.find((item) => item.value === value)?.gap ?? 22}px`)
}

export function saveMessageSpacing(value: MessageSpacing): void {
  try { localStorage.setItem(key, value) } catch { /* só vale nesta sessão */ }
  applyMessageSpacing(value)
}
