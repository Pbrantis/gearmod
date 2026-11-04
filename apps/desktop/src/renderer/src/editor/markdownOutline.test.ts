import { describe, expect, it } from 'vitest'
import { headingTrail, markdownHeadings } from './markdownOutline'

const doc = ['# Plano', '', 'texto', '```bash', '# não é título', '```', '## Fase 1', '~~~', '## nem este', '~~~', '### T01 ##', '## Fase 2', '#sem espaço', '    # recuado demais'].join('\n')
describe('markdownHeadings', () => {
  it('lists headings with level and line, ignoring code blocks', () => {
    expect(markdownHeadings(doc)).toEqual([{ level: 1, text: 'Plano', line: 1 }, { level: 2, text: 'Fase 1', line: 7 }, { level: 3, text: 'T01', line: 11 }, { level: 2, text: 'Fase 2', line: 12 }])
  })
  it('accepts CRLF and removes formatting marks from the text', () => { expect(markdownHeadings('# **Oi** `x`\r\n')).toEqual([{ level: 1, text: 'Oi x', line: 1 }]) })
})
describe('headingTrail', () => {
  it('returns the current heading and its parents', () => {
    const headings = markdownHeadings(doc)
    expect(headingTrail(headings, 11).map((item) => item.text)).toEqual(['Plano', 'Fase 1', 'T01'])
    expect(headingTrail(headings, 12).map((item) => item.text)).toEqual(['Plano', 'Fase 2'])
    expect(headingTrail(headings, 2).map((item) => item.text)).toEqual(['Plano'])
    expect(headingTrail([], 5)).toEqual([])
  })
})
