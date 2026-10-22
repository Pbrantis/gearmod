import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentContextService, loadSkillInstructions } from './agent-context'
import { AppDatabase } from './database'
import { BoardRepository, ProjectRepository } from './projects'
import { SettingsRepository } from './settings'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const pluginDir = join(__dirname, '..', '..', 'resources', 'agentboard-plugin')
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }

describe('AgentContextService', () => {
  it('describes language, card, current column, available columns and documents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-ctx-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects), settings = new SettingsRepository(database)
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' })
    const column = board.get(project.id).columns[1]!
    const card = board.create({ projectId: project.id, columnId: column.id, title: 'Contexto', description: 'Resumo do card', type: 'feature', priority: 'high', acceptanceCriteria: [] })
    const service = new AgentContextService(board, settings, pluginDir)
    const block = service.block(card.id)
    expect(block).toContain('"idioma": "pt-BR"'); expect(block).toContain('"titulo": "Contexto"'); expect(block).toContain('"nome": "To do"')
    expect(block).toContain('"nome": "Done"'); expect(block).toContain('Resumo do card'); expect(block).toContain('### Tasks\n(vazio)'); expect(block).toContain('só move o card se o usuário pedir')
    expect(service.prompt(card.id, 'Planeje', true)).toContain('Use a skill agentboard-planejamento')
    expect(service.prompt(card.id, 'Execute', false)).not.toContain('agentboard-planejamento')
    const skillDir = join(root, 'minha-skill'); await mkdir(skillDir, { recursive: true }); await writeFile(join(skillDir, 'SKILL.md'), '---\nname: minha-skill\ndescription: x\n---\nPasso a passo da skill escolhida')
    expect(service.prompt(card.id, 'Planeje', true, { name: 'minha-skill', path: skillDir })).toContain('Use a skill minha-skill')
    expect(service.developerInstructions(true, { name: 'minha-skill', path: skillDir })).toContain('Passo a passo da skill escolhida')
    expect(service.developerInstructions(false, { name: 'minha-skill', path: skillDir })).not.toContain('Passo a passo da skill escolhida')
    const untitled = board.create({ projectId: project.id, columnId: column.id, title: '', description: '', type: 'task', priority: 'low', acceptanceCriteria: [] })
    expect(service.prompt(untitled.id, 'Planeje', true)).toContain('agentboard_atualizar_card')
    expect(service.prompt(untitled.id, 'Execute', false)).not.toContain('agentboard_atualizar_card')
    expect(service.prompt(card.id, 'Planeje', true)).not.toContain('agentboard_atualizar_card')
    settings.update({ idioma: 'en' })
    expect(service.block(card.id)).toContain('"idioma": "en"')
    database.close()
  })
})

describe('loadSkillInstructions', () => {
  it('bundles the skills with the templates of the chosen language, falling back to pt-BR', () => {
    const ptBR = loadSkillInstructions(pluginDir, 'pt-BR', true)!
    expect(ptBR).toContain('## Skill agentboard-planejamento'); expect(ptBR).toContain('## Skill agentboard-tasks'); expect(ptBR).not.toContain('name: agentboard-tasks')
    expect(ptBR).toContain('### Modelo (pt-BR)')
    expect(loadSkillInstructions(pluginDir, 'en', true)).toContain('### Modelo (en)')
    const execution = loadSkillInstructions(pluginDir, 'pt-BR', false)!
    expect(execution).toContain('agentboard-resumo'); expect(execution).not.toContain('## Skill agentboard-planejamento')
    expect(loadSkillInstructions(join(pluginDir, 'nao-existe'), 'pt-BR', true)).toBeUndefined()
  })
})
