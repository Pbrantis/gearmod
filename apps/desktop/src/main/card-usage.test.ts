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
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }

describe('card tokens', () => {
  it('sums the tokens of each run by step (planning, implementation and testing)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-usage-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects), conversations = new ConversationRepository(database)
    const profile = profiles.list()[0]!
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev', profileIds: [profile.id] })
    const card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[0]!.id, title: 'T', description: '', type: 'task', priority: 'low', acceptanceCriteria: [] })
    const run = (purpose: 'planning' | 'execution' | 'test', usage?: { input: number; cached: number; output: number }): void => {
      const chat = conversations.purposeChat(project.id, card.id, purpose, profile.id), started = conversations.createRun({ cardId: card.id, chatId: chat.id, profileId: profile.id })
      conversations.recordUsage(started.id, usage)
    }
    expect(conversations.cardUsage(card.id).execution).toEqual({ input: 0, cached: 0, output: 0, runs: 0 })
    run('planning', { input: 100, cached: 400, output: 50 })
    run('execution', { input: 1000, cached: 9000, output: 300 }); run('execution', { input: 500, cached: 1000, output: 100 })
    run('test', undefined)
    const usage = conversations.cardUsage(card.id)
    expect(usage.planning).toEqual({ input: 100, cached: 400, output: 50, runs: 1 })
    expect(usage.execution).toEqual({ input: 1500, cached: 10000, output: 400, runs: 2 })
    expect(usage.test).toEqual({ input: 0, cached: 0, output: 0, runs: 1 })
    expect(usage.agents.map((a) => [a.purpose, a.label, a.input, a.runs])).toEqual([['planning', profile.label, 100, 1], ['execution', profile.label, 1500, 2], ['test', profile.label, 0, 1]])
    database.close()
  })
})
