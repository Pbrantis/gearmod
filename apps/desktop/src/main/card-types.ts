import { builtinCardTypes, cardTypeListSchema, languageSchema, type CardTypeDef } from '@gearmod/contracts'
import type Database from 'better-sqlite3'

/** Chave da lista padrão em `settings` (fora de `app.%`, que é o formulário de Configurações). */
const defaultKey = 'cardTypes.default'

function parseList(raw: unknown): CardTypeDef[] | null {
  if (typeof raw !== 'string' || !raw) return null
  try { const parsed = cardTypeListSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null } catch { return null }
}

/** Lista padrão: a que o usuário gravou em Configurações › Geral; sem isso, a de fábrica no idioma do app. */
export function defaultCardTypes(db: Database.Database): CardTypeDef[] {
  const stored = parseList(db.prepare('SELECT json_value FROM settings WHERE key = ?').pluck().get(defaultKey))
  if (stored) return stored
  let language: 'pt-BR' | 'en' = 'pt-BR'
  try { language = languageSchema.safeParse(JSON.parse(String(db.prepare("SELECT json_value FROM settings WHERE key = 'app.idioma'").pluck().get() ?? '""'))).data ?? 'pt-BR' } catch { /* padrão */ }
  return builtinCardTypes(language)
}

export function setDefaultCardTypes(db: Database.Database, types: CardTypeDef[]): CardTypeDef[] {
  const list = cardTypeListSchema.parse(types)
  db.prepare(`INSERT INTO settings(key, json_value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET json_value = excluded.json_value, updated_at = excluded.updated_at`).run(defaultKey, JSON.stringify(list), new Date().toISOString())
  return list
}

/** Tipos do projeto: a lista própria (coluna `projects.card_types`) ou, sem ela, a padrão. */
export function projectCardTypes(db: Database.Database, projectId: string): { types: CardTypeDef[]; custom: boolean } {
  const own = parseList(db.prepare('SELECT card_types FROM projects WHERE id = ?').pluck().get(projectId))
  return own ? { types: own, custom: true } : { types: defaultCardTypes(db), custom: false }
}

/** `null` volta o projeto para a lista padrão. */
export function setProjectCardTypes(db: Database.Database, projectId: string, types: CardTypeDef[] | null): void {
  const value = types ? JSON.stringify(cardTypeListSchema.parse(types)) : null
  db.prepare('UPDATE projects SET card_types = ?, updated_at = ? WHERE id = ?').run(value, new Date().toISOString(), projectId)
}

/** Cards por tipo: no projeto, ou (sem projeto) em todos os projetos que seguem a lista padrão. */
export function cardTypeUsage(db: Database.Database, projectId?: string): Record<string, number> {
  const rows = (projectId
    ? db.prepare('SELECT type, COUNT(*) AS n FROM cards WHERE project_id = ? GROUP BY type').all(projectId)
    : db.prepare('SELECT k.type, COUNT(*) AS n FROM cards k JOIN projects p ON p.id = k.project_id WHERE p.card_types IS NULL GROUP BY k.type').all()) as Array<{ type: string; n: number }>
  return Object.fromEntries(rows.map((row) => [row.type, row.n]))
}
