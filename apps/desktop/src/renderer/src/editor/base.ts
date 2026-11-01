import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightWhitespace, keymap, lineNumbers, rectangularSelection, scrollPastEnd } from '@codemirror/view'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search'
import { highlight, editorTheme } from './theme'
import { tr } from '../i18n'

export interface EditorOptions { tabs?: boolean; wrap: boolean; tabSize: number; indentWithTab: boolean; whitespace: boolean; guides: boolean; scrollPastEnd: boolean }
export const none: Extension = []
/** Extensões fixas, comuns ao editor e ao diff: calha, histórico, pares, destaques, atalhos padrão, tema e cores de sintaxe. */
export const baseExtensions = (variant: 'code' | 'prose' = 'code'): Extension[] => [
  ...(variant === 'code' ? [lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), rectangularSelection(), crosshairCursor(), foldGutter(), closeBrackets()] : []),
  history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), highlightSelectionMatches({ minSelectionLength: 2, wholeWords: true }),
  EditorState.allowMultipleSelections.of(true),
  EditorState.phrases.of(tr().files.editor.cmPhrases),
  keymap.of([...(variant === 'prose' ? [{ key: 'Mod-h', run: openSearchPanel, preventDefault: true }] : []), ...(variant === 'code' ? closeBracketsKeymap : []), ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...(variant === 'code' ? foldKeymap : [])]),
  editorTheme, highlight
]
/** Opções que o usuário muda na hora (quebra de linha, recuo, espaços visíveis...); entram por compartimento. */
export const optionExtensions = (options: EditorOptions): Extension[] => [
  options.wrap ? EditorView.lineWrapping : none,
  EditorState.tabSize.of(options.tabSize), indentUnit.of(options.tabs ? '\t' : ' '.repeat(options.tabSize)),
  options.indentWithTab ? keymap.of([indentWithTab]) : none,
  options.whitespace ? highlightWhitespace() : none,
  options.scrollPastEnd ? scrollPastEnd() : none
]
export const readOnlyExtension = (readOnly: boolean): Extension => readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : none
