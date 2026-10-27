import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationRepository } from './conversations'
import { AppDatabase } from './database'
import { BoardRepository, ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('ConversationRepository', () => {
  it('persists chats, messages, runs and ordered sanitized events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-chat-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const projects = new ProjectRepository(database, { validate: async () => undefined, inspect: async (localPath: string) => ({ localPath, name: 'Repo', repositories: [{ localPath, name: 'Repo', currentBranch: 'dev', branches: ['dev'] }] }) })
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev', profileIds: profiles.list().map((item) => item.id) })
    const board = new BoardRepository(database, projects), column = board.get(project.id).columns[0]!
    const card = board.create({ projectId: project.id, columnId: column.id, title: 'Chat', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const repo = new ConversationRepository(database), profile = profiles.list()[0]!
    const chat = repo.createChat({ projectId: project.id, cardId: card.id, purpose: 'execution', profileId: profile.id })
    expect(repo.addMessage({ chatId: chat.id, role: 'user', body: 'Execute', status: 'complete' }).body).toBe('Execute')
    const run = repo.createRun({ cardId: card.id, chatId: chat.id, profileId: profile.id })
    expect(repo.appendEvent(run.id, 'started', { safe: true }).seq).toBe(0)
    expect(repo.appendEvent(run.id, 'delta', { text: 'ok' }).seq).toBe(1)
    expect(database.db.prepare('SELECT COUNT(*) AS value FROM run_events WHERE run_id = ?').get(run.id)).toEqual({ value: 2 })
    repo.savePlan(card.id, profile.id, 'Plano v1'); repo.savePlan(card.id, profile.id, 'Plano v2')
    expect(database.db.prepare('SELECT version, content_md FROM plans WHERE card_id = ? ORDER BY version').all(card.id)).toEqual([{ version: 1, content_md: 'Plano v1' }, { version: 2, content_md: 'Plano v2' }])
    const versions = repo.listPlans(card.id); expect(repo.approvePlan(versions[0]!.id).status).toBe('approved')
    expect(repo.reconcileInterrupted()).toBe(1)
    expect(database.db.prepare('SELECT status FROM runs WHERE id = ?').get(run.id)).toEqual({ status: 'interrupted' })
    database.close()
  })

  it('rejects a profile outside the project allowlist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-chat-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const projects = new ProjectRepository(database, { validate: async () => undefined, inspect: async (localPath: string) => ({ localPath, name: 'Repo', repositories: [{ localPath, name: 'Repo', currentBranch: 'dev', branches: ['dev'] }] }) })
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' }), all = profiles.list()
    projects.setProfiles(project.id, [all[0]!.id])
    expect(() => new ConversationRepository(database).createChat({ projectId: project.id, cardId: null, purpose: 'planning', profileId: all[1]!.id })).toThrow('não permitido')
    database.close()
  })

  it('deletes project chats but protects chats linked to cards', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-chat-delete-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const projects = new ProjectRepository(database, { validate: async () => undefined, inspect: async (localPath: string) => ({ localPath, name: 'Repo', repositories: [{ localPath, name: 'Repo', currentBranch: 'dev', branches: ['dev'] }] }) })
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev', profileIds: profiles.list().map((item) => item.id) })
    const board = new BoardRepository(database, projects), column = board.get(project.id).columns[0]!, profile = profiles.list()[0]!
    const card = board.create({ projectId: project.id, columnId: column.id, title: 'Protegido', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const repo = new ConversationRepository(database)
    const free = repo.createChat({ projectId: project.id, cardId: null, purpose: 'free', profileId: profile.id })
    const linked = repo.createChat({ projectId: project.id, cardId: card.id, purpose: 'planning', profileId: profile.id })
    repo.addMessage({ chatId: free.id, role: 'user', body: 'Pode apagar', status: 'complete' })

    repo.deleteChat(free.id)
    expect(repo.listChats(project.id).map((chat) => chat.id)).not.toContain(free.id)
    expect(() => repo.deleteChat(linked.id)).toThrow('vinculados a cards')
    expect(repo.listChats(project.id).map((chat) => chat.id)).toContain(linked.id)
    database.close()
  })
})
