export interface AnsiStyle { color?: string; bold?: boolean; dim?: boolean; underline?: boolean }
export interface AnsiSpan { text: string; style: AnsiStyle }

const base = ['#6b7280', '#ff6b6b', '#5fd38a', '#e8c27a', '#6aa6ff', '#d28bff', '#5fd3d3', '#d4d9d5']
const bright = ['#9ca3af', '#ff8f86', '#8fe9ae', '#f5dc9a', '#9cc2ff', '#e4b0ff', '#8ff0f0', '#ffffff']

function paletteColor(n: number): string | undefined {
  if (n < 8) return base[n]
  if (n < 16) return bright[n - 8]
  if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})` }
  const i = n - 16, level = (k: number): number => (k === 0 ? 0 : 55 + k * 40)
  return `rgb(${level(Math.floor(i / 36))},${level(Math.floor(i / 6) % 6)},${level(i % 6)})`
}

function applyCodes(style: AnsiStyle, codes: number[]): AnsiStyle {
  const next = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    if (code === 0) return applyCodes({}, codes.slice(i + 1))
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 4) next.underline = true
    else if (code === 22) { delete next.bold; delete next.dim }
    else if (code === 24) delete next.underline
    else if (code >= 30 && code <= 37) next.color = base[code - 30]!
    else if (code >= 90 && code <= 97) next.color = bright[code - 90]!
    else if (code === 39) delete next.color
    else if (code === 38 && codes[i + 1] === 5) { const color = paletteColor(codes[i + 2] ?? 0); if (color) next.color = color; i += 2 }
    else if (code === 38 && codes[i + 1] === 2) { next.color = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`; i += 4 }
  }
  return next
}

/**
 * Texto de terminal em linhas coloridas. Entende cores e negrito (SGR), apaga as outras sequências de controle e trata `\r`
 * como "volta ao começo da linha" (barras de progresso viram uma linha só, a última versão).
 */
export function parseAnsi(raw: string): AnsiSpan[][] {
  const lines: AnsiSpan[][] = []
  let style: AnsiStyle = {}
  for (const rawLine of raw.replace(/\r\n/g, '\n').split('\n')) {
    const segments = rawLine.split('\r').filter((segment, index, all) => segment.length > 0 || index === all.length - 1)
    // O estilo vale para as linhas seguintes, então todos os trechos passam pelo parser; só o último é mostrado.
    let spans: AnsiSpan[] = []
    for (const segment of segments) {
      spans = []
      // eslint-disable-next-line no-control-regex -- é justamente a sequência de escape do terminal
      const pattern = /\x1b\[([0-9;?]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
      let last = 0, match: RegExpExecArray | null
      while ((match = pattern.exec(segment))) {
        if (match.index > last) spans.push({ text: segment.slice(last, match.index), style })
        if (match[2] === 'm') style = applyCodes(style, (match[1] ?? '').split(';').map((part) => Number(part) || 0))
        last = pattern.lastIndex
      }
      if (last < segment.length) spans.push({ text: segment.slice(last), style })
    }
    lines.push(spans)
  }
  return lines
}
