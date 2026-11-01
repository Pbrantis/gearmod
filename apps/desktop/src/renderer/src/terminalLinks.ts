/** Caminho com `:linha[:coluna]` achado numa linha do terminal. `start`/`text` marcam o trecho clicável; `path` vem sem aspas. */
export interface TerminalFileLink { start: number; text: string; path: string; line: number; column?: number }

const ext = String.raw`\.[\p{L}\p{N}]{1,8}`
const position = String.raw`:(\d+)(?::(\d+))?`
// 1) Entre aspas: aceita espaço. A linha pode vir dentro (`"a b.ts:3"`) ou logo depois (`"a b.ts":3`).
const quoted = String.raw`(["'])([^"'\r\n]+?${ext})(?:${position})?\1(?:${position})?`
// 2) Caminho com letra de unidade (`C:\pasta teste\ação.ts:10`): pastas podem ter espaço; o nome do arquivo, não.
const drive = String.raw`[A-Za-z]:[\\/](?:[^\\/:*?"'<>|\r\n]+[\\/])*[^\\/:*?"'<>|\s]+?${ext}${position}`
// 3) Relativo, Unix ou UNC (`src/ação.ts:2`, `/home/x/a.py:7:1`, `..\b.cs:4`, `\\srv\c.ts:1`): letras Unicode, sem espaço.
const plain = String.raw`(?:\\\\|~|\.{1,2})?[\\/]?(?:[\p{L}\p{M}\p{N}_@.+\-]+[\\/])*[\p{L}\p{M}\p{N}_@.+\-]+?${ext}${position}`
const pattern = new RegExp(`${quoted}|(${drive})|(${plain})`, 'gu')

const toNumber = (value: string | undefined): number | undefined => value === undefined ? undefined : Number(value)

/** Links de arquivo numa linha de texto do terminal, na ordem em que aparecem; só valem os que têm número de linha. */
export function findFileLinks(text: string): TerminalFileLink[] {
  const links: TerminalFileLink[] = []
  for (const found of text.matchAll(pattern)) {
    const start = found.index ?? 0
    if (found[1]) {
      const line = toNumber(found[3] ?? found[5]); if (!line) continue
      const column = toNumber(found[3] ? found[4] : found[6])
      links.push({ start, text: found[0], path: found[2]!, line, ...(column ? { column } : {}) })
      continue
    }
    // Grupos do caminho com unidade: 7 (tudo), 8 linha, 9 coluna; do relativo: 10, 11, 12.
    const whole = found[7] ?? found[10]!, line = toNumber(found[8] ?? found[11])!, column = toNumber(found[7] ? found[9] : found[12])
    const suffix = whole.match(/:\d+(?::\d+)?$/)![0]
    links.push({ start, text: whole, path: whole.slice(0, -suffix.length), line, ...(column ? { column } : {}) })
  }
  return links
}

/** Caminho com a posição no formato que o painel de arquivos entende (`a.ts:10:2`). */
export const linkTarget = (link: TerminalFileLink): string => `${link.path}:${link.line}${link.column ? `:${link.column}` : ''}`
