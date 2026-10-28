import { describe, expect, it } from 'vitest'
import { nearestDockEdge } from './dockLayout'

describe('posição dos painéis', () => {
  it('escolhe a borda mais próxima para os quatro lados, mesmo em janela larga', () => {
    expect(nearestDockEdge(20, 400, 1600, 800)).toBe('left')
    expect(nearestDockEdge(1580, 400, 1600, 800)).toBe('right')
    expect(nearestDockEdge(800, 25, 1600, 800)).toBe('top')
    expect(nearestDockEdge(800, 775, 1600, 800)).toBe('bottom')
  })
})
