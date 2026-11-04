import pg from 'pg'
import Cursor from 'pg-cursor'
import type { DbConnection } from './connections'
import { tm } from '../i18n'

export type DbActor = { type: 'user' } | { type: 'agent'; cardId: string }
export type DbQueryResult = { columns: string[]; rows: Array<Array<string | null>>; truncated: boolean; durationMs: number }
export type DbWriteResult = DbQueryResult & { commands: Array<{ command: string; rowCount: number | null }> }
const textTypes = { getTypeParser: (_oid: number, _format?: 'text' | 'binary') => (value: string): string => value }
// Preserves text and limits the retention of each free-SQL cell; one extra character signals truncation.
const boundedTextTypes = { getTypeParser: (_oid: number, _format?: 'text' | 'binary') => (value: string): string => value.length > 8201 ? value.slice(0, 8201) : value }
const connectionLost = (error: unknown): boolean => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  return code.startsWith('08') || ['57P01', '57P02', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(code)
}

/** V1a sessions do not accept an AI actor: the broker only arrives in B10. */
export class PgDriver {
  async open(config: DbConnection, password: string | null, actor: DbActor): Promise<PgSession> {
    if (actor.type !== 'user') throw new Error(tm().db.agentAccessUnavailable)
    const ssl = config.sslMode === 'disable' ? false : { rejectUnauthorized: config.sslMode === 'verify-full' }
    const opts = { host: config.host, port: config.port, database: config.database, user: config.user, password: password ?? undefined, ssl, application_name: 'GearMod', connectionTimeoutMillis: 10_000, statement_timeout: 15_000, lock_timeout: 3_000, idle_in_transaction_session_timeout: 10_000, types: textTypes, ...(!config.allowWrite ? { options: '-c default_transaction_read_only=on' } : {}) }
    const control = new pg.Client(opts), pool = new pg.Pool({ ...opts, max: 3, idleTimeoutMillis: 600_000 })
    const session = new PgSession(control, pool, config.allowWrite)
    control.on('error', () => session.markLost()); control.on('end', () => session.markLost()); pool.on('error', () => session.markLost())
    try { await control.connect(); return session } catch (error) { await pool.end().catch(() => undefined); await control.end().catch(() => undefined); throw error }
  }
}

