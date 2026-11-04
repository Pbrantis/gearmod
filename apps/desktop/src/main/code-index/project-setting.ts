import type { AppDatabase } from '../database'

const key = (projectId: string): string => `codeIndex.disabled.${projectId}`

/**
 * Turns the code index on or off per project (on by default). It lives in the `settings` table, one key per project
 * turned off, so no migration is needed.
 */
export class CodeIndexSettings {
  constructor(private readonly database: AppDatabase) {}

  enabled(projectId: string): boolean {
    return this.database.db.prepare('SELECT json_value FROM settings WHERE key = ?').pluck().get(key(projectId)) !== 'true'
  }

  setEnabled(projectId: string, enabled: boolean): void {
    if (enabled) this.database.db.prepare('DELETE FROM settings WHERE key = ?').run(key(projectId))
    else this.database.db.prepare(`INSERT INTO settings(key, json_value, updated_at) VALUES (?, 'true', ?)
      ON CONFLICT(key) DO UPDATE SET json_value = excluded.json_value, updated_at = excluded.updated_at`).run(key(projectId), new Date().toISOString())
  }
}
