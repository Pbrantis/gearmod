/** Trecho alterado: linhas novas (a partir de 1; `toLine < fromLine` quando só houve remoção) e o texto que estava lá antes. */
export interface ReviewChunk { fromLine: number; toLine: number; old: string }

const fence = (text: string, language = ''): string => { const ticks = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1))); return `${ticks}${language}\n${text}\n${ticks}` }

/**
 * Texto do pedido de revisão feito no diff: arquivo, linhas (numeração nova), o trecho atual e, nos trechos alterados que cruzam a seleção,
 * o que estava antes. `from`/`to` são linhas a partir de 1, em qualquer ordem.
 */
export function diffReviewPrompt({ path, from, to, after, chunks, comment = '' }: { path: string; from: number; to: number; after: string; chunks: ReviewChunk[]; comment?: string }): string {
  const lo = Math.max(1, Math.min(from, to)), hi = Math.max(from, to), lines = after.split('\n')
  const current = lines.slice(lo - 1, hi).join('\n'), span = lo === hi ? `linha ${lo}` : `linhas ${lo}–${hi}`
  const crossing = chunks.filter((chunk) => chunk.fromLine <= hi && Math.max(chunk.toLine, chunk.fromLine) >= lo)
  const old = crossing.length ? `\n\nAntes desta alteração:\n\n${crossing.map((chunk) => fence(chunk.old.replace(/\n$/, ''))).join('\n\n')}` : ''
  return `Revisão de código em \`${path}\` (${span}, texto atual do diff):\n\n${fence(current, /\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? '')}${old}${comment.trim() ? `\n\n${comment.trim()}` : ''}`
}
