import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppDatabase } from '../database'
import { redact } from '../redaction'
import { tm } from '../i18n'

export type QueryAudit = { id: string; at: string; kind: 'table-page' | 'sql' | 'count'; sqlHash: string; durationMs: number; rows: number; status: 'ok' | 'error'; summary: string; sql?: string }
/** Suprime literais e comentários por completo, inclusive strings incompletas e dollar-quoted. */
export function redactSql(sql: string): string {
  let out = '', i = 0
  while (i < sql.length) {
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i + 2); out += '-- [redacted]'; i = end < 0 ? sql.length : end; continue }
    if (sql.startsWith('/*', i)) { let depth = 1; i += 2; while (i < sql.length && depth) { if (sql.startsWith('/*', i)) { depth++; i += 2 } else if (sql.startsWith('*/', i)) { depth--; i += 2 } else i++ }; out += '/* [redacted] */'; continue }
    const quote = sql[i]
    if (quote === "'" || quote === '"') {
      i++
      while (i < sql.length) { if (sql[i] === '\\' && quote === "'") { i += 2; continue }; if (sql[i] === quote) { i++; if (sql[i] === quote) { i++; continue }; break }; i++ }
      out += quote === "'" ? "'[redacted]'" : '"[redacted]"'; continue
    }
    if (quote === '$') { const tag = sql.slice(i).match(/^\$[a-zA-Z_][a-zA-Z_0-9]*\$|^\$\$/)?.[0]; if (tag) { const end = sql.indexOf(tag, i + tag.length); i = end < 0 ? sql.length : end + tag.length; out += "'[redacted]'"; continue } }
    if (quote && /\d/.test(quote) && (i === 0 || !/[A-Za-z_0-9$]/.test(sql[i - 1]!))) { const number = sql.slice(i).match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0]; if (number) { out += '[redacted]'; i += number.length; continue } }
    out += sql[i]; i++
  }
  // Credenciais inválidas/não entre aspas ainda não devem aparecer no histórico.
  return redact(out.replace(/\b(PASSWORD|SECRET|TOKEN)\s+(?!'\[redacted\]')\S+/gi, '$1 [redacted]'), 200_000)
}
const historyDays = 30, historyMax = 200, historySqlMax = 20_000
const readOnlyCommands = new Set(['SELECT', 'WITH', 'EXPLAIN', 'SHOW', 'BEGIN', 'COMMIT', 'ROLLBACK'])
/**
 * SQL guardado no histórico. Consultas de leitura ficam completas, para poder reutilizar; o valor logo depois de PASSWORD, SECRET ou
 * TOKEN fica oculto. Qualquer outro comando (INSERT, UPDATE, DDL...) perde literais e comentários, porque carrega dados do banco;
 * um `WITH` com escrita dentro também.
 */
export function historySql(sql: string): string {
  const first = sql.trimStart().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? ''
  if (!readOnlyCommands.has(first) || /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(redactSql(sql))) return redactSql(sql).slice(0, historySqlMax)
  return redact(sql.replace(/\b(PASSWORD|SECRET|TOKEN)\s+(?:E?'(?:[^'\\]|\\.|'')*'[^\s;,)]*|\S+)/gi, '$1 [redacted]'), historySqlMax)
}
/** Só consultas SQL, as últimas `historyMax` e as dos últimos `historyDays` dias: o histórico vai "morrendo" sozinho. */
export function retainHistory(entries: QueryAudit[], now = Date.now()): QueryAudit[] {
  const cutoff = now - historyDays * 86_400_000
  return entries.filter((entry) => entry.kind === 'sql' && Date.parse(entry.at) >= cutoff).slice(-historyMax)
}
/** Histórico separado da auditoria: literais e comentários não são armazenados; resultados nunca vão ao disco. */
export class DbAudit {
  private readonly pending = new Map<string, Promise<void>>()
  constructor(private readonly database: AppDatabase, private readonly directory: string) {}
  private path(id: string): string { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(tm().db.invalidConnection); return join(this.directory, `${id}.jsonl`) }
  record(connectionId: string, kind: QueryAudit['kind'], sql: string, start: number, rows: number, status: QueryAudit['status']): void {
    const safeCommands = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'EXPLAIN', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SET', 'SHOW', 'GRANT', 'REVOKE', 'VACUUM', 'ANALYZE'])
    const first = sql.trimStart().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? ''
    const entry: QueryAudit = { id: randomUUID(), at: new Date().toISOString(), kind, sqlHash: createHash('sha256').update(sql).digest('hex'), durationMs: Date.now() - start, rows, status, summary: safeCommands.has(first) ? first : 'SQL', ...(kind === 'sql' ? { sql: historySql(sql) } : {}) }
    try { this.database.db.prepare('INSERT INTO db_query_audit(id,connection_id,at,kind,sql_hash,duration_ms,rows,status,history_ref) VALUES (?,?,?,?,?,?,?,?,NULL)').run(entry.id, connectionId, entry.at, kind, entry.sqlHash, entry.durationMs, rows, status) } catch { console.error('Não foi possível registrar a auditoria da consulta.'); return }
    if (kind !== 'sql') return
    const previous = this.pending.get(connectionId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(async () => {
      await mkdir(this.directory, { recursive: true })
      await appendFile(this.path(connectionId), `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 })
      this.database.db.prepare('UPDATE db_query_audit SET history_ref=? WHERE id=?').run(entry.id, entry.id)
    })
    this.pending.set(connectionId, next)
    void next.finally(() => { if (this.pending.get(connectionId) === next) this.pending.delete(connectionId) }).catch(() => console.error('Não foi possível registrar o histórico de consultas.'))
  }
  async list(id: string): Promise<QueryAudit[]> {
    const path = this.path(id)
    const previous = this.pending.get(id) ?? Promise.resolve()
    // Leitura, poda e regravação na mesma fila das gravações, para não perder uma consulta que chega no meio.
    const run = previous.catch(() => undefined).then(async () => {
      const content = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error })
      const entries = content.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as QueryAudit] } catch { return [] } })
      const kept = retainHistory(entries)
      if (kept.length < entries.length) await writeFile(path, kept.length ? `${kept.map((entry) => JSON.stringify(entry)).join('\n')}\n` : '', { encoding: 'utf8', mode: 0o600 })
      return kept.reverse()
    })
    const tail = run.then(() => undefined, () => undefined)
    this.pending.set(id, tail)
    void tail.finally(() => { if (this.pending.get(id) === tail) this.pending.delete(id) })
    return run
  }
  async clear(id: string): Promise<void> { await this.pending.get(id)?.catch(() => undefined); await rm(this.path(id), { force: true }) }
}
