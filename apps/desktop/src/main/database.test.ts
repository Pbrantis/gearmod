import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BackupService } from './backup'
import { AppDatabase } from './database'
import type { Migration } from './migrations'
import { NoteRepository } from './repository'

const roots: string[] = []
async function tempRoot(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'agentboard-')); roots.push(root); return root }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('AppDatabase', () => {
  it('preserves records and ids across a restart', async () => {
    const root = await tempRoot()
    const path = join(root, 'agentboard.sqlite')
    const first = new AppDatabase(path, '0.1.0')
    await first.open()
    const created = new NoteRepository(first).create('sobrevive ao reinício')
    first.close()

    const second = new AppDatabase(path, '0.1.0')
    await second.open()
    expect(new NoteRepository(second).list()).toEqual([created])
    expect(second.schemaVersion()).toBe(7)
    second.close()
  })

  it('rolls back the complete migration batch when an upgrade fails', async () => {
    const root = await tempRoot()
    const path = join(root, 'agentboard.sqlite')
    const v1: Migration = { version: 1, checksum: 'v1', up: (db) => db.exec('CREATE TABLE durable(id TEXT PRIMARY KEY)') }
    const initial = new AppDatabase(path, '0.1.0', [v1])
    await initial.open()
    initial.db.prepare('INSERT INTO durable(id) VALUES (?)').run('same-id')
    initial.close()

    const broken: Migration = { version: 2, checksum: 'broken', up: (db) => { db.exec('ALTER TABLE durable ADD COLUMN label TEXT'); throw new Error('simulated failure') } }
    const upgrading = new AppDatabase(path, '0.2.0', [v1, broken])
    await expect(upgrading.open()).rejects.toThrow('simulated failure')
    expect(upgrading.schemaVersion()).toBe(1)
    expect(upgrading.db.prepare('PRAGMA table_info(durable)').all()).toHaveLength(1)
    expect(upgrading.db.prepare('SELECT id FROM durable').get()).toEqual({ id: 'same-id' })
    upgrading.close()
  })

  it('runs the pre-upgrade hook before applying a new schema', async () => {
    const root = await tempRoot()
    const path = join(root, 'agentboard.sqlite')
    const v1: Migration = { version: 1, checksum: 'v1', up: (db) => db.exec('CREATE TABLE item(id TEXT PRIMARY KEY)') }
    const v2: Migration = { version: 2, checksum: 'v2', up: (db) => db.exec('ALTER TABLE item ADD COLUMN title TEXT') }
    const first = new AppDatabase(path, '0.1.0', [v1]); await first.open(); first.close()
    const seen: number[] = []
    const second = new AppDatabase(path, '0.2.0', [v1, v2])
    await second.open(async (_db, from, to) => { seen.push(from, to) })
    expect(seen).toEqual([1, 2])
    second.close()
  })
})

describe('BackupService', () => {
  it('backs up a WAL database plus attachments and restores verified content', async () => {
    const root = await tempRoot()
    const path = join(root, 'agentboard.sqlite')
    const database = new AppDatabase(path, '0.1.0'); await database.open()
    const notes = new NoteRepository(database)
    const original = notes.create('valor original')
    const backups = new BackupService(root, '0.1.0')
    await mkdir(join(root, 'attachments'), { recursive: true })
    await writeFile(join(root, 'attachments', 'proof.txt'), 'attachment-data')
    const backup = await backups.create(database.db, 'test')
    notes.create('valor posterior')
    await writeFile(join(root, 'attachments', 'proof.txt'), 'changed')
    database.close()

    await backups.restore(backup.id, path)
    const restored = new AppDatabase(path, '0.1.0'); await restored.open()
    expect(new NoteRepository(restored).list()).toEqual([original])
    expect(await readFile(join(root, 'attachments', 'proof.txt'), 'utf8')).toBe('attachment-data')
    restored.close()
  })

  it('rejects a database whose backup checksum was changed', async () => {
    const root = await tempRoot(); const path = join(root, 'agentboard.sqlite')
    const database = new AppDatabase(path, '0.1.0'); await database.open()
    const backups = new BackupService(root, '0.1.0'); const backup = await backups.create(database.db, 'test'); database.close()
    await writeFile(join(root, 'backups', backup.id, 'agentboard.sqlite'), 'tampered')
    await expect(backups.restore(backup.id, path)).rejects.toThrow('checksum')
  })
})
