import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { migrations, latestSchemaVersion, type Migration } from './migrations'
import { tm } from './i18n'

export class SchemaTooNewError extends Error {}

export class AppDatabase {
  private connection?: Database.Database

  constructor(
    readonly path: string,
    private readonly appVersion: string,
    private readonly migrationSet: readonly Migration[] = migrations
  ) {}

  get db(): Database.Database {
    if (!this.connection) throw new Error('Database is not open')
    return this.connection
  }

  async open(beforeMigrate?: (db: Database.Database, from: number, to: number) => Promise<void>): Promise<{ previousVersion: number; currentVersion: number }> {
    mkdirSync(dirname(this.path), { recursive: true })
    this.connection = new Database(this.path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    const integrity = this.db.pragma('quick_check', { simple: true }) as string
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`)
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, app_version TEXT NOT NULL, checksum TEXT NOT NULL
    )`)
    const previousVersion = this.schemaVersion()
    const supported = this.migrationSet.at(-1)?.version ?? 0
    if (previousVersion > supported) {
      this.close()
      throw new SchemaTooNewError(`Database schema ${previousVersion} is newer than supported schema ${supported}`)
    }
    if (previousVersion > 0 && previousVersion < supported && beforeMigrate) {
      await beforeMigrate(this.db, previousVersion, supported)
    }
    this.applyPending(previousVersion)
    return { previousVersion, currentVersion: this.schemaVersion() }
  }

  schemaVersion(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number }
    return row.version
  }

  private applyPending(currentVersion: number): void {
    const pending = this.migrationSet.filter((item) => item.version > currentVersion)
    if (pending.length === 0) return
    const rebuilds = pending.some((item) => item.disableForeignKeys)
    if (rebuilds) this.db.pragma('foreign_keys = OFF')
    const migrate = this.db.transaction(() => {
      for (const migration of pending) {
        const existing = this.db.prepare('SELECT checksum FROM schema_migrations WHERE version = ?').get(migration.version) as { checksum: string } | undefined
        if (existing) {
          if (existing.checksum !== migration.checksum) throw new Error(`Migration checksum mismatch at version ${migration.version}`)
          continue
        }
        migration.up(this.db)
        this.db.prepare('INSERT INTO schema_migrations(version, applied_at, app_version, checksum) VALUES (?, ?, ?, ?)')
          .run(migration.version, new Date().toISOString(), this.appVersion, migration.checksum)
      }
      if (rebuilds) {
        const broken = this.db.pragma('foreign_key_check') as unknown[]
        if (broken.length) throw new Error(tm().database.migrationBrokeForeignKeys(broken.length))
      }
    })
    try { migrate() } finally { if (rebuilds) this.db.pragma('foreign_keys = ON') }
  }

  close(): void {
    if (this.connection?.open) this.connection.close()
    this.connection = undefined
  }

  get expectedSchemaVersion(): number { return this.migrationSet.at(-1)?.version ?? latestSchemaVersion }
}
