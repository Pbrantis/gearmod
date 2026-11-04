import { randomUUID } from 'node:crypto'
import type { DbAudit } from './audit'
import { buildChanges, buildTableQuery, type CatalogColumn, type CatalogTable, type ColumnKind, type TableChanges, type TableQuery } from './sql-builder'
import type { ConnectionManager } from './connection-manager'
import type { DbConnections, DbConnectionInput } from './connections'
import { PgDriver } from './pg-driver'
import { tm } from '../i18n'
import { destructiveStatements } from '@gearmod/contracts'

const integer = (value: string | null): number => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(tm().db.invalidCatalogId); return n }
const kindOf = (category: string, type: string, typeKind: string): ColumnKind => {
  if (type === 'bytea') return 'bytea'
  if (type === 'json' || type === 'jsonb') return 'json'
  if (type === 'uuid') return 'uuid'
  if (typeKind === 'e') return 'enum'
  if (category === 'A') return 'array'
  if (category === 'N') return 'number'
  if (category === 'D') return 'date'
  if (category === 'B') return 'boolean'
  if (category === 'S') return 'text'
  return 'other'
}
const requestId = (): string => randomUUID()

/** Navigation operations; all table and type names come from the active connection's catalog. */
export class DbService {
  private readonly pending = new Set<string>()
  private readonly cancelled = new Set<string>()
  constructor(private readonly connections: DbConnections, private readonly manager: ConnectionManager, private readonly auditStore?: DbAudit) {}
  private audit(id: string, kind: 'table-page' | 'sql' | 'count', sql: string, start: number, count: number, status: 'ok' | 'error'): void {
    this.auditStore?.record(id, kind, sql, start, count, status)
  }
  async history(id: string) { this.connections.get(id); return this.auditStore ? this.auditStore.list(id) : [] }
  async clearHistory(id: string): Promise<void> { this.connections.get(id); await this.auditStore?.clear(id) }
  list(projectId: string) { return this.connections.list(projectId) }
  private async closeWithChildren(id: string): Promise<void> { await Promise.all([id, ...this.connections.childIds(id)].map((item) => this.manager.close(item))) }
  async save(input: DbConnectionInput) { if (input.id) await this.closeWithChildren(input.id); return this.connections.save(input) }
  /** Server databases (without the template ones), to choose which to add to the tree. */
  async databases(id: string): Promise<string[]> {
    const session = await this.manager.open(id)
    const result = await session.read(requestId(), 'SELECT datname FROM pg_catalog.pg_database WHERE NOT datistemplate AND datallowconn ORDER BY datname')
    if (result.truncated) throw new Error(tm().db.tooManyDatabases)
    return result.rows.map(([name]) => name ?? '').filter(Boolean)
  }
  async testConnection(raw: DbConnectionInput): Promise<{ version?: string; pingMs: number }> {
    const input = this.connections.inherit(raw)
    if (input.id && this.connections.get(input.id).projectId !== input.projectId) throw new Error(tm().db.connectionNotInProject)
    const config = { id: input.id ?? randomUUID(), projectId: input.projectId, name: input.name, klass: input.klass, host: input.host, port: input.port, database: input.database, user: input.user, sslMode: input.sslMode, allowWrite: false, agentAccess: 'none' as const, origin: 'manual' as const, envId: null, hasSecret: Boolean(input.password) }
    const password = input.parentId ? await this.connections.password(input.parentId) : input.password ?? (input.id ? await this.connections.password(input.id) : null)
    const started = Date.now()
    try {
      const session = await new PgDriver().open(config, password, { type: 'user' }), pingMs = Date.now() - started
      const version = await session.read(requestId(), 'SELECT version()').then((result) => /^PostgreSQL\s+[\w.]+/.exec(result.rows[0]?.[0] ?? '')?.[0], () => undefined)
      await session.close(); return { version, pingMs }
    } catch { throw new Error(tm().db.cannotConnect) }
  }
  async delete(id: string): Promise<void> { await this.closeWithChildren(id); await this.connections.delete(id) }
  async connect(id: string): Promise<void> { await this.manager.open(id) }
  async sessionPassword(id: string, password: string): Promise<void> { await this.closeWithChildren(this.connections.get(id).parentId ?? id); this.connections.setSessionPassword(id, password) }
  state(id: string) { this.connections.get(id); return this.manager.state(id) }
  async disconnect(id: string): Promise<void> { await this.manager.close(id) }
  async cancel(id: string, request: string): Promise<void> { const key = `${id}:${request}`; if (this.pending.has(key)) this.cancelled.add(key); const pending = this.manager.active(id); if (pending) await (await pending).cancel(request) }
  /** With `all`, includes `information_schema` and `pg_catalog` (marked as `system`); internal-use ones (`pg_toast`, `pg_temp_*`) never enter. */
  async schemas(id: string, all = false): Promise<Array<{ oid: number; name: string; system?: boolean }>> {
    const session = await this.manager.open(id)
    const result = await session.read(requestId(), all
      ? `SELECT oid::text,nspname FROM pg_catalog.pg_namespace WHERE nspname NOT LIKE 'pg\\_toast%' ESCAPE E'\\\\' AND nspname NOT LIKE 'pg\\_temp\\_%' ESCAPE E'\\\\' ORDER BY nspname`
      : `SELECT oid::text,nspname FROM pg_catalog.pg_namespace WHERE nspname <> 'information_schema' AND nspname NOT LIKE 'pg\\_%' ESCAPE E'\\\\' ORDER BY nspname`)
    if (result.truncated) throw new Error(tm().db.tooManySchemas)
    return result.rows.map(([oid, name]) => ({ oid: integer(oid ?? null), name: name ?? '', ...(name === 'information_schema' || name?.startsWith('pg_') ? { system: true } : {}) }))
  }
  async tables(id: string, schemaOid: number): Promise<Array<{ oid: number; name: string; kind: string }>> {
    integer(String(schemaOid))
    const session = await this.manager.open(id)
    const result = await session.read(requestId(), `SELECT c.oid::text,c.relname,c.relkind::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.oid=$1::oid AND c.relkind IN ('r','p','v','m','S') ORDER BY c.relname`, [schemaOid])
    if (result.truncated) throw new Error(tm().db.tooManyTables)
    return result.rows.map(([oid, name, kind]) => ({ oid: integer(oid ?? null), name: name ?? '', kind: kind ?? '' }))
  }
  async describe(id: string, oid: number): Promise<CatalogTable> {
    integer(String(oid))
    const session = await this.manager.open(id)
    const result = await session.read(requestId(), `SELECT n.nspname,c.relname,c.relkind::text,a.attnum::text,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),t.typcategory::text,t.typname,t.typtype::text,EXISTS(SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid AND i.indisprimary AND a.attnum=ANY(i.indkey))::text,a.attnotnull::text,pg_catalog.col_description(c.oid,a.attnum),array_to_json(ARRAY(SELECT pg_catalog.pg_get_constraintdef(f.oid) FROM pg_catalog.pg_constraint f WHERE f.conrelid=c.oid AND f.contype='f' AND a.attnum=ANY(f.conkey)))::text,array_to_json(ARRAY(SELECT pg_catalog.pg_get_indexdef(i.indexrelid) FROM pg_catalog.pg_index i WHERE i.indrelid=c.oid AND a.attnum=ANY(i.indkey)))::text,c.reltuples::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped JOIN pg_catalog.pg_type t ON t.oid=a.atttypid WHERE c.oid=$1::oid AND c.relkind IN ('r','p','v','m') ORDER BY a.attnum`, [oid])
    if (result.truncated) throw new Error(tm().db.tooManyColumns)
    if (!result.rows.length) throw new Error(tm().db.tableNotFound)
    const [schema, name, relkind] = result.rows[0]!
    const columns: CatalogColumn[] = result.rows.map(([, , , attnum, columnName, typeSql, category, typeName, typeKind, pk, notNull, comment, foreignKeys, indexes]) => ({ attnum: integer(attnum ?? null), name: columnName ?? '', typeSql: typeSql ?? '', kind: kindOf(category ?? '', typeName ?? '', typeKind ?? ''), primaryKey: pk === 'true' || pk === 't', nullable: notNull !== 'true' && notNull !== 't', comment: comment ?? null, foreignKeys: JSON.parse(foreignKeys ?? '[]') as string[], indexes: JSON.parse(indexes ?? '[]') as string[] }))
    const estimate = Number(result.rows[0]?.[14])
    return { oid, schema: schema ?? '', name: name ?? '', ctidAvailable: relkind === 'r' || relkind === 'p' || relkind === 'm', estimatedTotal: Number.isFinite(estimate) && estimate >= 0 ? Math.round(estimate) : null, columns }
  }
  async page(id: string, request: TableQuery & { requestId: string }) {
    const key = `${id}:${request.requestId}`
    if (this.pending.has(key)) throw new Error(tm().db.queryIdInUse)
    this.pending.add(key)
    try {
      const table = await this.describe(id, request.oid), query = buildTableQuery(table, request)
      const session = await this.manager.open(id)
      if (this.cancelled.has(key)) throw new Error(tm().db.queryCancelled)
      const start = Date.now()
      try {
        const result = await session.read(request.requestId, query.text, query.values, request.limit)
        this.audit(id, 'table-page', query.text, start, result.rows.length, 'ok')
        return { columns: table.columns.map(({ attnum, name, typeSql }) => ({ attnum, name, type: typeSql })), rows: result.rows.map((row) => row.map((cell) => cell === null ? { t: null } : cell.length > 8200 ? { t: cell.slice(0, 8200), big: true as const } : { t: cell })), hasMore: result.truncated, orderedBy: query.orderedBy, durationMs: result.durationMs }
      } catch (error) { this.audit(id, 'table-page', query.text, start, 0, 'error'); throw error }
    } finally { this.pending.delete(key); this.cancelled.delete(key) }
  }
  /** Applies a table's pending changes in a single transaction (or only shows the SQL, with `dryRun`). If one command fails, none applies. */
  async apply(id: string, request: TableChanges & { requestId: string; oid: number; dryRun?: boolean }): Promise<{ sql: string[]; applied: boolean; counts: Array<{ command: string; rowCount: number | null }>; durationMs: number }> {
    const table = await this.describe(id, request.oid), sql = buildChanges(table, request)
    if (request.dryRun) return { sql, applied: false, counts: [], durationMs: 0 }
    const key = `${id}:${request.requestId}`
    if (this.pending.has(key)) throw new Error(tm().db.queryIdInUse)
    this.pending.add(key)
    const start = Date.now(), script = `BEGIN;\n${sql.join(';\n')};\nCOMMIT;`
    try {
      const session = await this.manager.open(id)
      if (this.cancelled.has(key)) throw new Error(tm().db.queryCancelled)
      const result = await session.write(request.requestId, script, 1)
      this.audit(id, 'sql', script, start, result.commands.reduce((sum, item) => sum + (item.rowCount ?? 0), 0), 'ok')
      return { sql, applied: true, counts: result.commands.filter((item) => item.command !== 'BEGIN' && item.command !== 'COMMIT'), durationMs: Date.now() - start }
    } catch (error) {
      this.audit(id, 'sql', script, start, 0, 'error')
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : null
      const messages = tm().db.writeErrors
      throw new Error(error instanceof Error && error.message === tm().db.writeDisabled ? error.message : tm().db.writeFailureSuffix(code && messages[code] ? messages[code] : tm().db.applyFailed, code ?? ''))
    } finally { this.pending.delete(key); this.cancelled.delete(key) }
  }
  async count(id: string, request: TableQuery & { requestId: string }): Promise<{ count: string; durationMs: number }> {
    const key = `${id}:${request.requestId}`
    if (this.pending.has(key)) throw new Error(tm().db.queryIdInUse)
    this.pending.add(key)
    try {
      const table = await this.describe(id, request.oid), query = buildTableQuery(table, request, 'count'), session = await this.manager.open(id)
      if (this.cancelled.has(key)) throw new Error(tm().db.queryCancelled)
      const start = Date.now()
      try { const result = await session.read(request.requestId, query.text, query.values, 1); this.audit(id, 'count', query.text, start, 1, 'ok'); return { count: result.rows[0]?.[0] ?? '0', durationMs: result.durationMs } }
      catch (error) { this.audit(id, 'count', query.text, start, 0, 'error'); throw error }
    } finally { this.pending.delete(key); this.cancelled.delete(key) }
  }
  /** With writing enabled, a destructive command only runs with the screen's confirmation: the database name, in any environment (any text is not enough). */
  private checkDestructive(config: { allowWrite: boolean; klass: string; database: string }, sql: string, confirmation: string | undefined): void {
    if (!config.allowWrite || !destructiveStatements(sql).length) return
    if (confirmation !== config.database) throw new Error(tm().db.destructiveNeedsConfirm)
  }
  async query(id: string, request: { requestId: string; sql: string; limit: number; confirmDestructive?: string }) {
    this.checkDestructive(this.connections.get(id), request.sql, request.confirmDestructive)
    const key = `${id}:${request.requestId}`
    if (this.pending.has(key)) throw new Error(tm().db.queryIdInUse)
    this.pending.add(key)
    const start = Date.now()
    try {
      const config = this.connections.get(id)
      const session = await this.manager.open(id)
      if (this.cancelled.has(key)) throw new Error(tm().db.queryCancelled)
      const result = config.allowWrite ? await session.write(request.requestId, request.sql, request.limit) : await session.read(request.requestId, request.sql, [], request.limit, true)
      this.audit(id, 'sql', request.sql, start, result.rows.length, 'ok')
      return { ...result, commands: 'commands' in result ? result.commands : [], rows: result.rows.map((row) => row.map((cell) => cell === null ? { t: null } : cell.length > 8200 ? { t: cell.slice(0, 8200), big: true as const } : { t: cell })) }
    } catch (error) {
      this.audit(id, 'sql', request.sql, start, 0, 'error')
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : null
      const position = typeof error === 'object' && error !== null && 'position' in error && typeof error.position === 'string' && /^\d+$/.test(error.position) ? tm().db.position(error.position) : ''
      const completed = typeof error === 'object' && error !== null && 'completedCommands' in error && Array.isArray(error.completedCommands) ? error.completedCommands.filter((item): item is string => typeof item === 'string' && /^[A-Z ]{1,40}$/.test(item)).slice(0, 20) : []
      const progress = completed.length ? tm().db.commandsBeforeFailure(completed.join(', ')) : ''
      const messages = tm().db.queryErrors
      throw new Error(code === '57014' ? tm().db.queryTimeout(progress) : `${code && messages[code] ? messages[code] : tm().db.queryFailed}${code ? ` (SQLSTATE ${code}${position})` : ''}.${progress}`)
    } finally { this.pending.delete(key); this.cancelled.delete(key) }
  }
}
