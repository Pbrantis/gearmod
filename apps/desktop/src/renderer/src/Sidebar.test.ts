import { describe, expect, it } from 'vitest'
import { usageByAgent, usageHistorySummary } from './Sidebar'

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

describe('consumo por agente', () => {
  it('soma os meses de cada agente e ordena pelo maior custo', () => {
    const row = (group: string, input: number, equivalentUsd: number) => ({ period: '2026-10', group, input, cached: 0, output: 1, billedUsd: 0, equivalentUsd, unknownUsd: 0 })
    const result = usageByAgent([row('a', 10, 1), row('b', 5, 3), row('a', 2, 1)])
    expect(result.map((item) => [item.id, item.input, item.equivalent])).toEqual([['b', 5, 3], ['a', 12, 2]])
  })
})
