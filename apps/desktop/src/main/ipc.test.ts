import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BackupService } from './backup'
import { AppDatabase } from './database'
import { registerIpc, type IpcMainLike } from './ipc'
import { NoteRepository } from './repository'
import { SettingsRepository } from './settings'

class FakeIpc implements IpcMainLike {
  handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
  handle(channel: string, listener: (event: unknown, input: unknown) => unknown): void { this.handlers.set(channel, listener) }
  removeHandler(channel: string): void { this.handlers.delete(channel) }
  async invoke(channel: string, input?: unknown): Promise<unknown> { return this.handlers.get(channel)?.({}, input) }
}

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('validated IPC', () => {
  it('accepts declared input and rejects extra or malformed fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-ipc-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const ipc = new FakeIpc()
    const notes = new NoteRepository(database)
    const unavailable = {} as never
    registerIpc(ipc, { database, notes, settings: new SettingsRepository(database), backups: new BackupService(root, '0.1.0'), profiles: unavailable, projects: unavailable, board: unavailable, git: unavailable, agentProbes: unavailable, conversations: unavailable, orchestrator: unavailable, worktrees: unavailable, quality: unavailable, executions: unavailable, agentConfigs: unavailable, chooseDirectory: async () => null, appVersion: '0.1.0', dataDir: root, reopen: async () => { await database.open() } })
    const created = await ipc.invoke('notes:create', { body: 'nota válida' }) as { body: string }
    expect(created.body).toBe('nota válida')
    await expect(ipc.invoke('notes:create', { body: '', unexpected: true })).rejects.toThrow()
    await expect(ipc.invoke('notes:delete', { id: '../../db.sqlite' })).rejects.toThrow()
    database.close()
  })
})
