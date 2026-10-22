import { appSettingsSchema, type AppSettings } from '@agentboard/contracts'
import type { AppDatabase } from './database'

const defaults: AppSettings = { tema: 'green', idioma: 'pt-BR', voz: 'small', notificacoes: true }
const keyOf = (name: keyof AppSettings): string => `app.${name}`

/** Configurações do app em `settings` (chave `app.<nome>`, valor JSON). Valores inválidos voltam ao padrão. */
export class SettingsRepository {
  constructor(private readonly database: AppDatabase) {}

  get(): AppSettings {
    const rows = this.database.db.prepare(`SELECT key, json_value AS value FROM settings WHERE key LIKE 'app.%'`).all() as Array<{ key: string; value: string }>
    const stored: Record<string, unknown> = {}
    for (const row of rows) {
      try { stored[row.key.slice(4)] = JSON.parse(row.value) } catch { /* valor corrompido: usa o padrão */ }
    }
    const parsed = appSettingsSchema.safeParse({ ...defaults, ...stored })
    if (parsed.success) return parsed.data
    return { tema: appSettingsSchema.shape.tema.safeParse(stored.tema).data ?? defaults.tema, idioma: appSettingsSchema.shape.idioma.safeParse(stored.idioma).data ?? defaults.idioma, voz: appSettingsSchema.shape.voz.safeParse(stored.voz).data ?? defaults.voz, notificacoes: appSettingsSchema.shape.notificacoes.safeParse(stored.notificacoes).data ?? defaults.notificacoes }
  }

  update(input: Partial<AppSettings>): AppSettings {
    const now = new Date().toISOString()
    const upsert = this.database.db.prepare(`INSERT INTO settings(key, json_value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET json_value = excluded.json_value, updated_at = excluded.updated_at`)
    this.database.db.transaction(() => {
      for (const name of ['tema', 'idioma', 'voz', 'notificacoes'] as const) if (input[name] !== undefined) upsert.run(keyOf(name), JSON.stringify(input[name]), now)
    })()
    return this.get()
  }
}
