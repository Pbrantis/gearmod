import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { BoardRepository, ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-projects-')); roots.push(root)
  const database = new AppDatabase(join(root, 'data.sqlite'), '0.1.0'); await database.open()
  const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
  const git = {
    validate: async () => undefined,
    branches: async () => ['dev', 'main'],
    inspect: async (localPath: string) => ({ localPath, name: localPath.split(/[\\/]/).at(-1) || 'project', repositories: [{ localPath, name: 'repo', currentBranch: 'dev', branches: ['dev', 'main'] }] })
  }
  const projects = new ProjectRepository(database, git)
  const board = new BoardRepository(database, projects)
  return { root, database, profiles, projects, board }
}

describe('project board', () => {
  it('creates a project with five stable semantic columns and available profiles', async () => {
    const { root, database, profiles, projects, board } = await setup()
    const project = await projects.create({ name: 'Produto', localPath: root, baseBranch: 'dev', profileIds: profiles.list().map((item) => item.id) })
    const state = board.get(project.id)
    expect(state.columns.map((column) => column.semanticState)).toEqual(['todo', 'doing', 'test', 'mr', 'done'])
    expect(project.allowedProfileIds).toHaveLength(2)
    expect(profiles.list()).toHaveLength(2)
    database.close()
  })

  it('persists card fields, criteria, ordering, transitions and archive state', async () => {
    const { root, database, projects, board } = await setup()
    const project = await projects.create({ name: 'Produto', localPath: root, baseBranch: 'dev' })
    const state = board.get(project.id), todo = state.columns[0]!, doing = state.columns[1]!
    const card = board.create({ projectId: project.id, columnId: todo.id, title: 'Fluxo real', description: 'Persistir tudo', type: 'feature', priority: 'high', acceptanceCriteria: [{ body: 'Reabre igual', checked: false }] })
    expect(card.acceptanceCriteria[0]?.body).toBe('Reabre igual')
    expect(board.move(card.id, doing.id, null).columnId).toBe(doing.id)
    expect(database.db.prepare('SELECT COUNT(*) AS value FROM column_history WHERE card_id = ?').get(card.id)).toEqual({ value: 1 })
    expect(board.archive(card.id).archivedAt).not.toBeNull()
    database.close()

    const reopened = new AppDatabase(join(root, 'data.sqlite'), '0.1.0'); await reopened.open()
    const git = {
      validate: async () => undefined,
      branches: async () => ['dev'],
      inspect: async (localPath: string) => ({ localPath, name: 'project', repositories: [{ localPath, name: 'repo', currentBranch: 'dev', branches: ['dev'] }] })
    }
    const reopenedProjects = new ProjectRepository(reopened, git)
    const restored = new BoardRepository(reopened, reopenedProjects).card(card.id)
    expect(restored.title).toBe('Fluxo real'); expect(restored.columnId).toBe(doing.id); expect(restored.archivedAt).not.toBeNull()
    reopened.close()
  })

  it('enforces project profile allowlists and column ownership', async () => {
    const { root, database, profiles, projects, board } = await setup()
    const first = await projects.create({ name: 'A', localPath: `${root}-a`, baseBranch: 'dev' })
    const second = await projects.create({ name: 'B', localPath: `${root}-b`, baseBranch: 'dev' })
    const oneProfile = profiles.list()[0]!
    expect(projects.setProfiles(first.id, [oneProfile.id]).allowedProfileIds).toEqual([oneProfile.id])
    expect(() => projects.setProfiles(first.id, ['20000000-0000-4000-8000-000000000099'])).toThrow('Perfil desconhecido')
    expect(() => board.create({ projectId: first.id, columnId: board.get(second.id).columns[0]!.id, title: 'Inválido', description: '', type: 'task', priority: 'low', acceptanceCriteria: [] })).toThrow('não pertence')
    database.close()
  })

  it('uses the repository folder name and current branch when they are omitted', async () => {
    const { root, database, projects } = await setup()
    const project = await projects.create({ localPath: root })
    expect(project.name).toBe(root.split(/[\\/]/).at(-1))
    expect(project.baseBranch).toBe('dev')
    database.close()
  })
})
