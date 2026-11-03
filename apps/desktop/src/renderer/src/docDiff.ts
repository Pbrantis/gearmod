/** Diff unificado (formato do git) entre dois textos, linha a linha: alimenta o mesmo `DiffLines` do Git. */
const lines = (text: string): string[] => { const out = text.replace(/\r/g, '').split('\n'); if (out[out.length - 1] === '') out.pop(); return out }

type Op = { kind: ' ' | '+' | '-'; text: string }

function middleOps(a: string[], b: string[]): Op[] {
  if (!a.length) return b.map((text): Op => ({ kind: '+', text }))
  if (!b.length) return a.map((text): Op => ({ kind: '-', text }))
  // Texto enorme e todo diferente: não vale a tabela inteira; mostra tudo como trocado.
  if (a.length * b.length > 4_000_000) return [...a.map((text): Op => ({ kind: '-', text })), ...b.map((text): Op => ({ kind: '+', text }))]
  const w = b.length + 1, table = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1]! + 1 : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!)
  const ops: Op[] = []
  let i = 0, j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push({ kind: ' ', text: a[i]! }); i++; j++ }
    else if (table[(i + 1) * w + j]! >= table[i * w + j + 1]!) ops.push({ kind: '-', text: a[i++]! })
    else ops.push({ kind: '+', text: b[j++]! })
  }
  while (i < a.length) ops.push({ kind: '-', text: a[i++]! })
  while (j < b.length) ops.push({ kind: '+', text: b[j++]! })
  return ops
}

/** Diff unificado de `before` para `after`, com 3 linhas de contexto; vazio quando os textos são iguais. */
export function unifiedDiff(before: string, after: string, context = 3): string {
  const a = lines(before), b = lines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const ops: Op[] = [...a.slice(0, start).map((text): Op => ({ kind: ' ', text })), ...middleOps(a.slice(start, endA), b.slice(start, endB)), ...a.slice(endA).map((text): Op => ({ kind: ' ', text }))]
  if (!ops.some((op) => op.kind !== ' ')) return ''
  const keep = new Array<boolean>(ops.length).fill(false)
  ops.forEach((op, index) => { if (op.kind !== ' ') for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++) keep[k] = true })
  const out: string[] = []
  let oldNo = 1, newNo = 1, index = 0
  while (index < ops.length) {
    if (!keep[index]) { if (ops[index]!.kind !== '+') oldNo++; if (ops[index]!.kind !== '-') newNo++; index++; continue }
    let end = index; while (end < ops.length && keep[end]) end++
    const chunk = ops.slice(index, end), oldCount = chunk.filter((op) => op.kind !== '+').length, newCount = chunk.filter((op) => op.kind !== '-').length
    out.push(`@@ -${oldCount ? oldNo : oldNo - 1},${oldCount} +${newCount ? newNo : newNo - 1},${newCount} @@`)
    for (const op of chunk) out.push(`${op.kind}${op.text}`)
    oldNo += oldCount; newNo += newCount; index = end
  }
  return out.join('\n')
}
