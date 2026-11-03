import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { migrations } from './migrations'
import { BoardRepository, ProjectRepository } from './projects'
import { countTasks, setTaskChecked, validateTasks } from './tasks'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }

const sample = `## Tasks

### Fase 1
- [x] T001 Criar tabela
  - [x] Migração roda
  - [ ] Teste passa
- [ ] T002 [P] Criar canal
  - [ ] Entrada validada
`

describe('tasks document', () => {
  it('counts only first-level items and toggles any checklist line', () => {
    expect(countTasks(sample)).toEqual({ done: 1, total: 2 })
    expect(countTasks('')).toEqual({ done: 0, total: 0 })
    const toggled = setTaskChecked(sample, 6, true)
    expect(countTasks(toggled)).toEqual({ done: 2, total: 2 })
    expect(toggled.split('\n')[5]).toBe('  - [ ] Teste passa')
    expect(() => setTaskChecked(sample, 0, true)).toThrow('checklist')
  })

  it('rejects documents without first-level tasks and keeps empty documents valid', () => {
    expect(validateTasks('')).toBeNull()
    expect(validateTasks(sample)).toBeNull()
    expect(validateTasks('Só texto')).toContain('T001')
    expect(validateTasks('  - [ ] só recuado')).toContain('primeiro nível')
  })
})

