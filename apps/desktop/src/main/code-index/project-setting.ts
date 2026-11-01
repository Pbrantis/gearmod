import type { AppDatabase } from '../database'

const key = (projectId: string): string => `codeIndex.disabled.${projectId}`

/**
 * Liga ou desliga o índice de código por projeto (ligado por padrão). Fica na tabela `settings`, uma chave por projeto
 * desligado, para não precisar de migração.
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
