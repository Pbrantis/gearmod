/**
 * Detecção de comandos SQL destrutivos (PostgreSQL), usada pela tela de SQL para pedir confirmação
 * e pelo processo principal como defesa. Ignora comentários (`--`, `/* *\/` aninhados), strings
 * (`'...'`, `E'...'`, `$tag$...$tag$`) e identificadores entre aspas, e separa os comandos por `;`.
 *
 * O que conta como destrutivo: `DROP ...`, `TRUNCATE ...`, `DELETE`/`UPDATE` sem `WHERE` (também dentro
 * de CTEs) e `ALTER ... DROP ...`. Corpos de funções e blocos `DO` ficam em strings e não são analisados.
 */
export type DestructiveKind = 'drop' | 'truncate' | 'delete-all' | 'update-all' | 'alter-drop'
export interface DestructiveStatement { kind: DestructiveKind; sql: string }

interface Token { type: 'word' | 'open' | 'close' | 'other'; value: string }
interface Statement { tokens: Token[]; start: number; end: number }

/** Quebra o texto em comandos, já sem comentários e strings (que viram um token `other`). */
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

/** Procura `word` no mesmo nível de parênteses a partir de `from`, até o fim do escopo. */
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

/** Posições onde começa um comando: o início, logo depois de `(` e o comando principal depois das CTEs. */
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

/** Comandos destrutivos encontrados em `sql`, na ordem em que aparecem. */
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
