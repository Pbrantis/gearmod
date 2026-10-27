import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentContextService, loadSkillCatalog, loadSkillInstructions } from './agent-context'
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
    expect(block).toContain('agentboard-perguntas'); expect(service.freePrompt('Oi')).toContain('agentboard-perguntas')
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
  it('exposes only metadata in the discovery catalog', () => {
    const catalog = loadSkillCatalog(pluginDir, true)!
    expect(catalog).toContain('agentboard-discovery: Discovery de uma demanda')
    expect(catalog).toContain('agentboard-planejamento: Conduz o chat de planejamento')
    expect(catalog).not.toContain('# Discovery da demanda')
    expect(catalog).not.toContain('### Modelo (pt-BR)')
  })

  it('bundles the skills with the templates of the chosen language, falling back to pt-BR', () => {
    const ptBR = loadSkillInstructions(pluginDir, 'pt-BR', true)!
    expect(ptBR).toContain('## Skill agentboard-planejamento'); expect(ptBR).toContain('## Skill agentboard-tasks'); expect(ptBR).not.toContain('name: agentboard-tasks')
    expect(ptBR).toContain('### Modelo (pt-BR)')
    expect(loadSkillInstructions(pluginDir, 'en', true)).toContain('### Modelo (en)')
    const execution = loadSkillInstructions(pluginDir, 'pt-BR', false)!
    expect(execution).toContain('agentboard-resumo'); expect(execution).not.toContain('## Skill agentboard-planejamento')
    expect(loadSkillInstructions(join(pluginDir, 'nao-existe'), 'pt-BR', true)).toBeUndefined()
  })

  it('tarefa pequena manda só a descrição e cada etapa carrega só a sua skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-ctx-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects), settings = new SettingsRepository(database)
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' })
    const column = board.get(project.id).columns[1]!
    const big = board.create({ projectId: project.id, columnId: column.id, title: 'Grande', description: 'Algo grande', type: 'feature', priority: 'high', acceptanceCriteria: [] })
    const small = board.create({ projectId: project.id, columnId: column.id, title: 'Pequena', description: 'Trocar o texto do botão', type: 'minor', priority: 'low', acceptanceCriteria: [] })
    const service = new AgentContextService(board, settings, pluginDir)
    const block = service.block(small.id)
    expect(block).toContain('"tarefa": "pequena"'); expect(block).toContain('## O que fazer\nTrocar o texto do botão'); expect(block).not.toContain('### Plano'); expect(block).not.toContain('Documentos atuais')
    expect(service.block(big.id)).toContain('### Plano')
    expect(service.developerInstructions(false, null, big.id, 'execution')).toContain('## Skill agentboard-implementar')
    expect(service.developerInstructions(false, null, big.id, 'execution')).not.toContain('## Skill agentboard-testar')
    expect(service.developerInstructions(false, null, big.id, 'test')).toContain('## Skill agentboard-testar')
    expect(service.developerInstructions(false, null, small.id, 'execution')).toContain('## Skill agentboard-pequena')
    expect(service.developerInstructions(true)).not.toContain('## Skill agentboard-implementar')
    expect(service.freeInstructions(true)).not.toContain('## Skill agentboard-pequena')
    expect(service.freeInstructions(true)).toContain('catálogo para descoberta')
    expect(service.freeInstructions(true)).not.toContain('# Planejamento de card')
    expect(service.skillInstructions('agentboard-planejamento')).toContain('# Planejamento de card')
    expect(service.skillInstructions('skill-inexistente')).toBeUndefined()
    database.close()
  })

  it('planejador: tarefa pequena fica pronta só com a descrição', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-ctx-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects)
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' })
    const card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[0]!.id, title: 'Pequena', description: '', type: 'minor', priority: 'low', acceptanceCriteria: [] })
    expect(board.markPlanReady(card.id)).toEqual(['descricao']); expect(board.card(card.id).hasPlan).toBe(false)
    board.update({ cardId: card.id, type: 'minor', title: 'Pequena', description: 'Corrigir o typo', priority: 'low', acceptanceCriteria: [] })
    expect(board.markPlanReady(card.id)).toEqual([]); expect(board.card(card.id).hasPlan).toBe(true)
    database.close()
  })
})
