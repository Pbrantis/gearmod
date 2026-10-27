import { EditorSelection, Prec, type Extension } from '@codemirror/state'
import { keymap, type Command, type KeyBinding } from '@codemirror/view'
import { copyLineDown, copyLineUp, deleteLine, indentLess, indentMore, insertBlankLine, moveLineDown, moveLineUp, selectLine, toggleBlockComment, toggleComment } from '@codemirror/commands'
import { foldCode, unfoldCode } from '@codemirror/language'
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search'

export interface EditorActions { save(): void; find(): void; replace(): void; goto(): void }

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

/** Atalho e descrição (em português) mostrados no menu de configurações do editor. */
export const shortcutList: Array<{ keys: string; label: string }> = [
  { keys: 'Ctrl+S', label: 'Salvar' }, { keys: 'Ctrl+F', label: 'Localizar' }, { keys: 'Ctrl+H', label: 'Substituir' }, { keys: 'Ctrl+G', label: 'Ir para linha' },
  { keys: 'Ctrl+Z / Ctrl+Y', label: 'Desfazer / refazer' }, { keys: 'Alt+↑ / Alt+↓', label: 'Mover linha' }, { keys: 'Shift+Alt+↑ / ↓', label: 'Duplicar linha' },
  { keys: 'Ctrl+Shift+K', label: 'Excluir linha' }, { keys: 'Ctrl+Enter', label: 'Linha nova abaixo' }, { keys: 'Ctrl+Shift+Enter', label: 'Linha nova acima' },
  { keys: 'Tab / Shift+Tab', label: 'Aumentar / diminuir recuo' }, { keys: 'Ctrl+] / Ctrl+[', label: 'Aumentar / diminuir recuo' }, { keys: 'Ctrl+/', label: 'Comentar linha' },
  { keys: 'Shift+Alt+A', label: 'Comentar bloco' }, { keys: 'Ctrl+D', label: 'Selecionar próxima ocorrência' }, { keys: 'Ctrl+Shift+L', label: 'Selecionar todas as ocorrências' },
  { keys: 'Alt+clique', label: 'Adicionar cursor' }, { keys: 'Ctrl+L', label: 'Selecionar linha' }, { keys: 'Ctrl+Shift+[ / ]', label: 'Recolher / expandir trecho' }
]

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
    { key: 'Mod-Shift-[', run: foldCode }, { key: 'Mod-Shift-]', run: unfoldCode }
  ]
  return Prec.highest(keymap.of(bindings))
}
