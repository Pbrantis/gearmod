import { describe, expect, it } from 'vitest'
import { parseAnsi } from './ansi'

describe('parseAnsi', () => {
  it('separa cores e depois volta ao normal', () => {
    const [line] = parseAnsi('\x1b[31mruim\x1b[0m ok')
    expect(line).toEqual([{ text: 'ruim', style: { color: '#ff6b6b' } }, { text: ' ok', style: {} }])
  })
  it('mantém a cor entre linhas até o reset', () => {
    const lines = parseAnsi('\x1b[32mum\ndois\x1b[0m')
    expect(lines[1]![0]!.style.color).toBe('#5fd38a')
  })
  it('barra de progresso com \\r fica na última versão da linha', () => {
    expect(parseAnsi('10%\r50%\r100%\n')[0]).toEqual([{ text: '100%', style: {} }])
  })
  it('apaga sequências que não são de cor', () => {
    expect(parseAnsi('a\x1b[2Kb\x1b]0;titulo\x07c')[0]!.map((span) => span.text).join('')).toBe('abc')
  })
})
