import { describe, expect, it } from 'vitest'
import { parseReviewContext } from './ChatMessageView'

describe('parseReviewContext', () => {
  it('separa arquivo, linhas, diff e comentário do pedido de revisão', () => {
    const result = parseReviewContext('Revisão de código em `src/User.tsx` (linhas 37–46):\n\n```diff\n+ const user = true\n- const user = false\n```\n\nnão é nada, só estou vendo')
    expect(result).toEqual({
      path: 'src/User.tsx', lines: 'linhas 37–46', oldCode: false,
      code: '+ const user = true\n- const user = false', comment: 'não é nada, só estou vendo'
    })
  })

  it('aceita uma linha antiga e quebras do Windows', () => {
    const result = parseReviewContext('Revisão de código em `src/a.ts` (linha 8, do código antigo):\r\n\r\n```diff\r\n- antigo\r\n```\r\n\r\nTrocar isso')
    expect(result).toMatchObject({ path: 'src/a.ts', lines: 'linha 8', oldCode: true, code: '- antigo', comment: 'Trocar isso' })
  })

  it('não transforma uma mensagem comum', () => {
    expect(parseReviewContext('Pode revisar `src/User.tsx`?')).toBeNull()
  })
})
