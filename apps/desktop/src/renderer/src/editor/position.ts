/** Splits `file.ts:42`, `file.ts:42:7` and `file.ts#L42` (also `#L42C7` and `#L42-L50`); the Windows `C:\` does not count as a line. */
export function splitLineSuffix(path: string): { path: string; line?: number; column?: number } {
  const match = /^(.+?)(?::(\d+)(?::(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?)$/.exec(path)
  if (!match) return { path }
  const line = Number(match[2] ?? match[4]), column = match[3] ?? match[5]
  return line > 0 ? { path: match[1]!, line, ...(column ? { column: Number(column) } : {}) } : { path }
}

/** "Go to line" text: `42` or `42:7`; empty or invalid returns `null`. */
export function parseGoto(text: string): { line: number; column: number } | null {
  const match = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?\s*$/.exec(text)
  return match ? { line: Math.max(1, Number(match[1])), column: Math.max(1, Number(match[2] ?? 1)) } : null
}

export type Eol = 'lf' | 'crlf'
/** CodeMirror normalizes everything to `\n`; we keep the disk's line ending (the predominant one) to restore it on save. */
export function detectEol(text: string): Eol {
  const crlf = text.match(/\r\n/g)?.length ?? 0, lf = (text.match(/\n/g)?.length ?? 0) - crlf
  return crlf > lf ? 'crlf' : 'lf'
}
export const normalizeEol = (text: string): string => text.replace(/\r\n?/g, '\n')
export const withEol = (text: string, eol: Eol): string => eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text

export type Indent = { kind: 'tab' } | { kind: 'spaces'; size: number | null }
/** Predominant indentation of the file: Tab if most indented lines start with a tab; otherwise the most common space step (2, 4 or 8). */
export function detectIndent(text: string): Indent {
  let tabs = 0, spaces = 0, previous = 0
  const steps = new Map<number, number>()
  for (const line of text.split('\n', 4000)) {
    if (!line.trim()) continue
    if (line[0] === '\t') { tabs++; continue }
    const width = /^ */.exec(line)![0].length
    if (width > 0) spaces++
    const step = Math.abs(width - previous)
    if (width > 0 && step > 0) steps.set(step, (steps.get(step) ?? 0) + 1)
    previous = width
  }
  if (tabs > spaces) return { kind: 'tab' }
  const best = [2, 4, 8, 3, 1].map((size) => [size, steps.get(size) ?? 0] as const).sort((a, b) => b[1] - a[1])[0]
  return { kind: 'spaces', size: best && best[1] > 0 ? best[0] : null }
}

/** Minimal change between two texts: the middle part that differs (common prefix and suffix are left out). Keeps cursor, scroll and undo on reload. */
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } {
  const limit = Math.min(before.length, after.length)
  let start = 0
  while (start < limit && before[start] === after[start]) start++
  let endBefore = before.length, endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) { endBefore--; endAfter-- }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) }
}
