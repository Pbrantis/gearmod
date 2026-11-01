import { describe, expect, it } from 'vitest'
import { plainSummary } from './cardText'

describe('plainSummary', () => {
  it('preserva hífens e asteriscos no meio das palavras', () => {
    expect(plainSummary('Status SALVO-OK depois do re-teste')).toBe('Status SALVO-OK depois do re-teste')
    expect(plainSummary('calcula 2*3*4 e a*b')).toBe('calcula 2*3*4 e a*b')
    expect(plainSummary('nome_de_variavel e snake_case')).toBe('nome_de_variavel e snake_case')
  })
  it('tira marcadores de lista, caixinhas e títulos só no começo da linha', () => {
    expect(plainSummary('## Resumo\n- [ ] T001 Ajustar o-botão\n- [x] feito\n* outro\n1. primeiro')).toBe('Resumo T001 Ajustar o-botão feito outro primeiro')
    expect(plainSummary('Preço - desconto # não é título')).toBe('Preço - desconto # não é título')
  })
  it('tira ênfase, código e links', () => {
    expect(plainSummary('Use **negrito**, *itálico*, _ênfase_ e `npm test` em [docs](http://x)')).toBe('Use negrito, itálico, ênfase e npm test em docs')
  })
  it('ignora cercas de código e linhas horizontais', () => {
    expect(plainSummary('Antes\n```ts\nconst a = 1\n```\n---\nDepois')).toBe('Antes const a = 1 Depois')
  })
})
