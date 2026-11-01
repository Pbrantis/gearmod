import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { kindMark, nameAtCursor, symbolTrail, type OutlineItem } from './codeNavigation'

const at = (doc: string, anchor: number, head = anchor): EditorState => EditorState.create({ doc, selection: EditorSelection.single(anchor, head) })

describe('navegação pelo índice de código no editor', () => {
  it('monta a trilha classe › método da linha do cursor', () => {
    const items: OutlineItem[] = [
      { line: 1, endLine: 20, text: 'Service', depth: 0, kind: 'class' },
      { line: 2, endLine: 2, text: 'field', depth: 1, kind: 'field' },
      { line: 4, endLine: 9, text: 'start', depth: 1, kind: 'method' },
      { line: 11, endLine: 18, text: 'stop', depth: 1, kind: 'method' },
      { line: 22, endLine: 30, text: 'helper', depth: 0, kind: 'function' }
    ]
    expect(symbolTrail(items, 5).map((item) => item.text)).toEqual(['Service', 'start'])
    expect(symbolTrail(items, 10).map((item) => item.text)).toEqual(['Service'])
    expect(symbolTrail(items, 25).map((item) => item.text)).toEqual(['helper'])
    expect(symbolTrail(items, 21)).toEqual([])
  })

  it('pega o nome sob o cursor ou o último pedaço da seleção', () => {
    const doc = 'this.deps.history.record(item)'
    expect(nameAtCursor(at(doc, 20))).toBe('record')
    expect(nameAtCursor(at(doc, 24))).toBe('record')
    expect(nameAtCursor(at(doc, 0, 24))).toBe('record')
    expect(nameAtCursor(at('a + b', 2))).toBe('')
    expect(nameAtCursor(at('x = "duas palavras"', 4, 18))).toBe('')
  })

  it('marca curta por tipo de símbolo', () => {
    expect([kindMark('method'), kindMark('class'), kindMark('interface'), kindMark('const'), kindMark('macro'), kindMark(undefined)]).toEqual(['ƒ', 'C', 'I', 'v', 'M', '·'])
  })
})
