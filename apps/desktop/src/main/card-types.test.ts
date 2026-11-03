import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { builtinCardTypes, cardTypeListSchema, findCardType, ipcContracts } from '@gearmod/contracts'
import { AppDatabase } from './database'
import { migrations } from './migrations'
import { BoardRepository, ProjectRepository } from './projects'
import { SettingsRepository } from './settings'
import { cardTypeUsage, defaultCardTypes, setDefaultCardTypes } from './card-types'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-cardtypes-')); roots.push(root)
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
  const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects)
  const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' })
  return { root, database, projects, board, project, column: board.get(project.id).columns[0]! }
}

describe('tipos de card', () => {
  it('projeto novo usa a lista padrão de fábrica (Feature, Bug, Improvement)', async () => {
    const { database, project } = await setup()
    expect(project.customCardTypes).toBe(false)
    expect(project.cardTypes.map((item) => item.id)).toEqual(['feature', 'bug', 'improvement'])
    expect(project.cardTypes[2]!.name).toBe('Improvement')
    new SettingsRepository(database).update({ idioma: 'en' })
    expect(defaultCardTypes(database.db)[2]!.name).toBe('Improvement')
    database.close()
  })

  it('a lista padrão gravada vale para projetos sem lista própria; a do projeto vale só para ele', async () => {
    const { database, projects, project, root } = await setup()
    const other = await projects.create({ name: 'Q', localPath: join(root, 'q'), baseBranch: 'dev' })
    setDefaultCardTypes(database.db, [...builtinCardTypes(), { id: 'docs', name: 'Docs', color: '#aeb9ff' }])
    expect(projects.get(project.id).cardTypes.map((item) => item.id)).toContain('docs')
    const custom = projects.setCardTypes(other.id, [{ id: 'spike', name: 'Spike', color: '#e8c27a' }])
    expect(custom).toMatchObject({ customCardTypes: true, cardTypes: [{ id: 'spike', name: 'Spike', color: '#e8c27a' }] })
    expect(projects.get(project.id).cardTypes.map((item) => item.id)).not.toContain('spike')
    expect(projects.setCardTypes(other.id, null)).toMatchObject({ customCardTypes: false })
    expect(projects.get(other.id).cardTypes.map((item) => item.id)).toContain('docs')
    database.close()
  })

  it('recusa lista vazia, id inválido, id ou nome repetido e cor que não é hex', async () => {
    const { database, projects, project } = await setup()
    expect(() => projects.setCardTypes(project.id, [])).toThrow()
    expect(() => projects.setCardTypes(project.id, [{ id: 'Com Espaco', name: 'X', color: '#ffffff' }])).toThrow()
    expect(() => projects.setCardTypes(project.id, [{ id: 'a', name: 'A', color: '#ffffff' }, { id: 'a', name: 'B', color: '#ffffff' }])).toThrow()
    expect(() => projects.setCardTypes(project.id, [{ id: 'a', name: 'Igual', color: '#ffffff' }, { id: 'b', name: 'igual', color: '#ffffff' }])).toThrow()
    expect(cardTypeListSchema.safeParse([{ id: 'a', name: 'A', color: 'azul' }]).success).toBe(false)
    expect(ipcContracts['projects:set-card-types'].input.safeParse({ projectId: project.id, types: null }).success).toBe(true)
    database.close()
  })

  it('o tipo do card é texto livre de tamanho limitado; tipo que saiu da lista continua no card', async () => {
    const { database, projects, board, project, column } = await setup()
    const base = { projectId: project.id, columnId: column.id, title: 'T', description: '', priority: 'medium' as const, acceptanceCriteria: [] }
    expect(ipcContracts['cards:create'].input.safeParse({ ...base, type: 'qualquer-tipo' }).success).toBe(true)
    expect(ipcContracts['cards:create'].input.safeParse({ ...base, type: '' }).success).toBe(false)
    expect(ipcContracts['cards:create'].input.safeParse({ ...base, type: 'x'.repeat(41) }).success).toBe(false)
    const card = board.create({ ...base, type: 'bug' })
    projects.setCardTypes(project.id, [{ id: 'feature', name: 'Feature', color: '#8fb8d6' }])
    expect(board.card(card.id).type).toBe('bug')
    expect(cardTypeUsage(database.db, project.id)).toEqual({ bug: 1 })
    expect(cardTypeUsage(database.db)).toEqual({})
    database.close()
  })

  it('acha o tipo pelo id ou pelo nome, sem diferenciar maiúsculas', () => {
    const types = builtinCardTypes()
    expect(findCardType(types, 'improvement')?.id).toBe('improvement')
    expect(findCardType(types, 'melhoria')?.id).toBe('improvement')
    expect(findCardType(types, ' BUG ')?.id).toBe('bug')
    expect(findCardType(types, 'minor')).toBeUndefined()
  })

  it('migração: minor vira improvement com fluxo curto, task vira improvement e o fluxo já escolhido é mantido', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-cardtypes-mig-')); roots.push(root)
    const path = join(root, 'db.sqlite'), now = '2026-01-01T00:00:00.000Z'
    const old = new AppDatabase(path, '0.1.0', migrations.filter((item) => item.version < 42)); await old.open()
    old.db.prepare(`INSERT INTO projects(id, name, local_path, base_branch, created_at, updated_at) VALUES ('70000000-0000-4000-8000-000000000001', 'P', ?, 'dev', ?, ?)`).run(root, now, now)
    old.db.prepare(`INSERT INTO board_columns(id, project_id, label, sort_order, semantic_state, is_default) VALUES ('70000000-0000-4000-8000-000000000010', '70000000-0000-4000-8000-000000000001', 'To do', 0, 'todo', 1)`).run()
    const insert = old.db.prepare(`INSERT INTO cards(id, project_id, column_id, type, title, description, priority, order_key, created_at, updated_at, workflow) VALUES (?, '70000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000010', ?, ?, 'x', 'medium', 1, ?, ?, ?)`)
    insert.run('70000000-0000-4000-8000-000000000021', 'minor', 'Pequena', now, now, null)
    insert.run('70000000-0000-4000-8000-000000000022', 'minor', 'Pequena com spec', now, now, 'spec')
    insert.run('70000000-0000-4000-8000-000000000023', 'task', 'Tarefa', now, now, null)
    insert.run('70000000-0000-4000-8000-000000000024', 'bug', 'Bug', now, now, 'sdd')
    old.close()
    const upgraded = new AppDatabase(path, '0.1.0'); await upgraded.open()
    const board = new BoardRepository(upgraded, new ProjectRepository(upgraded, git))
    expect(board.card('70000000-0000-4000-8000-000000000021')).toMatchObject({ type: 'improvement', workflow: 'light', hasPlan: true })
    expect(board.card('70000000-0000-4000-8000-000000000022')).toMatchObject({ type: 'improvement', workflow: 'spec' })
    expect(board.card('70000000-0000-4000-8000-000000000023')).toMatchObject({ type: 'improvement', workflow: null })
    expect(board.card('70000000-0000-4000-8000-000000000024')).toMatchObject({ type: 'bug', workflow: 'sdd', sddMethod: null })
    expect(board.get('70000000-0000-4000-8000-000000000001').project).toMatchObject({ customCardTypes: false })
    upgraded.close()
  })
})
