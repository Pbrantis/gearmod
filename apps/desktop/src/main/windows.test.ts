import { describe, expect, it } from 'vitest'
import { oppositePlacement, placementBounds, popoutQuery } from './windows'

const area = { x: 0, y: 0, width: 2000, height: 1000 }

describe('windows', () => {
  it('divide a área útil ao meio', () => {
    expect(placementBounds(area, 'left')).toEqual({ x: 0, y: 0, width: 1000, height: 1000 })
    expect(placementBounds(area, 'right')).toEqual({ x: 1000, y: 0, width: 1000, height: 1000 })
    expect(placementBounds(area, 'top')).toEqual({ x: 0, y: 0, width: 2000, height: 500 })
    expect(placementBounds(area, 'bottom')).toEqual({ x: 0, y: 500, width: 2000, height: 500 })
  })
  it('janela nova cabe na tela pequena', () => {
    const small = placementBounds({ x: 0, y: 0, width: 800, height: 600 }, 'new')
    expect(small.width).toBe(800); expect(small.height).toBe(600)
  })
  it('devolve a metade oposta', () => {
    expect(oppositePlacement('left')).toBe('right'); expect(oppositePlacement('bottom')).toBe('top'); expect(oppositePlacement('new')).toBeNull()
  })
  it('preenche a área útil sem mover a outra janela', () => {
    expect(placementBounds(area, 'fill')).toEqual(area); expect(oppositePlacement('fill')).toBeNull()
  })
  it('monta a query só com o que existe', () => {
    expect(popoutQuery({ kind: 'chat', projectId: 'p', cardId: 'c' })).toEqual({ pop: 'chat', project: 'p', card: 'c' })
  })
  it('abre somente o arquivo preservando o contexto do card e caracteres no caminho', () => {
    const query = popoutQuery({ kind: 'file', projectId: 'p', cardId: 'c', path: 'C:/repo/docs/nota #1.md' })
    const parsed = new URLSearchParams(new URLSearchParams(query).toString())
    expect(parsed.get('pop')).toBe('file'); expect(parsed.get('card')).toBe('c'); expect(parsed.get('path')).toBe('C:/repo/docs/nota #1.md')
  })
})
