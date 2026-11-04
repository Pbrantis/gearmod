import { describe, expect, it } from 'vitest'
import { diffReviewPrompt } from './diffPrompt'

const after = 'um\nDOIS\ntres\nquatro'
describe('diffReviewPrompt', () => {
  it('includes the current and old text of the chunks that cross the selection', () => {
    const text = diffReviewPrompt({ path: 'src/a.ts', from: 2, to: 2, after, chunks: [{ fromLine: 2, toLine: 2, old: 'dois\n' }, { fromLine: 4, toLine: 4, old: 'antigo\n' }], comment: 'Por que mudou?' })
    expect(text).toContain('`src/a.ts` (linha 2')
    expect(text).toContain('```ts\nDOIS\n```')
    expect(text).toContain('Antes desta alteração:\n\n```\ndois\n```')
    expect(text).not.toContain('antigo')
    expect(text.endsWith('Por que mudou?')).toBe(true)
  })
  it('accepts a reversed selection and a line range', () => {
    const text = diffReviewPrompt({ path: 'a.md', from: 3, to: 1, after, chunks: [] })
    expect(text).toContain('linhas 1–3')
    expect(text).toContain('um\nDOIS\ntres')
    expect(text).not.toContain('Antes desta alteração')
  })
  it('treats a pure removal (no new lines) at the position where it happened', () => {
    const text = diffReviewPrompt({ path: 'a.ts', from: 3, to: 3, after, chunks: [{ fromLine: 3, toLine: 2, old: 'removida\n' }] })
    expect(text).toContain('removida')
  })
  it('uses more backticks when the snippet already has a fence', () => {
    expect(diffReviewPrompt({ path: 'a.md', from: 1, to: 1, after: '```js', chunks: [] })).toContain('````md\n```js\n````')
  })
})
