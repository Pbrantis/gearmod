import { describe, expect, it } from 'vitest'
import { diffReviewPrompt } from './diffPrompt'

const after = 'um\nDOIS\ntres\nquatro'
describe('diffReviewPrompt', () => {
  it('traz o trecho atual e o antigo dos chunks que cruzam a seleção', () => {
    const text = diffReviewPrompt({ path: 'src/a.ts', from: 2, to: 2, after, chunks: [{ fromLine: 2, toLine: 2, old: 'dois\n' }, { fromLine: 4, toLine: 4, old: 'antigo\n' }], comment: 'Por que mudou?' })
    expect(text).toContain('`src/a.ts` (linha 2')
    expect(text).toContain('```ts\nDOIS\n```')
    expect(text).toContain('Antes desta alteração:\n\n```\ndois\n```')
    expect(text).not.toContain('antigo')
    expect(text.endsWith('Por que mudou?')).toBe(true)
  })
  it('aceita seleção invertida e intervalo de linhas', () => {
    const text = diffReviewPrompt({ path: 'a.md', from: 3, to: 1, after, chunks: [] })
    expect(text).toContain('linhas 1–3')
    expect(text).toContain('um\nDOIS\ntres')
    expect(text).not.toContain('Antes desta alteração')
  })
  it('considera remoção pura (sem linhas novas) na posição onde ela ocorreu', () => {
    const text = diffReviewPrompt({ path: 'a.ts', from: 3, to: 3, after, chunks: [{ fromLine: 3, toLine: 2, old: 'removida\n' }] })
    expect(text).toContain('removida')
  })
  it('usa mais crases quando o trecho já tem cerca', () => {
    expect(diffReviewPrompt({ path: 'a.md', from: 1, to: 1, after: '```js', chunks: [] })).toContain('````md\n```js\n````')
  })
})