/** Each read is a READ ONLY transaction ended before the response; a cursor limits memory. */
export class PgSession {
  private readonly requests = new Map<string, { processID: number; destroy(): void }>()
  private readonly pending = new Set<string>()
  private readonly cancelled = new Set<string>()
  private closed = false
  private lost = false
  private lostListener?: () => void
  constructor(private readonly control: pg.Client, private readonly pool: pg.Pool, private readonly allowWrite = false) {}
  get controlBackendPid(): number { return (this.control as pg.Client & { processID: number }).processID }
  onLost(callback: () => void): void { this.lostListener = callback; if (this.lost) callback() }
  markLost(): void { if (!this.closed && !this.lost) { this.lost = true; this.lostListener?.() } }
  async read(requestId: string, sql: string, values: unknown[] = [], rowLimit = 1000, truncateCells = false): Promise<DbQueryResult> {
    if (this.closed || this.lost) throw new Error(tm().db.connectionLostOrClosed)
    if (this.pending.has(requestId)) throw new Error(tm().db.queryIdInUse)
    if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 1000) throw new Error(tm().db.invalidRowLimit)
    this.pending.add(requestId)
    const started = Date.now()
    let client: pg.PoolClient
    try { client = await this.pool.connect() } catch (error) { this.pending.delete(requestId); this.cancelled.delete(requestId); throw error }
    if (this.closed || this.cancelled.delete(requestId)) { this.pending.delete(requestId); client.release(); throw new Error(tm().db.queryCancelledOrClosed) }
    let destroy = false
    this.requests.set(requestId, { processID: (client as typeof client & { processID: number }).processID, destroy: () => { if (!destroy) { destroy = true; client.release(true) } } })
    try {
      await client.query('BEGIN READ ONLY')
      await client.query("SET LOCAL statement_timeout = '15s'")
      const cursor = client.query(new Cursor(sql, values, { rowMode: 'array', types: truncateCells ? boundedTextTypes : textTypes }))
      const { rows, columns } = await new Promise<{ rows: Array<Array<string | null>>; columns: string[] }>((resolve, reject) => cursor.read(rowLimit + 1, (err, result, metadata) => err ? reject(err) : resolve({ rows: result as Array<Array<string | null>>, columns: metadata.fields.map((field) => field.name) })))
      await new Promise<void>((resolve, reject) => cursor.close((err) => err ? reject(err) : resolve()))
      return { columns, rows: rows.slice(0, rowLimit), truncated: rows.length > rowLimit, durationMs: Date.now() - started }
    } catch (error) { if (connectionLost(error)) this.markLost(); throw error } finally {
      this.requests.delete(requestId)
      this.pending.delete(requestId)
      if (!destroy) { try { await client.query('ROLLBACK') } catch { destroy = true }; client.release(destroy) }
    }
  }
  async cancel(requestId: string): Promise<void> {
    const request = this.requests.get(requestId)
    if (!request) { if (this.pending.has(requestId)) this.cancelled.add(requestId); return }
    const timer = setTimeout(() => { if (this.requests.get(requestId) === request) request.destroy() }, 3000)
    timer.unref()
    try { await this.control.query('SELECT pg_cancel_backend($1)', [request.processID]) } catch { clearTimeout(timer); request.destroy() }
  }
  /** User SQL in simple protocol, on a disposable client so it does not inherit SET/ROLE/transaction. */
  async write(requestId: string, sql: string, rowLimit = 1000): Promise<DbWriteResult> {
    if (!this.allowWrite) throw new Error(tm().db.writeDisabled)
    if (this.closed || this.lost || this.pending.has(requestId)) throw new Error(tm().db.connectionLostClosedOrBusy)
    if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 1000) throw new Error(tm().db.invalidRowLimit)
    this.pending.add(requestId)
    const started = Date.now()
    let client: pg.PoolClient
    try { client = await this.pool.connect() } catch (error) { this.pending.delete(requestId); this.cancelled.delete(requestId); throw error }
    if (this.closed || this.cancelled.delete(requestId)) { this.pending.delete(requestId); client.release(); throw new Error(tm().db.queryCancelledOrClosed) }
    let released = false
    const destroy = (): void => { if (!released) { released = true; client.release(true) } }
    this.requests.set(requestId, { processID: (client as typeof client & { processID: number }).processID, destroy })
    try {
      const query = new pg.Query({ text: sql, rowMode: 'array', types: boundedTextTypes } as pg.QueryConfig)
      let current: pg.QueryResult | undefined, rows: Array<Array<string | null>> = [], truncated = false
      query.on('row', (row: Array<string | null>, value) => {
        const result = value as pg.QueryResult | undefined
        if (current !== result) { current = result; rows = []; truncated = false }
        if (rows.length < rowLimit) rows.push(row.map((cell) => typeof cell === 'string' && cell.length > 8201 ? cell.slice(0, 8201) : cell))
        else truncated = true
      })
      const results = await new Promise<pg.QueryResult | pg.QueryResult[]>((resolve, reject) => {
        query.once('error', (error: Error) => {
          const partial = (query as unknown as { _results?: pg.QueryResult | pg.QueryResult[] })._results
          const completed = (Array.isArray(partial) ? partial : partial ? [partial] : []).map((item) => item.command).filter((command): command is string => typeof command === 'string' && /^[A-Z ]{1,40}$/.test(command))
          reject(Object.assign(error, { completedCommands: completed }))
        })
        query.once('end', resolve); client.query(query)
      })
      const all = Array.isArray(results) ? results : [results], last = all.at(-1)
      // Results of commands without rows must replace the previous result.
      if (last !== current) { rows = []; truncated = false }
      return { columns: last?.fields.map((field) => field.name) ?? [], rows, truncated, durationMs: Date.now() - started, commands: all.map((result) => ({ command: result.command ?? '', rowCount: result.rowCount })) }
    } catch (error) { if (connectionLost(error)) this.markLost(); throw error } finally { this.requests.delete(requestId); this.pending.delete(requestId); destroy() }
  }
  async close(): Promise<void> { this.closed = true; for (const request of this.requests.values()) request.destroy(); this.requests.clear(); await Promise.allSettled([this.pool.end(), this.control.end()]) }
}
