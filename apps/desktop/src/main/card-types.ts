import { builtinCardTypes, cardTypeListSchema, languageSchema, type CardTypeDef } from '@gearmod/contracts'
import type Database from 'better-sqlite3'

/** Key of the default list in `settings` (outside `app.%`, which is the Settings form). */
const defaultKey = 'cardTypes.default'

function parseList(raw: unknown): CardTypeDef[] | null {
  if (typeof raw !== 'string' || !raw) return null
  try { const parsed = cardTypeListSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null } catch { return null }
}

/** Default list: the one the user saved in Settings › General; without it, the factory one in the app language. */
export function defaultCardTypes(db: Database.Database): CardTypeDef[] {
  const stored = parseList(db.prepare('SELECT json_value FROM settings WHERE key = ?').pluck().get(defaultKey))
  if (stored) return stored
  let language: 'pt-BR' | 'en' = 'pt-BR'
  try { language = languageSchema.safeParse(JSON.parse(String(db.prepare("SELECT json_value FROM settings WHERE key = 'app.idioma'").pluck().get() ?? '""'))).data ?? 'pt-BR' } catch { /* default */ }
  return builtinCardTypes(language)
}

export function setDefaultCardTypes(db: Database.Database, types: CardTypeDef[]): CardTypeDef[] {
  const list = cardTypeListSchema.parse(types)
  db.prepare(`INSERT INTO settings(key, json_value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET json_value = excluded.json_value, updated_at = excluded.updated_at`).run(defaultKey, JSON.stringify(list), new Date().toISOString())
  return list
}

/** Project types: its own list (column `projects.card_types`) or, without it, the default. */
export function projectCardTypes(db: Database.Database, projectId: string): { types: CardTypeDef[]; custom: boolean } {
  const own = parseList(db.prepare('SELECT card_types FROM projects WHERE id = ?').pluck().get(projectId))
  return own ? { types: own, custom: true } : { types: defaultCardTypes(db), custom: false }
}

/** `null` returns the project to the default list. */
export function setProjectCardTypes(db: Database.Database, projectId: string, types: CardTypeDef[] | null): void {
  const value = types ? JSON.stringify(cardTypeListSchema.parse(types)) : null
  db.prepare('UPDATE projects SET card_types = ?, updated_at = ? WHERE id = ?').run(value, new Date().toISOString(), projectId)
}

/** Cards per type: in the project, or (without a project) across all projects that follow the default list. */
export function cardTypeUsage(db: Database.Database, projectId?: string): Record<string, number> {
  const rows = (projectId
    ? db.prepare('SELECT type, COUNT(*) AS n FROM cards WHERE project_id = ? GROUP BY type').all(projectId)
    : db.prepare('SELECT k.type, COUNT(*) AS n FROM cards k JOIN projects p ON p.id = k.project_id WHERE p.card_types IS NULL GROUP BY k.type').all()) as Array<{ type: string; n: number }>
  return Object.fromEntries(rows.map((row) => [row.type, row.n]))
}
