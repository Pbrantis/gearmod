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
  it('oferece documentar alterações no chat livre sem repetir escolhas já feitas', async () => {
    const service = new AgentContextService({} as never, { get: () => ({ idioma: 'pt-BR' }) } as never, null)
    for (const text of [await service.freePrompt('Ajuste a tela', undefined, true), service.freeInstructions(false, true), service.freeInstructions(true, false)]) {
      expect(text).toContain('Create card')
      expect(text).toContain('Change directly')
      expect(text).toContain('do not repeat the question')
      expect(text).toContain('agentboard-perguntas')
    }
  })
  it('describes language, card, current column, available columns and documents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-ctx-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects), settings = new SettingsRepository(database)
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' })
    const column = board.get(project.id).columns[1]!
    const card = board.create({ projectId: project.id, columnId: column.id, title: 'Contexto', description: 'Resumo do card', type: 'feature', priority: 'high', acceptanceCriteria: [] })
    const service = new AgentContextService(board, settings, pluginDir)
    const block = await service.block(card.id)
    expect(block).toContain('"idioma": "pt-BR"'); expect(block).toContain('"titulo": "Contexto"'); expect(block).toContain('"nome": "To do"')
    expect(block).toContain('"nome": "Done"'); expect(block).toContain('Resumo do card'); expect(block).toContain('### Tasks\n(empty)'); expect(block).toContain('only move the card if the user asks')
    expect(block).toContain('agentboard-perguntas'); expect(await service.freePrompt('Oi')).toContain('agentboard-perguntas')
    expect(await service.prompt(card.id, 'Planeje', true)).toContain('Use the agentboard-planejamento skill')
    expect(await service.prompt(card.id, 'Execute', false)).not.toContain('agentboard-planejamento')
    const skillDir = join(root, 'minha-skill'); await mkdir(skillDir, { recursive: true }); await writeFile(join(skillDir, 'SKILL.md'), '---\nname: minha-skill\ndescription: x\n---\nPasso a passo da skill escolhida')
    expect(await service.prompt(card.id, 'Planeje', true, { name: 'minha-skill', path: skillDir })).toContain('Use the minha-skill skill')
    expect(service.developerInstructions(true, { name: 'minha-skill', path: skillDir })).toContain('Passo a passo da skill escolhida')
    expect(service.developerInstructions(false, { name: 'minha-skill', path: skillDir })).toContain('Passo a passo da skill escolhida') // a skill escolhida acompanha também a execução
    const untitled = board.create({ projectId: project.id, columnId: column.id, title: '', description: '', type: 'task', priority: 'low', acceptanceCriteria: [] })
    expect(await service.prompt(untitled.id, 'Planeje', true)).toContain('agentboard_atualizar_card')
    expect(await service.prompt(untitled.id, 'Execute', false)).not.toContain('agentboard_atualizar_card')
    expect(await service.prompt(card.id, 'Planeje', true)).not.toContain('agentboard_atualizar_card')
    settings.update({ idioma: 'en' })
    expect(await service.block(card.id)).toContain('"idioma": "en"')
    database.close()
  })

  it('G06/B1: lê a Constituição pelo resolver (cache por blob sha) e, sem arquivo, diz que não há Constituição (nunca lê o SQLite)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-ctx-g06-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects), settings = new SettingsRepository(database)
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' })
    const card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[0]!.id, title: 'Card', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    let calls = 0
    const sddResolver = { constitution: async () => { calls += 1; return { path: 'constitution.md', content: '# Constituição do SDD', blobSha: 'sha-1', baseBlobSha: 'sha-1', headBlobSha: 'sha-1', state: 'in-sync' as const, method: 'native' as const, via: 'ref' as const } } }
    const withFile = new AgentContextService(board, settings, null, undefined, undefined, undefined, undefined, sddResolver)
    const first = await withFile.block(card.id); const second = await withFile.block(card.id)
    expect(first).toContain('Constituição do SDD'); expect(second).toContain('Constituição do SDD')
    expect(calls).toBe(2) // chama o resolver a cada turno; o cache evita recalcular o índice, não a leitura em si
    const legacyConstitution = { get: () => ({ projectId: project.id, contentMd: 'Legado no SQLite', version: 1, updatedAt: null, updatedBy: null }), proposals: () => [] }
    const noFileYet = { constitution: async () => ({ path: 'constitution.md', content: null, blobSha: null, baseBlobSha: null, headBlobSha: null, state: 'missing' as const, method: 'native' as const, via: 'ref' as const }) }
    const withFallback = new AgentContextService(board, settings, null, legacyConstitution, undefined, undefined, undefined, noFileYet)
    const fallbackBlock = await withFallback.block(card.id)
    expect(fallbackBlock).not.toContain('Legado no SQLite'); expect(fallbackBlock).toContain('no Constitution yet')
    database.close()
  })
})

