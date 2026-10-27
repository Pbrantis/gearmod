import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

/** Usa só variáveis do app: o mesmo tema serve ao escuro e ao claro, sem `dark: true` fixo. */
export const editorTheme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'transparent', font: '12.5px/21px var(--mono)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { font: 'inherit', lineHeight: '21px', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--text)', padding: '12px 0 16px' },
  '.cm-line': { padding: '0 14px 0 8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { background: 'color-mix(in srgb, var(--accent) 35%, transparent)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', color: 'var(--muted)', border: 'none', borderRight: '1px solid var(--border)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px', minWidth: '34px', cursor: 'pointer', userSelect: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)', color: 'var(--text)' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', cursor: 'pointer' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--muted)' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)', outline: 'none' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 24%, transparent)', outline: '1px solid var(--accent-line)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 55%, transparent)' },
  '.cm-highlightSpace, .cm-highlightTab': { opacity: '.55', color: 'var(--muted)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 28px 6px 8px', fontSize: '12px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { font: 'inherit', fontSize: '12px', color: 'var(--text)', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '5px', padding: '2px 7px', margin: '2px 3px' },
  '.cm-panel.cm-search button': { cursor: 'pointer', backgroundImage: 'none' },
  '.cm-panel.cm-search label': { fontSize: '11.5px' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--muted)', border: '0', background: 'none' }
})

/** Mapeia as tags do Lezer para as classes `tok-*` que o CSS do app já pinta (escuro e claro). */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, class: 'tok-comment' },
  { tag: [tags.string, tags.special(tags.string)], class: 'tok-string' },
  { tag: [tags.number, tags.bool, tags.null], class: 'tok-number' },
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.modifier], class: 'tok-keyword' },
  { tag: [tags.propertyName, tags.attributeName], class: 'tok-property' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'tok-function' },
  { tag: [tags.tagName, tags.angleBracket], class: 'tok-tag' },
  { tag: tags.heading, class: 'tok-keyword', fontWeight: '700' }
])
export const highlight = syntaxHighlighting(codeHighlightStyle)
