import { EditorView, Decoration, WidgetType, keymap, type DecorationSet } from '@codemirror/view'
import { EditorSelection, Prec, StateField, type EditorState, type Extension } from '@codemirror/state'

export interface Conflict {
  /** Do começo da linha `<<<<<<<` até o fim da linha `>>>>>>>` (com a quebra de linha), em caracteres do documento. */
  from: number; to: number
  ours: { from: number; to: number }; base: { from: number; to: number } | null; theirs: { from: number; to: number }
  oursName: string; theirsName: string
  /** Posições dos quatro marcadores (começo de cada linha) para decorar. */
  markers: number[]
}

const hasMarkers = /^<{7}( |$)[^]*?^>{7}( |$)/m
/** Rápido: o texto tem um bloco de conflito inteiro? (para ligar a extensão só quando vale a pena) */
export const hasConflicts = (text: string): boolean => hasMarkers.test(text)

/**
 * Blocos de conflito do Git (`<<<<<<<`, `|||||||` opcional do diff3, `=======`, `>>>>>>>`), com posições de caractere; aceita CRLF.
 * Bloco sem fechamento é ignorado, e um `<<<<<<<` novo antes de fechar recomeça o bloco.
 */
export function findConflicts(text: string): Conflict[] {
  const conflicts: Conflict[] = []
  let at = 0, state: 0 | 1 | 2 | 3 = 0
  let start = 0, oursName = '', oursFrom = 0, baseFrom = -1, baseMarker = -1, middle = -1, theirsFrom = 0
  while (at <= text.length) {
    const newline = text.indexOf('\n', at), lineEnd = newline < 0 ? text.length : newline, next = newline < 0 ? text.length + 1 : newline + 1
    const line = text.slice(at, lineEnd).replace(/\r$/, '')
    if (/^<{7}( |$)/.test(line)) { state = 1; start = at; oursName = line.slice(8).trim(); oursFrom = next; baseFrom = -1; baseMarker = -1; middle = -1 }
    else if (state === 1 && /^\|{7}( |$)/.test(line)) { state = 2; baseMarker = at; baseFrom = next }
    else if ((state === 1 || state === 2) && /^={7}$/.test(line)) { state = 3; middle = at; theirsFrom = next }
    else if (state === 3 && /^>{7}( |$)/.test(line)) {
      const oursEnd = baseMarker >= 0 ? baseMarker : middle
      conflicts.push({ from: start, to: Math.min(next, text.length), ours: { from: oursFrom, to: oursEnd }, base: baseMarker >= 0 ? { from: baseFrom, to: middle } : null, theirs: { from: theirsFrom, to: at }, oursName, theirsName: line.slice(8).trim(), markers: [start, ...(baseMarker >= 0 ? [baseMarker] : []), middle, at] })
      state = 0
    }
    at = next
  }
  return conflicts
}

/** Texto do trecho escolhido (cada lado termina com a quebra de linha de antes do marcador seguinte). */
export const conflictText = (text: string, range: { from: number; to: number }): string => text.slice(range.from, range.to)

export interface ConflictOptions { oursLabel: string; theirsLabel: string; compare?(info: { ours: string; theirs: string; oursLabel: string; theirsLabel: string }): void }
type Choice = 'ours' | 'theirs' | 'both'

const conflictField = StateField.define<Conflict[]>({ create: (state) => findConflicts(state.doc.toString()), update: (value, transaction) => transaction.docChanged ? findConflicts(transaction.newDoc.toString()) : value })
export const conflictsIn = (state: EditorState): Conflict[] => state.field(conflictField, false) ?? []

/** Troca o bloco inteiro pelo lado escolhido numa única transação (um Ctrl+Z desfaz). */
export function resolveConflict(view: EditorView, at: number, choice: Choice): boolean {
  const text = view.state.doc.toString(), found = findConflicts(text).find((item) => at >= item.from && at < item.to)
  if (!found) return false
  const ours = conflictText(text, found.ours), theirs = conflictText(text, found.theirs)
  view.dispatch({ changes: { from: found.from, to: found.to, insert: choice === 'ours' ? ours : choice === 'theirs' ? theirs : ours + theirs }, userEvent: 'input' })
  return true
}

