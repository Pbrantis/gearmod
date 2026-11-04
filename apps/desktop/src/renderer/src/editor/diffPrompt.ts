/** Changed chunk: new lines (1-based; `toLine < fromLine` when there was only a removal) and the text that was there before. */
export interface ReviewChunk { fromLine: number; toLine: number; old: string }

const fence = (text: string, language = ''): string => { const ticks = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1))); return `${ticks}${language}\n${text}\n${ticks}` }

/**
 * Text of the review request made in the diff: file, lines (new numbering), the current chunk and, for changed chunks that cross the selection,
 * what was there before. `from`/`to` are 1-based lines, in any order.
 */
export function diffReviewPrompt({ path, from, to, after, chunks, comment = '' }: { path: string; from: number; to: number; after: string; chunks: ReviewChunk[]; comment?: string }): string {
  const lo = Math.max(1, Math.min(from, to)), hi = Math.max(from, to), lines = after.split('\n')
  const current = lines.slice(lo - 1, hi).join('\n'), span = lo === hi ? `linha ${lo}` : `linhas ${lo}–${hi}`
  const crossing = chunks.filter((chunk) => chunk.fromLine <= hi && Math.max(chunk.toLine, chunk.fromLine) >= lo)
  const old = crossing.length ? `\n\nAntes desta alteração:\n\n${crossing.map((chunk) => fence(chunk.old.replace(/\n$/, ''))).join('\n\n')}` : ''
  return `Revisão de código em \`${path}\` (${span}, texto atual do diff):\n\n${fence(current, /\.([A-Za-z0-9]+)$/.exec(path)?.[1] ?? '')}${old}${comment.trim() ? `\n\n${comment.trim()}` : ''}`
}
