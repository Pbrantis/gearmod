import { describe, expect, it } from 'vitest'
import { recommendedConcurrency } from './capacity'

const gb = (value: number): number => value * 1024 ** 3

describe('recommendedConcurrency', () => {
  it('limita pelo que for menor entre núcleos e memória', () => {
    expect(recommendedConcurrency(8, gb(16))).toBe(4)
    expect(recommendedConcurrency(16, gb(8))).toBe(2)
    expect(recommendedConcurrency(4, gb(32))).toBe(2)
  })

  it('nunca passa de 8 nem baixa de 1', () => {
    expect(recommendedConcurrency(64, gb(256))).toBe(8)
    expect(recommendedConcurrency(2, gb(4))).toBe(1)
    expect(recommendedConcurrency(1, gb(1))).toBe(1)
  })
})