class Actions extends WidgetType {
  constructor(private readonly options: ConflictOptions, private readonly from: number, private readonly signature: string) { super() }
  eq(other: Actions): boolean { return other.from === this.from && other.signature === this.signature && other.options.oursLabel === this.options.oursLabel && other.options.theirsLabel === this.options.theirsLabel }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div'); box.className = 'cm-conflict-actions'
    const add = (label: string, title: string, run: (position: number) => void): void => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.title = title
      button.onmousedown = (event) => { event.preventDefault(); run(view.posAtDOM(box)) }
      box.append(button)
    }
    add(`Aceitar ${this.options.oursLabel}`, `Manter só o bloco ${this.options.oursLabel}`, (position) => resolveConflict(view, position, 'ours'))
    add(`Aceitar ${this.options.theirsLabel}`, `Manter só o bloco ${this.options.theirsLabel}`, (position) => resolveConflict(view, position, 'theirs'))
    add('Aceitar ambos', 'Manter os dois, um depois do outro', (position) => resolveConflict(view, position, 'both'))
    if (this.options.compare) add('Comparar', 'Ver os dois lados lado a lado', (position) => { const text = view.state.doc.toString(), found = findConflicts(text).find((item) => position >= item.from && position < item.to); if (found) this.options.compare?.({ ours: conflictText(text, found.ours), theirs: conflictText(text, found.theirs), oursLabel: this.options.oursLabel, theirsLabel: this.options.theirsLabel }) })
    return box
  }
  ignoreEvent(): boolean { return true }
}

const line = (name: string): Decoration => Decoration.line({ class: name })
function decorate(state: EditorState, options: ConflictOptions): DecorationSet {
  const ranges = []
  for (const conflict of conflictsIn(state)) {
    ranges.push(Decoration.widget({ widget: new Actions(options, conflict.from, `${conflict.oursName}|${conflict.theirsName}`), block: true, side: -1 }).range(conflict.from))
    const paint = (range: { from: number; to: number }, name: string): void => { let at = range.from; while (at < range.to) { const row = state.doc.lineAt(at); ranges.push(line(name).range(row.from)); at = row.to + 1 } }
    paint(conflict.ours, 'cm-conflict-ours'); if (conflict.base) paint(conflict.base, 'cm-conflict-base'); paint(conflict.theirs, 'cm-conflict-theirs')
    for (const marker of conflict.markers) ranges.push(line('cm-conflict-marker').range(state.doc.lineAt(marker).from))
  }
  return Decoration.set(ranges, true)
}

const jump = (forward: boolean) => (view: EditorView): boolean => {
  const all = conflictsIn(view.state)
  if (!all.length) return false
  const head = view.state.selection.main.head
  const target = forward ? all.find((item) => item.from > head) ?? all[0]! : [...all].reverse().find((item) => item.from < head) ?? all.at(-1)!
  view.dispatch({ selection: EditorSelection.cursor(target.from), effects: EditorView.scrollIntoView(target.from, { y: 'start', yMargin: 48 }) }); return true
}
export const nextConflict = jump(true), previousConflict = jump(false)

const theme = EditorView.baseTheme({
  '.cm-conflict-ours': { backgroundColor: 'color-mix(in srgb, #3fb950 16%, transparent)' },
  '.cm-conflict-theirs': { backgroundColor: 'color-mix(in srgb, #4493f8 16%, transparent)' },
  '.cm-conflict-base': { backgroundColor: 'color-mix(in srgb, #8b949e 16%, transparent)' },
  '.cm-conflict-marker': { color: 'var(--muted)', opacity: '.8', fontStyle: 'italic' },
  '.cm-conflict-actions': { display: 'flex', gap: '12px', padding: '2px 8px', fontSize: '11px', background: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-conflict-actions button': { border: '0', background: 'none', padding: '0', color: 'var(--accent-strong, var(--accent))', cursor: 'pointer', font: 'inherit' },
  '.cm-conflict-actions button:hover': { textDecoration: 'underline' }
})

/** Conflito de merge dentro do editor: cores por lado, "Aceitar atual · chegando · ambos · Comparar" acima de cada bloco e Alt+F5 / Shift+Alt+F5 entre blocos. */
export function conflictExtension(options: ConflictOptions): Extension {
  return [conflictField, theme, EditorView.decorations.compute([conflictField], (state) => decorate(state, options)), Prec.high(keymap.of([{ key: 'Alt-F5', run: nextConflict }, { key: 'Shift-Alt-F5', run: previousConflict }]))]
}
