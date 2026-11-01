import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { ProfileRepository } from './projects'
import { SettingsRepository } from './settings'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function open(): Promise<{ root: string; database: AppDatabase }> {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-settings-')); roots.push(root)
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
  return { root, database }
}

describe('SettingsRepository', () => {
  it('defaults to green theme and pt-BR language', async () => {
    const { database } = await open()
    expect(new SettingsRepository(database).get()).toEqual({ tema: 'green', idioma: 'pt-BR', voz: 'small', notificacoes: true, retomarSozinho: true, fotosGravatar: false })
    database.close()
  })

  it('fotos do Gravatar começam desligadas e podem ser ligadas (S8)', async () => {
    const { database } = await open()
    const settings = new SettingsRepository(database)
    expect(settings.get().fotosGravatar).toBe(false)
    expect(settings.update({ fotosGravatar: true }).fotosGravatar).toBe(true)
    database.close()
  })

  it('persists app.tema and app.idioma in settings across a restart', async () => {
    const { root, database } = await open()
    const settings = new SettingsRepository(database)
    expect(settings.update({ tema: 'light-sky' })).toEqual({ tema: 'light-sky', idioma: 'pt-BR', voz: 'small', notificacoes: true, retomarSozinho: true, fotosGravatar: false })
    expect(settings.update({ idioma: 'en' })).toEqual({ tema: 'light-sky', idioma: 'en', voz: 'small', notificacoes: true, retomarSozinho: true, fotosGravatar: false })
    expect(database.db.prepare(`SELECT key, json_value FROM settings ORDER BY key`).all()).toMatchObject([{ key: 'app.idioma', json_value: '"en"' }, { key: 'app.tema', json_value: '"light-sky"' }])
    database.close()
    const reopened = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await reopened.open()
    expect(new SettingsRepository(reopened).get()).toEqual({ tema: 'light-sky', idioma: 'en', voz: 'small', notificacoes: true, retomarSozinho: true, fotosGravatar: false })
    reopened.close()
  })

  it('falls back to defaults when a stored value is invalid', async () => {
    const { database } = await open()
    database.db.prepare(`INSERT INTO settings(key, json_value, updated_at) VALUES ('app.tema', '"rosa"', 'x'), ('app.idioma', '{oops', 'x')`).run()
    expect(new SettingsRepository(database).get()).toEqual({ tema: 'green', idioma: 'pt-BR', voz: 'small', notificacoes: true, retomarSozinho: true, fotosGravatar: false })
    database.close()
  })
})

describe('agent color', () => {
  it('uses a provider default, accepts a custom color and keeps it on update', async () => {
    const { root, database } = await open()
    const profiles = new ProfileRepository(database, root)
    const claude = profiles.create({ provider: 'claude', label: 'Claude', scope: 'Pessoal' })
    const codex = profiles.create({ provider: 'codex', label: 'Codex', scope: 'Pessoal', color: '#9ccf6f' })
    expect(claude.color).toBe('#D97757'); expect(codex.color).toBe('#9ccf6f')
    expect(profiles.update({ profileId: codex.id, label: 'Codex 2', scope: 'Pessoal' }).color).toBe('#9ccf6f')
    expect(profiles.update({ profileId: codex.id, label: 'Codex 2', scope: 'Pessoal', color: '#e07a9a' }).color).toBe('#e07a9a')
    database.close()
  })

  it('migrates existing agents to their provider color', async () => {
    const { root, database } = await open()
    database.db.prepare(`INSERT INTO agent_profiles(id, provider, label, scope, config_dir, executable_path, enabled, created_at, updated_at)
      VALUES ('30000000-0000-4000-8000-000000000001', 'claude', 'Antigo', 'Pessoal', ?, NULL, 1, 'x', 'x')`).run(root)
    expect(new ProfileRepository(database, root).list()[0]?.color).toMatch(/^#[0-9a-fA-F]{6}$/)
    database.close()
  })
})
