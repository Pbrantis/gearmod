import type React from 'react'

/** Text of the chat box after an edit, with the selection to restore. */
export interface InputEdit { text: string; start: number; end: number }

// Markdown list item: indentation, marker (`-`, `*`, `+`, `1.` or `1)`), space, optional checkbox and the content.
const listItem = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/
const indentUnit = '  '

function lineAt(text: string, at: number): { start: number; end: number; line: string } {
  const start = text.lastIndexOf('\n', at - 1) + 1, found = text.indexOf('\n', at), end = found < 0 ? text.length : found
  return { start, end, line: text.slice(start, end) }
}

/**
 * New line inside a list (Shift+Enter): continues it with the same marker (the next number, an unchecked box). On an empty item,
 * ends the list instead, as in Markdown editors. Outside a list, or with the caret before the marker, returns null (plain new line).
 */
export function continueList(text: string, selStart: number, selEnd: number): InputEdit | null {
  const { start, end, line } = lineAt(text, selStart)
  const match = listItem.exec(line)
  if (!match) return null
  const [, indent, marker, space, box, content] = match as unknown as [string, string, string, string, string | undefined, string]
  const prefix = indent.length + marker.length + space.length + (box?.length ?? 0)
  if (selStart - start < prefix) return null
  if (!content.trim() && selEnd >= end) return { text: text.slice(0, start) + text.slice(end), start, end: start }
  const number = /^\d+/.exec(marker)
  const next = number ? `${Number(number[0]) + 1}${marker.slice(number[0].length)}` : marker
  const insert = `\n${indent}${next}${space}${box ? '[ ] ' : ''}`
  const at = selStart + insert.length
  return { text: text.slice(0, selStart) + insert + text.slice(selEnd), start: at, end: at }
}

/** Tab / Shift+Tab on list lines: indents or outdents every item touched by the selection. Not a list: null (Tab keeps moving focus). */
export function indentList(text: string, selStart: number, selEnd: number, outdent: boolean): InputEdit | null {
  const first = lineAt(text, selStart).start, last = lineAt(text, Math.max(selStart, selEnd - (selEnd > selStart && text[selEnd - 1] === '\n' ? 1 : 0))).end
  const lines = text.slice(first, last).split('\n')
  if (!lines.some((line) => listItem.test(line))) return null
  // Each list line gains (or loses) spaces at its start; `at` is that start in the original text.
  const edits: Array<{ at: number; added: number; removed: number }> = []
  let offset = first
  const changed = lines.map((line) => {
    const at = offset; offset += line.length + 1
    if (!listItem.test(line)) return line
    const removed = outdent ? Math.min(indentUnit.length, /^ */.exec(line)![0].length) : 0
    edits.push({ at, added: outdent ? 0 : indentUnit.length, removed })
    return outdent ? line.slice(removed) : indentUnit + line
  })
  // A position follows its text: spaces added before it push it right, spaces removed before it pull it left (never past the line start).
  const map = (position: number, keepAtLineStart: boolean): number => edits.reduce((moved, edit) => {
    if (position < edit.at || (position === edit.at && keepAtLineStart)) return moved
    return moved + edit.added - Math.min(edit.removed, position - edit.at)
  }, position)
  const collapsed = selStart === selEnd
  return { text: text.slice(0, first) + changed.join('\n') + text.slice(last), start: map(selStart, !collapsed), end: map(selEnd, false) }
}

/**
 * List keys of the chat box: Shift+Enter continues the list, Tab/Shift+Tab indents its items. Enter alone still sends.
 * Returns true when it handled the key (the caller stops there).
 */
export function listKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>, apply: (edit: InputEdit) => void): boolean {
  if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return false
  const area = event.currentTarget
  const edit = event.key === 'Enter' && event.shiftKey ? continueList(area.value, area.selectionStart, area.selectionEnd)
    : event.key === 'Tab' ? indentList(area.value, area.selectionStart, area.selectionEnd, event.shiftKey) : null
  if (!edit) return false
  event.preventDefault()
  apply(edit)
  return true
}
