import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChecklistRepository } from './checklists'
import { AppDatabase } from './database'
import { BoardRepository, ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'

const roots: string[] = [], opened: AppDatabase[] = []
afterEach(async () => { opened.splice(0).forEach((item) => item.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }

async function setup(): Promise<{ checklists: ChecklistRepository; cardId: string }> {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-checklist-')); roots.push(root)
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open(); opened.push(database)
  const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
  const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects)
  const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev', profileIds: [profiles.list()[0]!.id] })
  const card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[0]!.id, title: 'T', description: '', type: 'task', priority: 'low', acceptanceCriteria: [] })
  return { checklists: new ChecklistRepository(database), cardId: card.id }
}

describe('checklist do teste', () => {
  it('guarda quem marcou cada item: o agente ao gravar, o usuário ao clicar', async () => {
    const { checklists, cardId } = await setup()
    const first = checklists.write(cardId, '## Teste\n- [x] Lint passou\n- [ ] CA01 botão aparece\n  - [ ] sub item\n')
    expect(first.marks).toMatchObject({ 'lint passou': { by: 'agent' } })
    expect(first.marks['ca01 botão aparece']).toBeUndefined()
    const clicked = checklists.toggle(cardId, 2, 'CA01 botão aparece', true)
    expect(clicked.contentMd).toContain('- [x] CA01 botão aparece')
    expect(clicked.marks['ca01 botão aparece']).toMatchObject({ by: 'user' })
    expect(clicked.marks['lint passou']).toMatchObject({ by: 'agent' })
    const sub = checklists.toggle(cardId, 3, 'sub item', true)
    expect(sub.contentMd).toContain('  - [x] sub item'); expect(sub.marks['sub item']).toMatchObject({ by: 'user' })
  })
  it('reescrever o checklist inteiro não rouba a marca do usuário nem muda o que ficou igual', async () => {
    const { checklists, cardId } = await setup()
    checklists.write(cardId, '- [ ] A\n- [ ] B\n')
    checklists.toggle(cardId, 0, 'A', true)
    const again = checklists.write(cardId, '- [x] A\n- [x] B\n- [ ] C\n')
    expect(again.marks.a).toMatchObject({ by: 'user' }); expect(again.marks.b).toMatchObject({ by: 'agent' }); expect(again.marks.c).toBeUndefined()
    const undone = checklists.toggle(cardId, 1, 'B', false)
    expect(undone.marks.b).toMatchObject({ by: 'user' }); expect(undone.contentMd).toContain('- [ ] B')
  })
  it('o OK do agente continua registrado quando o usuário desmarca e marca de novo, e some só se o próprio agente desmarcar', async () => {
    const { checklists, cardId } = await setup()
    const first = checklists.write(cardId, '- [x] CA07 parcial\n- [ ] CA08\n')
    const agentAt = first.marks['ca07 parcial']!.at
    expect(first.marks['ca07 parcial']).toMatchObject({ by: 'agent', agent: agentAt })
    const unchecked = checklists.toggle(cardId, 0, 'CA07 parcial', false)
    expect(unchecked.marks['ca07 parcial']).toMatchObject({ by: 'user', agent: agentAt })
    const again = checklists.toggle(cardId, 0, 'CA07 parcial', true)
    expect(again.marks['ca07 parcial']).toMatchObject({ by: 'user', agent: agentAt })
    // an item only the user checked does not get the agent's OK
    expect(checklists.toggle(cardId, 1, 'CA08', true).marks.ca08?.agent).toBeUndefined()
    // if the agent rewrites the checklist leaving everything equal, nothing changes
    expect(checklists.write(cardId, '- [x] CA07 parcial\n- [x] CA08\n').marks['ca07 parcial']).toMatchObject({ by: 'user', agent: agentAt })
    // o agente desmarcar tira o OK dele
    expect(checklists.write(cardId, '- [ ] CA07 parcial\n- [x] CA08\n').marks['ca07 parcial']).toEqual(expect.objectContaining({ by: 'agent' }))
    expect(checklists.get(cardId).marks['ca07 parcial']!.agent).toBeUndefined()
  })
  it('recusa o clique quando o item daquela linha não é mais o mesmo', async () => {
    const { checklists, cardId } = await setup()
    checklists.write(cardId, '- [ ] A\n- [ ] B\n')
    expect(() => checklists.toggle(cardId, 1, 'A', true)).toThrow(/mudou/)
    expect(() => checklists.toggle(cardId, 9, 'A', true)).toThrow(/mudou/)
  })
})