describe('DocumentRepository', () => {
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-docs-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects)
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' })
    const column = board.get(project.id).columns[1]!
    const card = board.create({ projectId: project.id, columnId: column.id, title: 'Doc', description: 'Resumo inicial', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    return { root, database, board, card, project }
  }

  it('stores four documents with versions and mirrors the summary into the card description', async () => {
    const { database, board, card } = await setup()
    expect(board.documents.get(card.id).resumo.contentMd).toBe('Resumo inicial')
    expect(board.card(card.id).hasPlan).toBe(false)
    board.documents.write(card.id, 'plano', '## Plano\nFazer')
    expect(board.card(card.id)).toMatchObject({ hasPlan: false, execProfileId: null })
    board.documents.write(card.id, 'especificacao', '## Especificação\nTexto', 'agent')
    expect(board.markPlanReady(card.id)).toEqual(['tasks'])
    board.documents.write(card.id, 'tasks', '- [ ] T001 Fazer')
    expect(board.markPlanReady(card.id)).toEqual([])
    expect(board.card(card.id).hasPlan).toBe(true)
    board.documents.write(card.id, 'resumo', 'Resumo novo')
    board.documents.write(card.id, 'resumo', 'Resumo novo')
    expect(board.card(card.id).description).toBe('Resumo novo')
    expect(board.documents.versions(card.id, 'resumo').map((v) => [v.version, v.actor])).toEqual([[2, 'user'], [1, 'user']])
    expect(board.documents.get(card.id).especificacao).toMatchObject({ updatedBy: 'agent', contentMd: '## Especificação\nTexto' })
    expect(board.documents.get(card.id).plano.contentMd).toBe('## Plano\nFazer')
    database.close()
  })

  it('counts tasks on the card, toggles from the checklist and rejects a malformed Tasks document', async () => {
    const { database, board, card } = await setup()
    board.documents.write(card.id, 'tasks', sample)
    expect(board.card(card.id).tasks).toEqual({ done: 1, total: 2 })
    board.documents.setTask(card.id, 6, true)
    expect(board.card(card.id).tasks).toEqual({ done: 2, total: 2 })
    expect(() => board.documents.write(card.id, 'tasks', 'sem itens')).toThrow('T001')
    expect(board.card(card.id).tasks).toEqual({ done: 2, total: 2 })
    database.close()
  })

  it('flags a card as planning open while it is only a started, still empty planning', async () => {
    const { database, board, project, card } = await setup()
    expect(board.card(card.id).planningOpen).toBe(false)
    const column = board.get(project.id).columns[1]!
    const blank = board.create({ projectId: project.id, columnId: column.id, title: '', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    expect(board.card(blank.id).planningOpen).toBe(true)
    board.documents.write(blank.id, 'especificacao', '## Especificação\nTexto')
    expect(board.card(blank.id).planningOpen).toBe(false)
    const named = board.create({ projectId: project.id, columnId: column.id, title: 'Com nome', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    expect(board.card(named.id).planningOpen).toBe(false)
    database.close()
  })

  it('creates the Tasks document from legacy criteria on create', async () => {
    const { database, board, project } = await setup()
    const column = board.get(project.id).columns[1]!
    const card = board.create({ projectId: project.id, columnId: column.id, title: 'Legado', description: '', type: 'task', priority: 'low', acceptanceCriteria: [{ body: 'A', checked: true }, { body: 'B', checked: false }] })
    expect(board.documents.read(card.id, 'tasks')).toBe('- [x] T001 A\n- [ ] T002 B')
    expect(board.card(card.id).tasks).toEqual({ done: 1, total: 2 })
    database.close()
  })

  it('migrates description, criteria and the latest plan into documents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-docs-mig-')); roots.push(root)
    const path = join(root, 'db.sqlite')
    const old = new AppDatabase(path, '0.1.0', migrations.slice(0, 6)); await old.open()
    const now = '2026-01-01T00:00:00.000Z'
    old.db.prepare(`INSERT INTO projects(id, name, local_path, base_branch, created_at, updated_at) VALUES ('50000000-0000-4000-8000-000000000001', 'P', ?, 'dev', ?, ?)`).run(root, now, now)
    old.db.prepare(`INSERT INTO board_columns(id, project_id, label, sort_order, semantic_state, is_default) VALUES ('50000000-0000-4000-8000-000000000010', '50000000-0000-4000-8000-000000000001', 'To do', 0, 'todo', 1)`).run()
    old.db.prepare(`INSERT INTO cards(id, project_id, column_id, type, title, description, priority, order_key, created_at, updated_at) VALUES ('50000000-0000-4000-8000-000000000020', '50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000010', 'task', 'Antigo', 'Descrição antiga', 'medium', 1, ?, ?)`).run(now, now)
    old.db.prepare(`INSERT INTO card_acceptance_criteria(id, card_id, body, checked, sort_order) VALUES ('50000000-0000-4000-8000-000000000030', '50000000-0000-4000-8000-000000000020', 'Critério um', 1, 0), ('50000000-0000-4000-8000-000000000031', '50000000-0000-4000-8000-000000000020', 'Critério dois', 0, 1)`).run()
    old.db.prepare(`INSERT INTO agent_profiles(id, provider, label, scope, config_dir, enabled, created_at, updated_at) VALUES ('50000000-0000-4000-8000-000000000040', 'codex', 'C', 'x', ?, 1, ?, ?)`).run(root, now, now)
    old.db.prepare(`INSERT INTO plans(id, card_id, version, agent_profile_id, content_md, status, created_at) VALUES ('50000000-0000-4000-8000-000000000050', '50000000-0000-4000-8000-000000000020', 1, '50000000-0000-4000-8000-000000000040', 'Plano antigo', 'approved', ?)`).run(now)
    old.close()
    const upgraded = new AppDatabase(path, '0.1.0'); await upgraded.open()
    const board = new BoardRepository(upgraded, new ProjectRepository(upgraded, git))
    const docs = board.documents.get('50000000-0000-4000-8000-000000000020')
    expect(docs.resumo.contentMd).toBe('Descrição antiga'); expect(docs.plano.contentMd).toBe('Plano antigo')
    expect(docs.tasks.contentMd).toBe('- [x] T001 Critério um\n- [ ] T002 Critério dois')
    expect(board.card('50000000-0000-4000-8000-000000000020').tasks).toEqual({ done: 1, total: 2 })
    expect(upgraded.db.prepare('SELECT COUNT(*) AS value FROM card_acceptance_criteria').get()).toEqual({ value: 2 })
    upgraded.close()
  })
})
