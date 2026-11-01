import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AppDatabase } from '../database'
import { SecretStore, type SecureStorage } from '../secrets'
import { tm } from '../i18n'

export type DbClass = 'dev' | 'test' | 'prod' | 'external'
export type DbConnection = { id: string; projectId: string; name: string; klass: DbClass; host: string; port: number; database: string; user: string; sslMode: 'disable' | 'require' | 'verify-full'; hasSecret: boolean; allowWrite: boolean; agentAccess: 'none' | 'read'; origin: 'manual'; envId: null; parentId?: string | null }
export type DbConnectionInput = Omit<DbConnection, 'id' | 'hasSecret' | 'origin' | 'envId' | 'parentId'> & { parentId?: string | null; id?: string; password?: string; passwordStorage?: 'secure' | 'session'; confirmWrite?: string }
const loopback = (host: string): boolean => ['localhost', '127.0.0.1', '::1'].includes(host.toLowerCase())

/** Configuração por projeto; senha não é persistida no SQLite nem devolvida ao renderer. */
export class DbConnections {
  private readonly sessionPasswords = new Map<string, string>()
  constructor(private readonly database: AppDatabase, private readonly secretDir: string, private readonly storage: SecureStorage) {}
  private store(id: string): SecretStore { return new SecretStore(join(this.secretDir, `${id}.bin`), this.storage) }
  list(projectId: string): DbConnection[] {
    const rows = this.database.db.prepare(`SELECT id, project_id AS projectId, parent_id AS parentId, name, klass, host, port, database_name AS "database", username AS "user", ssl_mode AS sslMode, has_secret AS hasSecret, allow_write AS allowWrite, agent_access AS agentAccess, origin, env_id AS envId FROM db_connections WHERE project_id=? ORDER BY name COLLATE NOCASE`).all(projectId) as Array<Omit<DbConnection, 'hasSecret' | 'allowWrite'> & { hasSecret: number; allowWrite: number }>
    const roots = new Map(rows.filter((row) => !row.parentId).map((row) => [row.id, row]))
    // O banco herda do servidor tudo o que é da conexão (host, porta, usuário, SSL, ambiente e senha); só a escrita pode ser mais restrita.
    return rows.map((row) => {
      const parent = row.parentId ? roots.get(row.parentId) : undefined
      if (!parent) return { ...row, hasSecret: Boolean(row.hasSecret) || this.sessionPasswords.has(row.id), allowWrite: Boolean(row.allowWrite) }
      return { ...row, klass: parent.klass, host: parent.host, port: parent.port, user: parent.user, sslMode: parent.sslMode, hasSecret: Boolean(parent.hasSecret) || this.sessionPasswords.has(parent.id), allowWrite: Boolean(row.allowWrite) && Boolean(parent.allowWrite) }
    })
  }
  get(id: string): DbConnection {
    const projectId = this.database.db.prepare('SELECT project_id FROM db_connections WHERE id=?').pluck().get(id) as string | undefined
    const item = projectId && this.list(projectId).find((connection) => connection.id === id)
    if (!item) throw new Error(tm().db.connectionNotFound)
    return item
  }
  async password(id: string): Promise<string | null> { const item = this.get(id), owner = item.parentId ?? id; return this.sessionPasswords.get(owner) ?? (item.hasSecret ? this.store(owner).read() : null) }
  setSessionPassword(id: string, password: string): void { this.sessionPasswords.set(this.get(id).parentId ?? id, password) }
  /** Bancos do servidor, para encerrar as sessões deles quando o servidor muda ou some. */
  childIds(id: string): string[] { return this.database.db.prepare('SELECT id FROM db_connections WHERE parent_id=?').pluck().all(id) as string[] }
  /** Os campos de conexão de um banco vêm sempre do servidor. */
  inherit<T extends DbConnectionInput>(input: T): T {
    if (!input.parentId) return input
    const parent = this.get(input.parentId)
    if (parent.parentId) throw new Error(tm().db.databaseCannotBeServer)
    if (parent.projectId !== input.projectId) throw new Error(tm().db.serverNotInProject)
    return { ...input, klass: parent.klass, host: parent.host, port: parent.port, user: parent.user, sslMode: parent.sslMode }
  }
  async save(raw: DbConnectionInput): Promise<DbConnection> {
    const input = this.inherit(raw)
    if (!this.database.db.prepare('SELECT 1 FROM projects WHERE id=?').get(input.projectId)) throw new Error(tm().common.projectNotFound)
    if (!input.name.trim() || !input.host.trim() || !input.database.trim() || !input.user.trim() || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || !['dev','test','prod','external'].includes(input.klass) || !['disable','require','verify-full'].includes(input.sslMode) || !['none','read'].includes(input.agentAccess)) throw new Error(tm().db.invalidConnectionConfig)
    if (input.agentAccess === 'read' && (!loopback(input.host) || !['dev','test'].includes(input.klass))) throw new Error(tm().db.agentAccessNeedsLocalDev)
    const old = input.id ? this.get(input.id) : null
    if (old && old.projectId !== input.projectId) throw new Error(tm().db.connectionNotInProject)
    if (input.allowWrite && ['prod','external'].includes(input.klass) && (!old?.allowWrite || old.name !== input.name || old.klass !== input.klass || old.host !== input.host || old.port !== input.port || old.database !== input.database) && input.confirmWrite !== input.name) throw new Error(tm().db.confirmNameForWrite)
    if (old && (old.parentId ?? null) !== (input.parentId ?? null)) throw new Error(tm().db.cannotMoveDatabase)
    const id = old?.id ?? randomUUID(), secret = this.store(id), previousSession = this.sessionPasswords.get(id), previous = old?.hasSecret && previousSession === undefined ? await secret.read() : null
    let hasSecret = !input.parentId && Boolean(old?.hasSecret && !this.sessionPasswords.has(id))
    if (input.password !== undefined && !input.parentId) {
      if (input.passwordStorage === 'session') { this.sessionPasswords.set(id, input.password); await secret.write(null); hasSecret = false }
      else { await secret.write(input.password || null); this.sessionPasswords.delete(id); hasSecret = Boolean(input.password) }
    }
    const now = new Date().toISOString()
    try {
      this.database.db.prepare(`INSERT INTO db_connections(id,project_id,parent_id,name,klass,host,port,database_name,username,ssl_mode,has_secret,allow_write,agent_access,origin,env_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'manual',NULL,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,klass=excluded.klass,host=excluded.host,port=excluded.port,database_name=excluded.database_name,username=excluded.username,ssl_mode=excluded.ssl_mode,has_secret=excluded.has_secret,allow_write=excluded.allow_write,agent_access=excluded.agent_access,updated_at=excluded.updated_at`).run(id, input.projectId, input.parentId ?? null, input.name.trim(), input.klass, input.host.trim(), input.port, input.database.trim(), input.user.trim(), input.sslMode, Number(hasSecret), Number(input.allowWrite), input.agentAccess, now, now)
    } catch (error) { await secret.write(previous); if (previousSession === undefined) this.sessionPasswords.delete(id); else this.sessionPasswords.set(id, previousSession); throw error }
    return this.get(id)
  }
  async delete(id: string): Promise<void> { this.get(id); this.database.db.prepare('DELETE FROM db_connections WHERE parent_id=?').run(id); await this.store(id).write(null); this.sessionPasswords.delete(id); this.database.db.prepare('DELETE FROM db_connections WHERE id=?').run(id) }
}
