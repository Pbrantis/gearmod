import { describe, expect, it } from 'vitest'
import { findFileLinks, linkTarget } from './terminalLinks'

const paths = (text: string): string[] => findFileLinks(text).map(linkTarget)

describe('findFileLinks', () => {
  it('finds a relative path with line and column', () => {
    expect(findFileLinks('src/App.tsx:12:5 - error TS2322')).toEqual([{ start: 0, text: 'src/App.tsx:12:5', path: 'src/App.tsx', line: 12, column: 5 }])
  })
  it('accepts accented letters in the name and folders', () => {
    expect(paths('falhou em docs/configuração/ação.ts:7')).toEqual(['docs/configuração/ação.ts:7'])
  })
  it('accepts a Windows path with spaces in folders and an accent in the name', () => {
    const [link] = findFileLinks('erro em C:\\pasta teste\\ação.ts:10')
    expect(link).toEqual({ start: 8, text: 'C:\\pasta teste\\ação.ts:10', path: 'C:\\pasta teste\\ação.ts', line: 10 })
  })
  it('accepts a quoted path with a space in the name, with the line inside or outside the quotes', () => {
    expect(paths('"C:\\meus arquivos\\nota fiscal.ts:3:4"')).toEqual(['C:\\meus arquivos\\nota fiscal.ts:3:4'])
    expect(paths("abriu 'src/novo arquivo.py':8")).toEqual(['src/novo arquivo.py:8'])
  })
  it('ignores quotes without a line number', () => {
    expect(findFileLinks('"C:\\pasta\\a.ts" e "b.md"')).toEqual([])
  })
  it('finds Unix paths, dot-relative paths and UNC', () => {
    expect(paths('/home/ana/projeto/main.py:7:1 ../lib/x.go:3 \\\\srv\\share\\c.cs:9')).toEqual(['/home/ana/projeto/main.py:7:1', '../lib/x.go:3', '\\\\srv\\share\\c.cs:9'])
  })
  it('finds the path inside a parenthesized stack trace', () => {
    expect(paths('    at Object.<anonymous> (D:\\app\\src\\índice.js:10:5)')).toEqual(['D:\\app\\src\\índice.js:10:5'])
  })
  it('separates two paths on the same line', () => {
    expect(paths('C:\\a\\b.ts:1 C:\\c d\\e.ts:2')).toEqual(['C:\\a\\b.ts:1', 'C:\\c d\\e.ts:2'])
  })
  it('does not mark text without an extension or line', () => {
    expect(findFileLinks('rodando em 127.0.0.1 porta 3000, arquivo README.md')).toEqual([])
  })
})
