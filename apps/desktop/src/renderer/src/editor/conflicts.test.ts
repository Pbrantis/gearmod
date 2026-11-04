import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { conflictText, findConflicts, hasConflicts } from './conflicts'

const simple = 'antes\n<<<<<<< HEAD\nnosso\n=======\nvem de lá\n>>>>>>> feat\ndepois\n'
describe('findConflicts', () => {
  it('simple conflict with the names and the chunks of each side', () => {
    const [found] = findConflicts(simple)
    expect(found).toBeDefined(); expect(found!.oursName).toBe('HEAD'); expect(found!.theirsName).toBe('feat'); expect(found!.base).toBeNull()
    expect(conflictText(simple, found!.ours)).toBe('nosso\n'); expect(conflictText(simple, found!.theirs)).toBe('vem de lá\n')
    expect(simple.slice(0, found!.from)).toBe('antes\n'); expect(simple.slice(found!.to)).toBe('depois\n')
  })
  it('two conflicts', () => {
    const text = `${simple}meio\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feat\n`
    const found = findConflicts(text)
    expect(found).toHaveLength(2); expect(conflictText(text, found[1]!.ours)).toBe('a\n'); expect(conflictText(text, found[1]!.theirs)).toBe('b\n')
  })
  it('diff3: the base is not mistaken for the incoming side', () => {
    const text = '<<<<<<< HEAD\nnosso\n||||||| base\noriginal\n=======\nvem\n>>>>>>> feat\n'
    const [found] = findConflicts(text)
    expect(conflictText(text, found!.ours)).toBe('nosso\n'); expect(conflictText(text, found!.base!)).toBe('original\n'); expect(conflictText(text, found!.theirs)).toBe('vem\n')
  })
  it('CRLF', () => {
    const text = 'a\r\n<<<<<<< HEAD\r\nnosso\r\n=======\r\nvem\r\n>>>>>>> feat\r\nz\r\n'
    const [found] = findConflicts(text)
    expect(conflictText(text, found!.ours)).toBe('nosso\r\n'); expect(text.slice(found!.to)).toBe('z\r\n')
  })
  it('an incomplete marker is ignored and a new start restarts the block', () => {
    expect(findConflicts('<<<<<<< HEAD\nnosso\n=======\nvem\n')).toEqual([])
    expect(findConflicts('<<<<<<< HEAD\nlixo\n<<<<<<< HEAD\nnosso\n=======\nvem\n>>>>>>> feat\n')).toHaveLength(1)
    expect(findConflicts('=======\n>>>>>>> x\n')).toEqual([])
  })
  it('conflict at the end of the file without a line break', () => {
    const text = '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> feat'
    const [found] = findConflicts(text)
    expect(found!.to).toBe(text.length); expect(conflictText(text, found!.theirs)).toBe('b\n')
  })
})
describe('hasConflicts and state', () => {
  it('detects only a whole block', () => { expect(hasConflicts(simple)).toBe(true); expect(hasConflicts('<<<<<<< x\nsó abre\n')).toBe(false); expect(hasConflicts('texto')).toBe(false) })
  it('accept replaces the whole block in one transaction', () => {
    const state = EditorState.create({ doc: simple, extensions: [] }), found = findConflicts(simple)[0]!
    const accepted = state.update({ changes: { from: found.from, to: found.to, insert: conflictText(simple, found.ours) + conflictText(simple, found.theirs) } }).state.doc.toString()
    expect(accepted).toBe('antes\nnosso\nvem de lá\ndepois\n')
  })
})
