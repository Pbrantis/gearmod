/**
 * Atalhos de teclado do app: cada ação tem um atalho padrão que a pessoa pode trocar em Configurações > Atalhos.
 * O que ela escolhe fica guardado neste computador (localStorage) e vale para todas as janelas do app.
 */
export type ShortcutId = 'toggleSidebar' | 'toggleQuickView' | 'toggleFiles' | 'toggleTerminal'

export const shortcutIds: ShortcutId[] = ['toggleSidebar', 'toggleQuickView', 'toggleFiles', 'toggleTerminal']
export const shortcutDefaults: Record<ShortcutId, string> = { toggleSidebar: 'Ctrl+B', toggleQuickView: 'Ctrl+Alt+B', toggleFiles: 'Ctrl+Shift+F', toggleTerminal: 'Ctrl+`' }
/** Combinações que o sistema, os campos de texto ou o próprio app já usam: não podem ser escolhidas. */
const reserved = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+F', 'Ctrl+S', 'Ctrl+W', 'Ctrl+R', 'Ctrl+T', 'Ctrl+N', 'F5', 'F12', 'Shift+F12'])

const storeKey = 'gearmod.shortcuts'
export const shortcutsChangedEvent = 'gearmod:shortcuts-changed'
/** Disparado quando um atalho é acionado; `detail.id` diz qual. Quem trata a ação escuta este evento. */
export const shortcutEvent = 'gearmod:shortcut'

export function loadShortcuts(): Record<ShortcutId, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Partial<Record<ShortcutId, string>>
    return Object.fromEntries(shortcutIds.map((id) => [id, typeof saved[id] === 'string' && saved[id] ? saved[id]! : shortcutDefaults[id]])) as Record<ShortcutId, string>
  } catch { return { ...shortcutDefaults } }
}

export function saveShortcuts(next: Record<ShortcutId, string>): void {
  try { localStorage.setItem(storeKey, JSON.stringify(next)) } catch { /* só vale nesta sessão */ }
  window.dispatchEvent(new Event(shortcutsChangedEvent))
}

const modifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'])

/** Nome da tecla pela posição física (não muda com o teclado: ABNT2, US...). */
function keyName(event: KeyboardEvent): string | null {
  if (modifierKeys.has(event.key)) return null
  const code = event.code
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  const named: Record<string, string> = { Backquote: '`', Backslash: '\\', Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Space: 'Space', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert' }
  return named[code] ?? (event.key.length === 1 ? event.key.toUpperCase() : null)
}

/** `Ctrl+Alt+B` do evento de teclado, ou `null` se foi só um modificador. */
export function comboOf(event: KeyboardEvent): string | null {
  const key = keyName(event)
  if (!key) return null
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Meta', key].filter(Boolean).join('+')
}

/** Combinação aceita como atalho: tem Ctrl, Alt ou Meta (ou é uma tecla F) e não está na lista dos reservados. Devolve o motivo da recusa, ou `null` se vale. */
export function comboProblem(combo: string): 'needsModifier' | 'reserved' | null {
  const parts = combo.split('+'), key = parts[parts.length - 1]!
  if (!parts.some((part) => part === 'Ctrl' || part === 'Alt' || part === 'Meta') && !/^F\d+$/.test(key)) return 'needsModifier'
  return reserved.has(combo) ? 'reserved' : null
}

/** O evento aciona este atalho? (Ctrl+` também aceita o que o teclado ABNT2 entrega como tecla morta.) */
export function matches(event: KeyboardEvent, combo: string): boolean {
  if (comboOf(event) === combo) return true
  return combo === 'Ctrl+`' && event.ctrlKey && !event.altKey && !event.shiftKey && (event.key === '^' || event.key === '`' || event.key === 'Dead')
}

/** Qual ação o evento aciona, se alguma. */
export function shortcutFor(event: KeyboardEvent): ShortcutId | null {
  const all = loadShortcuts()
  return shortcutIds.find((id) => matches(event, all[id])) ?? null
}
