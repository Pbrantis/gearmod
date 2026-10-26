/** Preferências só do chat, guardadas neste computador: o espaço entre uma mensagem e a seguinte. */
export type MessageSpacing = 'compact' | 'comfortable' | 'wide'
export const messageSpacings: Array<{ value: MessageSpacing; label: string; gap: number }> = [
  { value: 'compact', label: 'Compacto', gap: 12 },
  { value: 'comfortable', label: 'Confortável', gap: 22 },
  { value: 'wide', label: 'Amplo', gap: 34 }
]
const key = 'agentboard.messageSpacing'

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
