import type { GitRef, GitRow } from '@agentboard/contracts'

/** Cores das faixas do grafo, na ordem da faixa. */
export const laneColors = ['#8db99a', '#8fb8d6', '#e8c27a', '#b98fd6', '#e07a9a']
export const laneColor = (lane: number): string => laneColors[lane % laneColors.length]!
/** Posição horizontal do ponto de uma faixa. */
export const laneSpacing = 26
/** `spacing` encolhe com a coluna do grafo: as pistas vão se juntando até virar uma linha só (spacing 0). */
export const laneX = (lane: number, spacing = laneSpacing): number => 16 + lane * spacing
export const rowHeight = 36

export const isWip = (row: GitRow): boolean => row.wip !== null

/** Etiqueta de data por semana: "esta semana", "semana passada", "há N semanas"; depois de um mês, meses e anos. */
export function agoLabel(date: string | null, now = Date.now()): string {
  if (!date) return 'esta semana'
  const days = Math.max(0, Math.floor((now - new Date(date).getTime()) / 86_400_000))
  const weeks = Math.floor(days / 7)
  if (weeks === 0) return 'esta semana'
  if (weeks === 1) return 'semana passada'
  if (days < 35) return `há ${weeks} semanas`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? 'há 1 mês' : `há ${months} meses`
  const years = Math.floor(days / 365)
  return years === 1 ? 'há 1 ano' : `há ${years} anos`
}

/** Tempo curto para listas: "agora", "12 min", "3 h", "2 dias". */
export function shortAgo(date: string | null, now = Date.now()): string {
  if (!date) return 'agora'
  const minutes = Math.max(0, Math.floor((now - new Date(date).getTime()) / 60_000))
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 dia' : `${days} dias`
}

export interface RefChip { name: string; local?: boolean; remote?: boolean; head?: boolean; tag?: boolean }

/** Um chip por branch: local (computador) e origin (nuvem) juntos, em vez de repetir o nome com "origin/". */
export function refChips(refs: GitRef[]): RefChip[] {
  const map = new Map<string, RefChip>()
  for (const ref of refs) {
    const name = ref.kind === 'remote' ? ref.name.replace(/^[^/]+\//, '') : ref.name
    const chip = map.get(name) ?? { name }
    if (ref.kind === 'remote') chip.remote = true
    else if (ref.kind === 'tag') chip.tag = true
    else chip.local = true
    if (ref.kind === 'head') chip.head = true
    map.set(name, chip)
  }
  return [...map.values()]
}

/** Nas linhas sem branch, a branch daquela faixa (a mais próxima acima) aparece apagada ao passar o mouse. */
export function ghostChip(rows: GitRow[], index: number, headName: string | null): RefChip | null {
  const row = rows[index]!
  if (row.refs.length || isWip(row)) return null
  for (let i = index - 1; i >= 0; i--) {
    const above = rows[i]!
    if (above.lane === row.lane && above.refs.length) return refChips(above.refs)[0] ?? null
  }
  return row.lane === 0 && headName ? { name: headName, local: true } : null
}

/** Iniciais do autor para o ponto do grafo. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase()
}

export interface GraphEdge { d: string; color: string; wip: boolean; dim: boolean }

/** Linhas finas do grafo, com cantos arredondados de quase 90°. Pai fora da lista (além do limite) desce até o fim. */
export function graphEdges(rows: GitRow[], dimmed: (row: GitRow) => boolean, height = rowHeight, spacing = laneSpacing): GraphEdge[] {
  const index = new Map(rows.map((row, i) => [row.hash, i]))
  const y = (i: number): number => i * height + height / 2
  const edges: GraphEdge[] = []
  const radius = 9
  rows.forEach((row, i) => {
    for (const hash of row.parents) {
      const j = index.get(hash), xi = laneX(row.lane, spacing), yi = y(i)
      if (j === undefined) { edges.push({ d: `M${xi} ${yi}V${rows.length * height}`, color: laneColor(row.lane), wip: isWip(row), dim: dimmed(row) }); continue }
      const parent = rows[j]!, xj = laneX(parent.lane, spacing), yj = y(j), sign = Math.sign(xj - xi)
      const d = row.lane === parent.lane ? `M${xi} ${yi}V${yj}`
        : row.lane < parent.lane ? `M${xi} ${yi}H${xj - sign * radius}Q${xj} ${yi} ${xj} ${yi + radius}V${yj}`
          : `M${xi} ${yi}V${yj - radius}Q${xi} ${yj} ${xi + sign * radius} ${yj}H${xj}`
      edges.push({ d, color: laneColor(Math.max(row.lane, parent.lane)), wip: isWip(row), dim: dimmed(row) || dimmed(parent) })
    }
  })
  return edges
}

/** Separa "pasta/arquivo.ts" em diretório e nome. */
export function splitPath(path: string): { dir: string; name: string } {
  const at = path.lastIndexOf('/')
  return at < 0 ? { dir: '', name: path } : { dir: path.slice(0, at + 1), name: path.slice(at + 1) }
}

export const ruleLabel = { auto: 'Automático', ask: 'Pedir permissão', never: 'Nunca' } as const
export const ruleNote = {
  auto: 'o agente commita sozinho ao fechar cada task',
  ask: 'o agente pede antes de cada commit',
  never: 'o agente não commita nesta branch, só você'
} as const
