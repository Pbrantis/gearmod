/**
 * Detection of destructive SQL commands (PostgreSQL), used by the SQL screen to ask for confirmation
 * and by the main process as a defense. Ignores comments (`--`, nested `/* *\/`), strings
 * (`'...'`, `E'...'`, `$tag$...$tag$`) and quoted identifiers, and splits commands by `;`.
 *
 * What counts as destructive: `DROP ...`, `TRUNCATE ...`, `DELETE`/`UPDATE` without `WHERE` (also inside
 * CTEs) and `ALTER ... DROP ...`. Function bodies and `DO` blocks stay in strings and are not analyzed.
 */
export type DestructiveKind = 'drop' | 'truncate' | 'delete-all' | 'update-all' | 'alter-drop'
export interface DestructiveStatement { kind: DestructiveKind; sql: string }

interface Token { type: 'word' | 'open' | 'close' | 'other'; value: string }
interface Statement { tokens: Token[]; start: number; end: number }

/** Splits the text into commands, already without comments and strings (which become an `other` token). */
function statements(text: string): Statement[] {
  const result: Statement[] = []
  let tokens: Token[] = [], start = 0, i = 0
  const n = text.length
  const flush = (end: number): void => { if (tokens.length) result.push({ tokens, start, end }); tokens = []; start = end + 1 }
  while (i < n) {
    const c = text[i]!, next = text[i + 1]
    if (c === '-' && next === '-') { while (i < n && text[i] !== '\n') i++; continue }
    if (c === '/' && next === '*') {
      let depth = 1; i += 2
      while (i < n && depth > 0) { if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2 } else if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2 } else i++ }
      continue
    }
    if (c === "'" || ((c === 'E' || c === 'e') && next === "'" && !/[\w$]/.test(text[i - 1] ?? ''))) {
      const escapes = c !== "'"; i += escapes ? 2 : 1
      while (i < n) { if (escapes && text[i] === '\\') { i += 2; continue } if (text[i] === "'") { if (text[i + 1] === "'") { i += 2; continue } i++; break } i++ }
      tokens.push({ type: 'other', value: "''" }); continue
    }
    if (c === '"') { i++; while (i < n) { if (text[i] === '"') { if (text[i + 1] === '"') { i += 2; continue } i++; break } i++ } tokens.push({ type: 'other', value: '""' }); continue }
    if (c === '$' && !/[\w$]/.test(text[i - 1] ?? '')) {
      const tag = /^\$([A-Za-z_][\w]*)?\$/.exec(text.slice(i))
      if (tag) { const close = text.indexOf(tag[0], i + tag[0].length); i = close < 0 ? n : close + tag[0].length; tokens.push({ type: 'other', value: '$$' }); continue }
    }
    if (c === ';') { flush(i); i++; continue }
    if (c === '(') { tokens.push({ type: 'open', value: c }); i++; continue }
    if (c === ')') { tokens.push({ type: 'close', value: c }); i++; continue }
    if (/[A-Za-z_]/.test(c)) { let j = i + 1; while (j < n && /[\w$]/.test(text[j]!)) j++; tokens.push({ type: 'word', value: text.slice(i, j).toUpperCase() }); i = j; continue }
    if (/\s/.test(c)) { i++; continue }
    tokens.push({ type: 'other', value: c }); i++
  }
  flush(n)
  return result
}

const DML = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'VALUES', 'TABLE'])

/** Looks for `word` at the same parenthesis level from `from`, up to the end of the scope. */
function hasAtSameDepth(tokens: Token[], from: number, word: string): boolean {
  let depth = 0
  for (let i = from; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.type === 'open') depth++
    else if (token.type === 'close') { if (depth === 0) return false; depth-- }
    else if (depth === 0 && token.type === 'word' && token.value === word) return true
  }
  return false
}

/** Positions where a command starts: the beginning, right after `(` and the main command after the CTEs. */
function heads(tokens: Token[]): number[] {
  const result = [0]
  tokens.forEach((token, index) => { if (token.type === 'open' && tokens[index + 1]?.type === 'word') result.push(index + 1) })
  const withAt = result.filter((index) => tokens[index]?.value === 'WITH')
  for (const at of withAt) {
    let depth = 0
    for (let i = at + 1; i < tokens.length; i++) {
      const token = tokens[i]!
      if (token.type === 'open') depth++
      else if (token.type === 'close') { if (depth === 0) break; depth-- }
      else if (depth === 0 && token.type === 'word' && DML.has(token.value) && tokens[i - 1]?.type === 'close') { result.push(i); break }
    }
  }
  return result
}

/** Destructive commands found in `sql`, in the order they appear. */
export function destructiveStatements(sql: string): DestructiveStatement[] {
  const found: DestructiveStatement[] = []
  for (const statement of statements(sql)) {
    const { tokens } = statement, text = sql.slice(statement.start, statement.end).trim()
    let kind: DestructiveKind | undefined
    for (const at of heads(tokens)) {
      const word = tokens[at]?.type === 'word' ? tokens[at]!.value : ''
      if (at === 0 && word === 'DROP') kind = 'drop'
      else if (word === 'TRUNCATE') kind = 'truncate'
      else if (at === 0 && word === 'ALTER' && hasAtSameDepth(tokens, 1, 'DROP')) kind = 'alter-drop'
      else if (word === 'DELETE' && !hasAtSameDepth(tokens, at + 1, 'WHERE')) kind = 'delete-all'
      else if (word === 'UPDATE' && !hasAtSameDepth(tokens, at + 1, 'WHERE')) kind = 'update-all'
      if (kind) break
    }
    if (kind) found.push({ kind, sql: text })
  }
  return found
}
