import { describe, expect, it } from 'vitest'
import type { GitRow } from '@agentboard/contracts'
import { agoLabel, ghostChip, graphEdges, initials, refChips, shortAgo, splitPath } from './gitView'

const now = Date.parse('2026-10-22T12:00:00Z')
const row = (hash: string, lane: number, parents: string[], extra: Partial<GitRow> = {}): GitRow => ({ hash, short: hash, parents, lane, author: 'Francisco Sena', email: '', date: '2026-10-22T11:00:00Z', subject: hash, refs: [], cardId: null, agentProfileId: null, wip: null, ...extra })

describe('etiquetas de data', () => {
  it('agrupa por semana e passa para meses e anos', () => {
    expect(agoLabel('2026-10-20T00:00:00Z', now)).toBe('esta semana')
    expect(agoLabel(null, now)).toBe('esta semana')
    expect(agoLabel('2026-10-12T00:00:00Z', now)).toBe('semana passada')
    expect(agoLabel('2026-10-01T00:00:00Z', now)).toBe('há 3 semanas')
    expect(agoLabel('2026-07-01T00:00:00Z', now)).toBe('há 3 meses')
    expect(agoLabel('2024-10-01T00:00:00Z', now)).toBe('há 2 anos')
  })
  it('tempo curto', () => {
    expect(shortAgo('2026-10-22T11:59:30Z', now)).toBe('agora')
    expect(shortAgo('2026-10-22T11:48:00Z', now)).toBe('12 min')
    expect(shortAgo('2026-10-22T09:00:00Z', now)).toBe('3 h')
    expect(shortAgo('2026-10-19T12:00:00Z', now)).toBe('3 dias')
  })
})

describe('chips de branch', () => {
  it('junta local e origin num chip só e marca a branch atual', () => {
    expect(refChips([{ name: 'main', kind: 'head' }, { name: 'origin/main', kind: 'remote' }, { name: 'origin/x', kind: 'remote' }, { name: 'v1', kind: 'tag' }])).toEqual([{ name: 'main', head: true, local: true, remote: true }, { name: 'x', remote: true }, { name: 'v1', tag: true }])
  })
  it('linha sem branch mostra a da faixa (acima) ou a principal na faixa 0', () => {
    const rows = [row('a', 1, ['b'], { refs: [{ name: 'feat', kind: 'local' }] }), row('b', 1, ['c']), row('c', 0, [])]
    expect(ghostChip(rows, 1, 'main')).toEqual({ name: 'feat', local: true })
    expect(ghostChip(rows, 2, 'main')).toEqual({ name: 'main', local: true, remote: true })
    expect(ghostChip(rows, 0, 'main')).toBeNull()
  })
})

describe('grafo', () => {
  it('linha reta na mesma faixa e curva de quase 90° entre faixas', () => {
    const rows = [row('a', 0, ['b']), row('b', 0, ['c']), row('x', 1, ['c']), row('c', 0, [])]
    const edges = graphEdges(rows, () => false)
    expect(edges[0]!.d).toBe('M16 18V54')
    expect(edges[2]!.d).toContain('Q')
    expect(edges[2]!.d.startsWith('M42 90V')).toBe(true)
  })
  it('pai fora da lista desce até o fim e WIP é tracejado', () => {
    const rows = [row('wip:main', 0, ['fora'], { wip: { modified: 1, added: 0, deleted: 0, staged: 0, branch: 'main' } })]
    const [edge] = graphEdges(rows, () => false)
    expect(edge).toMatchObject({ d: 'M16 18V36', wip: true })
  })
  it('esmaece o que não é do card em foco', () => {
    const rows = [row('a', 0, ['b'], { cardId: 'c1' }), row('b', 0, [])]
    expect(graphEdges(rows, (r) => r.cardId !== 'c1')[0]!.dim).toBe(true)
  })
})

describe('nomes', () => {
  it('iniciais e caminho', () => {
    expect(initials('Francisco Sena')).toBe('FS'); expect(initials('ana')).toBe('AN'); expect(initials('')).toBe('?')
    expect(splitPath('a/b/c.ts')).toEqual({ dir: 'a/b/', name: 'c.ts' }); expect(splitPath('c.ts')).toEqual({ dir: '', name: 'c.ts' })
  })
})
