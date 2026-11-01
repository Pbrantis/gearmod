import { EditorSelection, Prec, type Extension } from '@codemirror/state'
import { keymap, type Command, type KeyBinding } from '@codemirror/view'
import { copyLineDown, copyLineUp, deleteLine, indentLess, indentMore, insertBlankLine, moveLineDown, moveLineUp, selectLine, toggleBlockComment, toggleComment } from '@codemirror/commands'
import { foldCode, unfoldCode } from '@codemirror/language'
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search'
import { tr } from '../i18n'

export interface EditorActions {
  save(): void; find(): void; replace(): void; goto(): void
  /** Navegação pelo índice de código: F12, Shift+F12 e Ctrl+Shift+O. */
  definition?(): void; references?(): void; outline?(): void
}

/** Ctrl+Shift+Enter: abre uma linha nova acima da atual, já com o recuo dela. */
export const insertLineAbove: Command = ({ state, dispatch }) => {
  if (state.readOnly) return false
  const changes = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head), text = /^[ \t]*/.exec(line.text)![0]
    return { changes: { from: line.from, insert: `${text}\n` }, range: EditorSelection.cursor(line.from + text.length) }
  })
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
  return true
}

/** Atalho e descrição (no idioma da interface) mostrados no menu de configurações do editor. */
export const shortcutList = (): Array<{ keys: string; label: string }> => {
  const s = tr().files.editor.shortcuts
  return [
    { keys: 'Ctrl+S', label: s.save }, { keys: 'Ctrl+F', label: s.find }, { keys: 'Ctrl+H', label: s.replace }, { keys: 'Ctrl+G', label: s.goto },
    { keys: 'Ctrl+Z / Ctrl+Y', label: s.undoRedo }, { keys: 'Alt+↑ / Alt+↓', label: s.moveLine }, { keys: 'Shift+Alt+↑ / ↓', label: s.duplicateLine },
    { keys: 'Ctrl+Shift+K', label: s.deleteLine }, { keys: 'Ctrl+Enter', label: s.lineBelow }, { keys: 'Ctrl+Shift+Enter', label: s.lineAbove },
    { keys: 'Tab / Shift+Tab', label: s.indent }, { keys: 'Ctrl+] / Ctrl+[', label: s.indent }, { keys: 'Ctrl+/', label: s.commentLine },
    { keys: 'Shift+Alt+A', label: s.commentBlock }, { keys: 'Ctrl+D', label: s.selectNext }, { keys: 'Ctrl+Shift+L', label: s.selectAll },
    { keys: s.altClick, label: s.addCursor }, { keys: 'Ctrl+L', label: s.selectLine }, { keys: 'Ctrl+Shift+[ / ]', label: s.fold },
    { keys: 'Ctrl+T', label: s.symbol }, { keys: 'Ctrl+Shift+O', label: s.outline }, { keys: 'F12', label: s.definition }, { keys: 'Shift+F12', label: s.references }
  ]
}

const ran = (action: () => void): Command => () => { action(); return true }
/** Atalhos do editor, com prioridade sobre os padrões do CodeMirror (que abririam o painel de busca nativo). */
export function editorKeymap(actions: EditorActions): Extension {
  const bindings: KeyBinding[] = [
    { key: 'Mod-s', run: ran(actions.save), preventDefault: true }, { key: 'Mod-f', run: ran(actions.find), preventDefault: true },
    { key: 'Mod-h', run: ran(actions.replace), preventDefault: true }, { key: 'Mod-g', run: ran(actions.goto), preventDefault: true },
    { key: 'Alt-ArrowUp', run: moveLineUp }, { key: 'Alt-ArrowDown', run: moveLineDown },
    { key: 'Shift-Alt-ArrowUp', run: copyLineUp }, { key: 'Shift-Alt-ArrowDown', run: copyLineDown },
    { key: 'Mod-Shift-k', run: deleteLine }, { key: 'Mod-Enter', run: insertBlankLine }, { key: 'Mod-Shift-Enter', run: insertLineAbove },
    { key: 'Mod-]', run: indentMore }, { key: 'Mod-[', run: indentLess },
    { key: 'Mod-/', run: toggleComment }, { key: 'Shift-Alt-a', run: toggleBlockComment },
    { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true }, { key: 'Mod-Shift-l', run: selectSelectionMatches, preventDefault: true },
    { key: 'Mod-l', run: selectLine, preventDefault: true },
    { key: 'Mod-Shift-[', run: foldCode }, { key: 'Mod-Shift-]', run: unfoldCode },
    ...(actions.definition ? [{ key: 'F12', run: ran(actions.definition), preventDefault: true }] : []),
    ...(actions.references ? [{ key: 'Shift-F12', run: ran(actions.references), preventDefault: true }] : []),
    ...(actions.outline ? [{ key: 'Mod-Shift-o', run: ran(actions.outline), preventDefault: true }] : [])
  ]
  return Prec.highest(keymap.of(bindings))
}
