import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../database'
import { SettingsRepository } from '../settings'
import { CodeIndexSettings } from './project-setting'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

describe('code index per project', () => {
  it('starts on, turns off and on without touching the app settings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gearmod-code-setting-')); dirs.push(dir)
    const database = new AppDatabase(join(dir, 'db.sqlite'), '0.1.0'); await database.open()
    try {
      const settings = new CodeIndexSettings(database), app = new SettingsRepository(database), before = app.get()
      expect(settings.enabled('a')).toBe(true)
      settings.setEnabled('a', false)
      settings.setEnabled('a', false)
      expect([settings.enabled('a'), settings.enabled('b')]).toEqual([false, true])
      settings.setEnabled('a', true)
      expect(settings.enabled('a')).toBe(true)
      expect(app.get()).toEqual(before)
    } finally { database.close() }
  })
})
