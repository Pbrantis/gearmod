import { describe, expect, it } from 'vitest'
import { findFileLinks, linkTarget } from './terminalLinks'

const paths = (text: string): string[] => findFileLinks(text).map(linkTarget)

describe('findFileLinks', () => {
  it('acha caminho relativo com linha e coluna', () => {
    expect(findFileLinks('src/App.tsx:12:5 - error TS2322')).toEqual([{ start: 0, text: 'src/App.tsx:12:5', path: 'src/App.tsx', line: 12, column: 5 }])
  })
  it('aceita letras acentuadas no nome e nas pastas', () => {
    expect(paths('falhou em docs/configuração/ação.ts:7')).toEqual(['docs/configuração/ação.ts:7'])
  })
  it('aceita caminho Windows com espaço nas pastas e acento no nome', () => {
    const [link] = findFileLinks('erro em C:\\pasta teste\\ação.ts:10')
    expect(link).toEqual({ start: 8, text: 'C:\\pasta teste\\ação.ts:10', path: 'C:\\pasta teste\\ação.ts', line: 10 })
  })
  it('aceita caminho entre aspas com espaço no nome, com a linha dentro ou fora das aspas', () => {
    expect(paths('"C:\\meus arquivos\\nota fiscal.ts:3:4"')).toEqual(['C:\\meus arquivos\\nota fiscal.ts:3:4'])
    expect(paths("abriu 'src/novo arquivo.py':8")).toEqual(['src/novo arquivo.py:8'])
  })
  it('ignora aspas sem número de linha', () => {
    expect(findFileLinks('"C:\\pasta\\a.ts" e "b.md"')).toEqual([])
  })
  it('acha caminhos Unix, relativos com ponto e UNC', () => {
    expect(paths('/home/ana/projeto/main.py:7:1 ../lib/x.go:3 \\\\srv\\share\\c.cs:9')).toEqual(['/home/ana/projeto/main.py:7:1', '../lib/x.go:3', '\\\\srv\\share\\c.cs:9'])
  })
  it('acha o caminho dentro de stack trace entre parênteses', () => {
    expect(paths('    at Object.<anonymous> (D:\\app\\src\\índice.js:10:5)')).toEqual(['D:\\app\\src\\índice.js:10:5'])
  })
  it('separa dois caminhos na mesma linha', () => {
    expect(paths('C:\\a\\b.ts:1 C:\\c d\\e.ts:2')).toEqual(['C:\\a\\b.ts:1', 'C:\\c d\\e.ts:2'])
  })
  it('não marca texto sem extensão ou sem linha', () => {
    expect(findFileLinks('rodando em 127.0.0.1 porta 3000, arquivo README.md')).toEqual([])
  })
})
