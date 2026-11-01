import { describe, expect, it } from 'vitest'
import { usageHistorySummary } from './Sidebar'

describe('resumo do histórico de uso', () => {
  it('mantém tokens e cada tipo de custo em áreas independentes', () => {
    expect(usageHistorySummary([
      { period: '2026-10', group: 'p1', input: 120, cached: 20, output: 30, billedUsd: 1.25, equivalentUsd: 3, unknownUsd: 0 },
      { period: '2026-10', group: 'p2', input: 80, cached: 0, output: 10, billedUsd: 0, equivalentUsd: 0, unknownUsd: 2 }
    ])).toEqual({ input: 200, cached: 20, output: 40, billed: 1.25, equivalent: 3, unknown: 2 })
  })

  it('tem estado vazio sem sugerir custo ou percentual', () => {
    expect(usageHistorySummary([])).toEqual({ input: 0, cached: 0, output: 0, billed: 0, equivalent: 0, unknown: 0 })
  })
})
