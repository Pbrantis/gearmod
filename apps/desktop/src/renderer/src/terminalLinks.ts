/** Path with `:line[:column]` found in a terminal line. `start`/`text` mark the clickable span; `path` comes without quotes. */
export interface TerminalFileLink { start: number; text: string; path: string; line: number; column?: number }

const ext = String.raw`\.[\p{L}\p{N}]{1,8}`
const position = String.raw`:(\d+)(?::(\d+))?`
// 1) Quoted: allows spaces. The line can come inside (`"a b.ts:3"`) or right after (`"a b.ts":3`).
const quoted = String.raw`(["'])([^"'\r\n]+?${ext})(?:${position})?\1(?:${position})?`
// 2) Path with a drive letter (`C:\test folder\ação.ts:10`): folders may contain spaces; the file name may not.
const drive = String.raw`[A-Za-z]:[\\/](?:[^\\/:*?"'<>|\r\n]+[\\/])*[^\\/:*?"'<>|\s]+?${ext}${position}`
// 3) Relative, Unix or UNC (`src/ação.ts:2`, `/home/x/a.py:7:1`, `..\b.cs:4`, `\\srv\c.ts:1`): Unicode letters, no spaces.
const plain = String.raw`(?:\\\\|~|\.{1,2})?[\\/]?(?:[\p{L}\p{M}\p{N}_@.+\-]+[\\/])*[\p{L}\p{M}\p{N}_@.+\-]+?${ext}${position}`
const pattern = new RegExp(`${quoted}|(${drive})|(${plain})`, 'gu')

const toNumber = (value: string | undefined): number | undefined => value === undefined ? undefined : Number(value)

/** File links in a line of terminal text, in the order they appear; only those with a line number count. */
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
    // Groups of the drive-letter path: 7 (whole), 8 line, 9 column; of the relative one: 10, 11, 12.
    const whole = found[7] ?? found[10]!, line = toNumber(found[8] ?? found[11])!, column = toNumber(found[7] ? found[9] : found[12])
    const suffix = whole.match(/:\d+(?::\d+)?$/)![0]
    links.push({ start, text: whole, path: whole.slice(0, -suffix.length), line, ...(column ? { column } : {}) })
  }
  return links
}

/** Path with the position in the format the file panel understands (`a.ts:10:2`). */
export const linkTarget = (link: TerminalFileLink): string => `${link.path}:${link.line}${link.column ? `:${link.column}` : ''}`
