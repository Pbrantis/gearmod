import { describe, expect, it } from 'vitest'
import { continueList, indentList } from './markdownInput'

const end = (text: string) => continueList(text, text.length, text.length)

describe('chat box Markdown lists', () => {
  it('continues bullets, numbers and checkboxes on a new line', () => {
    expect(end('- add espaço entre eles')).toEqual({ text: '- add espaço entre eles\n- ', start: 26, end: 26 })
    expect(end('  * sub item')?.text).toBe('  * sub item\n  * ')
    expect(end('9. nove')?.text).toBe('9. nove\n10. ')
    expect(end('1) um')?.text).toBe('1) um\n2) ')
    expect(end('- [x] feito')?.text).toBe('- [x] feito\n- [ ] ')
  })

  it('ends the list on an empty item and ignores text that is not a list', () => {
    expect(end('- primeiro\n- ')).toEqual({ text: '- primeiro\n', start: 11, end: 11 })
    expect(end('texto normal')).toBeNull()
    expect(end('-sem espaço')).toBeNull()
    // Caret before the marker: a plain new line.
    expect(continueList('- item', 0, 0)).toBeNull()
  })

  it('splits the item where the caret is', () => {
    expect(continueList('- antes depois', 8, 8)).toEqual({ text: '- antes \n- depois', start: 11, end: 11 })
  })

  it('indents and outdents list lines with Tab, keeping the caret on its text', () => {
    expect(indentList('- a', 3, 3, false)).toEqual({ text: '  - a', start: 5, end: 5 })
    expect(indentList('  - a', 5, 5, true)).toEqual({ text: '- a', start: 3, end: 3 })
    expect(indentList('- a', 3, 3, true)).toEqual({ text: '- a', start: 3, end: 3 })
    expect(indentList('- a\n- b\ntexto', 0, 7, false)).toEqual({ text: '  - a\n  - b\ntexto', start: 0, end: 11 })
    expect(indentList('texto', 2, 2, false)).toBeNull()
  })
})