describe('loadSkillInstructions', () => {
  it('exposes only metadata in the discovery catalog', () => {
    const catalog = loadSkillCatalog(pluginDir, true)!
    expect(catalog).toContain('agentboard-discovery: Discovery of a request')
    expect(catalog).toContain('agentboard-planejamento: Runs the planning chat')
    expect(catalog).not.toContain('# Discovery da demanda')
    expect(catalog).not.toContain('### Template (pt-BR)')
  })

  it('bundles the skills with the templates of the chosen language, falling back to pt-BR', () => {
    const ptBR = loadSkillInstructions(pluginDir, 'pt-BR', true)!
    expect(ptBR).toContain('## Skill agentboard-planejamento'); expect(ptBR).toContain('## Skill agentboard-tasks'); expect(ptBR).not.toContain('name: agentboard-tasks')
    expect(ptBR).toContain('### Template (pt-BR)')
    expect(loadSkillInstructions(pluginDir, 'en', true)).toContain('### Template (en)')
    const execution = loadSkillInstructions(pluginDir, 'pt-BR', false)!
    expect(execution).toContain('agentboard-resumo'); expect(execution).not.toContain('## Skill agentboard-planejamento')
    expect(loadSkillInstructions(join(pluginDir, 'nao-existe'), 'pt-BR', true)).toBeUndefined()
  })

  it('fluxo curto manda só a descrição e cada etapa carrega só a sua skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-ctx-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects), settings = new SettingsRepository(database)
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' })
    const column = board.get(project.id).columns[1]!
    const big = board.create({ projectId: project.id, columnId: column.id, title: 'Grande', description: 'Algo grande', type: 'feature', priority: 'high', acceptanceCriteria: [] })
    const small = board.create({ projectId: project.id, columnId: column.id, title: 'Pequena', description: 'Trocar o texto do botão', type: 'improvement', priority: 'low', acceptanceCriteria: [] })
    database.db.prepare("UPDATE cards SET workflow = 'light' WHERE id = ?").run(small.id)
    const service = new AgentContextService(board, settings, pluginDir)
    const block = await service.block(small.id)
    expect(block).toContain('"fluxo": "curto"'); expect(block).toContain('"tiposDeCard"'); expect(block).toContain('## What to do\nTrocar o texto do botão'); expect(block).not.toContain('### Plan'); expect(block).not.toContain('Current documents')
    expect(await service.block(big.id)).toContain('### Plan')
    expect(service.developerInstructions(false, null, big.id, 'execution')).toContain('## Skill agentboard-implementar')
    expect(service.developerInstructions(false, null, big.id, 'execution')).not.toContain('## Skill agentboard-testar')
    expect(service.developerInstructions(false, null, big.id, 'test')).toContain('## Skill agentboard-testar')
    expect(service.developerInstructions(false, null, small.id, 'execution')).toContain('## Skill agentboard-pequena')
    expect(service.developerInstructions(true)).not.toContain('## Skill agentboard-implementar')
    expect(service.freeInstructions(true)).not.toContain('## Skill agentboard-pequena')
    expect(service.freeInstructions(true)).toContain('discovery catalog')
    expect(service.freeInstructions(true)).not.toContain('# Card planning (AgentBoard, lean SDD)')
    expect(service.skillInstructions('agentboard-planejamento')).toContain('# Card planning (AgentBoard, lean SDD)')
    expect(service.skillInstructions('skill-inexistente')).toBeUndefined()
    database.close()
  })

  it('planejador: fluxo curto fica pronto só com a descrição', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-ctx-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects)
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' })
    const card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[0]!.id, title: 'Pequena', description: '', type: 'bug', priority: 'low', acceptanceCriteria: [] })
    database.db.prepare("UPDATE cards SET workflow = 'light' WHERE id = ?").run(card.id)
    expect(board.card(card.id).workflow).toBe('light')
    expect(board.markPlanReady(card.id)).toEqual(['descricao']); expect(board.card(card.id).hasPlan).toBe(false)
    board.update({ cardId: card.id, type: 'bug', title: 'Pequena', description: 'Corrigir o typo', priority: 'low', acceptanceCriteria: [] })
    expect(board.markPlanReady(card.id)).toEqual([]); expect(board.card(card.id).hasPlan).toBe(true)
    database.close()
  })
})
