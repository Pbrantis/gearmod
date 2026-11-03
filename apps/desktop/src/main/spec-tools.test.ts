import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { ProjectRepository, GitService } from './projects'
import { SpecToolsService, isSpecKitImplementRequest, specKitIntegrations, specKitSkill } from './spec-tools'
import type { CommandRunner } from './playwright-cli'

const roots: string[] = [], opened: AppDatabase[] = []
afterEach(async () => { opened.splice(0).forEach((item) => item.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })

/** Executor falso: só responde aos comandos listados; o resto "não existe". */
const runner = (answers: Record<string, string>): CommandRunner => ({ run: async (command, args) => { const key = `${command} ${args.join(' ')}`; if (key in answers) return answers[key]!; throw new Error(`${command}: comando não encontrado`) } })

async function setup(): Promise<{ root: string; database: AppDatabase; projectId: string; started: string; plain: string }> {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-tools-')); roots.push(root)
  const started = join(root, 'started'), plain = join(root, 'plain')
  await mkdir(join(started, '.specify', 'memory'), { recursive: true }); await mkdir(join(started, '.claude', 'commands'), { recursive: true }); await mkdir(join(started, 'openspec'), { recursive: true }); await mkdir(plain)
  await writeFile(join(started, '.claude', 'commands', 'speckit.plan.md'), '')
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open(); opened.push(database)
  const projects = new ProjectRepository(database, new GitService()), project = await projects.create({ localPath: root })
  database.db.prepare('DELETE FROM project_sources WHERE project_id = ?').run(project.id)
  const insert = database.db.prepare('INSERT INTO project_sources(id, project_id, name, local_path, is_git_repository, current_branch, sort_order) VALUES (?, ?, ?, ?, 0, NULL, ?)')
  insert.run('00000000-0000-4000-8000-000000000001', project.id, 'iniciado', started, 1); insert.run('00000000-0000-4000-8000-000000000002', project.id, 'simples', plain, 2)
  return { root, database, projectId: project.id, started, plain }
}

describe('SpecToolsService', () => {
  it('sem nenhuma CLI: tudo nulo, sem erro', async () => {
    const { database, projectId } = await setup(), status = await new SpecToolsService(database, runner({})).status(projectId)
    expect(status).toMatchObject({ node: null, uv: null, python: null, specify: { installed: false, version: null }, openspec: { installed: false, version: null }, error: null })
    expect(status.repos.map((repo) => [repo.name, repo.specKit, repo.openSpec])).toEqual([['iniciado', true, true], ['simples', false, false]])
  })
  it('com as CLIs: lê as versões e as integrações do Spec Kit', async () => {
    const { database, projectId } = await setup()
    const status = await new SpecToolsService(database, runner({ 'node --version': 'v22.1.0\n', 'uv --version': 'uv 0.8.2 (abc)\n', 'python3 --version': 'Python 3.12.4\n', 'specify version': 'CLI Version 0.7.1\nTemplate 0.7.0\n', 'openspec --version': '1.4.0\n' })).status(projectId)
    expect(status).toMatchObject({ node: '22.1.0', uv: '0.8.2', python: '3.12.4', specify: { installed: true, version: '0.7.1' }, openspec: { installed: true, version: '1.4.0' } })
    expect(status.repos[0]!.specKitIntegrations).toEqual(['claude'])
  })
  it('usa `specify --version` quando `specify version` não existe', async () => {
    const { database, projectId } = await setup()
    expect((await new SpecToolsService(database, runner({ 'specify --version': 'specify 0.3.0' })).status(projectId)).specify).toEqual({ installed: true, version: '0.3.0' })
  })
  it('Node antigo continua sendo reportado (a tela decide o aviso)', async () => {
    const { database, projectId } = await setup()
    expect((await new SpecToolsService(database, runner({ 'node --version': 'v18.20.0' })).status(projectId)).node).toBe('18.20.0')
  })
})
describe('specKitIntegrations', () => {
  it('lê integration.json e os rastros de comando', async () => {
    const { root } = await setup(), repo = join(root, 'json'); await mkdir(join(repo, '.specify'), { recursive: true }); await mkdir(join(repo, '.agents', 'skills'), { recursive: true })
    await writeFile(join(repo, '.specify', 'integration.json'), JSON.stringify({ integration: 'gemini' })); await writeFile(join(repo, '.agents', 'skills', 'speckit-plan'), '')
    expect(specKitIntegrations(repo).sort()).toEqual(['codex', 'gemini'])
    expect(specKitIntegrations(join(root, 'inexistente'))).toEqual([])
  })
})

describe('specKitSkill', () => {
  it('exige instalação e skill não vazia para o agente e etapa solicitados', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-speckit-')); roots.push(root)
    const repo = join(root, 'native')
    const codex = join(repo, '.agents', 'skills', 'speckit-specify')
    const claude = join(repo, '.claude', 'skills', 'speckit-plan')
    await mkdir(codex, { recursive: true }); await mkdir(claude, { recursive: true })
    await writeFile(join(codex, 'SKILL.md'), '# specify')
    await writeFile(join(claude, 'SKILL.md'), '# plan')
    expect(specKitSkill(repo, 'codex', 'specify')).toBeNull()
    await mkdir(join(repo, '.specify'))
    expect(specKitSkill(repo, 'codex', 'specify')).toBe(join(codex, 'SKILL.md'))
    expect(specKitSkill(repo, 'claude', 'plan')).toBe(join(claude, 'SKILL.md'))
    expect(specKitSkill(repo, 'claude', 'specify')).toBeNull()
    expect(specKitSkill(repo, 'codex', 'plan')).toBeNull()
    await writeFile(join(codex, 'SKILL.md'), '  ')
    expect(specKitSkill(repo, 'codex', 'specify')).toBeNull()
  })
})

describe('bloqueio explícito de speckit-implement no planejamento', () => {
  it('reconhece invocações Codex e Claude e uma skill selecionada', () => {
    expect(isSpecKitImplementRequest('$speckit-implement agora')).toBe(true)
    expect(isSpecKitImplementRequest('/speckit.implement')).toBe(true)
    expect(isSpecKitImplementRequest('continue', { name: 'speckit-implement', path: 'x' })).toBe(true)
    expect(isSpecKitImplementRequest('continue', { name: 'outra', path: 'C:\\repo\\speckit-implement\\SKILL.md' })).toBe(true)
    expect(isSpecKitImplementRequest('$speckit-plan')).toBe(false)
  })
})
