import { describe, expect, it } from 'vitest'
import { detectEol, detectIndent, minimalChange, normalizeEol, parseGoto, splitLineSuffix, withEol } from './position'

describe('splitLineSuffix', () => {
  it('lê linha e coluna', () => {
    expect(splitLineSuffix('src/x.ts:30')).toEqual({ path: 'src/x.ts', line: 30 })
    expect(splitLineSuffix('src/x.ts:30:7')).toEqual({ path: 'src/x.ts', line: 30, column: 7 })
    expect(splitLineSuffix('src/x.ts#L42')).toEqual({ path: 'src/x.ts', line: 42 })
    expect(splitLineSuffix('src/x.ts#L42C3-L50')).toEqual({ path: 'src/x.ts', line: 42, column: 3 })
  })
  it('não confunde com o disco do Windows nem com caminho puro', () => {
    expect(splitLineSuffix('C:\\work\\x.ts')).toEqual({ path: 'C:\\work\\x.ts' })
    expect(splitLineSuffix('C:\\work\\x.ts:12')).toEqual({ path: 'C:\\work\\x.ts', line: 12 })
    expect(splitLineSuffix('src/x.ts')).toEqual({ path: 'src/x.ts' })
  })
})
describe('parseGoto', () => {
  it('aceita linha e linha:coluna', () => {
    expect(parseGoto('120')).toEqual({ line: 120, column: 1 })
    expect(parseGoto(' 120:5 ')).toEqual({ line: 120, column: 5 })
    expect(parseGoto('abc')).toBeNull()
    expect(parseGoto('')).toBeNull()
  })
})
describe('fim de linha', () => {
  it('detecta e converte de volta', () => {
    expect(detectEol('a\r\nb\r\n')).toBe('crlf')
    expect(detectEol('a\nb\n')).toBe('lf')
    expect(detectEol('a\r\nb\nc\nd\n')).toBe('lf')
    const text = 'a\r\nb\r\n'
    expect(withEol(normalizeEol(text), detectEol(text))).toBe(text)
  })
})
describe('detectIndent', () => {
  it('reconhece tab e espaços', () => {
    expect(detectIndent('a\n\tb\n\t\tc\n\td')).toEqual({ kind: 'tab' })
    expect(detectIndent('a\n  b\n    c\n  d')).toEqual({ kind: 'spaces', size: 2 })
    expect(detectIndent('a\n    b\n        c\n    d')).toEqual({ kind: 'spaces', size: 4 })
    expect(detectIndent('a\nb')).toEqual({ kind: 'spaces', size: null })
  })
})

describe('minimalChange', () => {
  const apply = (before: string, after: string): string => { const change = minimalChange(before, after); return before.slice(0, change.from) + change.insert + before.slice(change.to) }
  it('manda só o miolo que mudou', () => {
    expect(minimalChange('abc def ghi', 'abc XYZ ghi')).toEqual({ from: 4, to: 7, insert: 'XYZ' })
    expect(minimalChange('igual', 'igual')).toEqual({ from: 5, to: 5, insert: '' })
    expect(minimalChange('um\ndois', 'um\ndois\ntres')).toEqual({ from: 7, to: 7, insert: '\ntres' })
  })
  it('reconstrói o texto novo em qualquer caso', () => {
    for (const [a, b] of [['aaa', 'aa'], ['aa', 'aaa'], ['', 'x'], ['x', ''], ['abcabc', 'abc'], ['linha 1\nlinha 2', 'linha 1\nmeio\nlinha 2']] as const) expect(apply(a, b)).toBe(b)
  })
})
