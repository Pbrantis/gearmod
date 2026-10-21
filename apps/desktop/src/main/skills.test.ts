import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentAdapter, AgentRunOptions } from './adapters'
import { AppDatabase } from './database'
import { ProfileRepository, ProjectRepository } from './projects'
import { convertSkillMd, parseSkillMd, SkillService } from './skills'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }
const skillMd = (name: string, description: string, body = 'Siga o CLAUDE.md do projeto e a pasta .claude/skills.') => `---\nname: ${name}\ndescription: ${description}\nallowed-tools: Bash\n---\n\n${body}\n`

async function setup(reviewer?: ConstructorParameters<typeof SkillService>[2]) {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-skills-')); roots.push(root)
  const home = join(root, 'home'), repo = join(root, 'repo')
  await mkdir(home, { recursive: true }); await mkdir(repo, { recursive: true })
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
  const profiles = new ProfileRepository(database, home)
  const claude = profiles.create({ provider: 'claude', label: 'Claude', scope: 'x', useExistingSession: true })
  const projects = new ProjectRepository(database, git)
  const project = await projects.create({ name: 'P', localPath: repo, baseBranch: 'dev', profileIds: [claude.id] })
  const events: string[] = []
  return { root, home, repo, database, claude, project, events, service: new SkillService(profiles, projects, reviewer, home, (type) => events.push(type)) }
}

describe('SKILL.md helpers', () => {
  it('parses name, description (inline and folded) and the body', () => {
    expect(parseSkillMd('---\nname: a\ndescription: Faz algo\n---\nCorpo')).toMatchObject({ name: 'a', description: 'Faz algo', body: 'Corpo' })
    expect(parseSkillMd('---\nname: b\ndescription: >\n  linha um\n  linha dois\n---\nX').description).toBe('linha um linha dois')
    expect(parseSkillMd('sem cabeçalho')).toMatchObject({ name: null, body: 'sem cabeçalho' })
  })

  it('converts between agents keeping only name and description and swapping conventions', () => {
    const codex = convertSkillMd(skillMd('s', 'Descrição "boa"'), 'claude', 'codex')
    expect(codex).toContain('name: s'); expect(codex).toContain('description: "Descrição \\"boa\\""'); expect(codex).not.toContain('allowed-tools')
    expect(codex).toContain('AGENTS.md'); expect(codex).toContain('.agents/skills')
    expect(convertSkillMd(codex, 'codex', 'claude')).toContain('CLAUDE.md')
  })
})

describe('SkillService', () => {
  it('detects global skills in the agent folders and project skills in the repository, merging providers by name', async () => {
    const { home, repo, project, service } = await setup()
    await mkdir(join(home, '.claude', 'skills', 'revisao'), { recursive: true }); await writeFile(join(home, '.claude', 'skills', 'revisao', 'SKILL.md'), skillMd('revisao', 'Revisa o diff'))
    await mkdir(join(home, '.codex', 'skills', 'revisao'), { recursive: true }); await writeFile(join(home, '.codex', 'skills', 'revisao', 'SKILL.md'), skillMd('revisao', 'Revisa o diff'))
    await mkdir(join(home, '.codex', 'skills', 'tdd'), { recursive: true }); await writeFile(join(home, '.codex', 'skills', 'tdd', 'SKILL.md'), skillMd('tdd', 'Teste primeiro'))
    await mkdir(join(repo, '.claude', 'skills', 'padrao-ipc'), { recursive: true }); await writeFile(join(repo, '.claude', 'skills', 'padrao-ipc', 'SKILL.md'), skillMd('padrao-ipc', 'Canais IPC tipados'))
    const global = await service.list('global')
    expect(global.map((skill) => [skill.name, skill.providers.claude, skill.providers.codex])).toEqual([['revisao', 'ready', 'ready'], ['tdd', 'none', 'ready']])
    const local = await service.list('project', project.id)
    expect(local).toHaveLength(1); expect(local[0]).toMatchObject({ name: 'padrao-ipc', detected: true, providers: { claude: 'ready', codex: 'none' } })
  })

  it('imports a folder or a SKILL.md into the agent location with a valid name and refuses duplicates', async () => {
    const { root, home, repo, project, service } = await setup()
    const source = join(root, 'minha'); await mkdir(join(source, 'templates'), { recursive: true })
    await writeFile(join(source, 'SKILL.md'), skillMd('qualquer', 'Importada')); await writeFile(join(source, 'templates', 'a.md'), 'modelo')
    const list = await service.import({ scope: 'global', sourcePath: source, name: 'minha-skill', provider: 'claude' })
    expect(list[0]).toMatchObject({ name: 'minha-skill', providers: { claude: 'ready', codex: 'none' } })
    expect(await readFile(join(home, '.claude', 'skills', 'minha-skill', 'templates', 'a.md'), 'utf8')).toBe('modelo')
    expect(await readFile(join(home, '.claude', 'skills', 'minha-skill', 'SKILL.md'), 'utf8')).toContain('name: minha-skill')
    await expect(service.import({ scope: 'global', sourcePath: source, name: 'minha-skill', provider: 'claude' })).rejects.toThrow('Já existe')
    await expect(service.import({ scope: 'global', sourcePath: source, name: 'Nome Inválido', provider: 'claude' })).rejects.toThrow('minúsculas')
    const projectList = await service.import({ scope: 'project', projectId: project.id, sourcePath: join(source, 'SKILL.md'), name: 'do-projeto', provider: 'codex' })
    expect(projectList[0]).toMatchObject({ name: 'do-projeto', providers: { claude: 'none', codex: 'ready' } })
    expect(await readFile(join(repo, '.agents', 'skills', 'do-projeto', 'SKILL.md'), 'utf8')).toContain('do-projeto')
  })

  it('converts by rule and then has the chosen agent review the result in the background', async () => {
    const runs: AgentRunOptions[] = []
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const adapter: AgentAdapter = { async run(options) { runs.push(options); await gate; return { sessionId: 's', turnId: null, text: 'ok', status: 'completed', error: null } } }
    const { home, claude, service, events } = await setup({ adapters: { claude: adapter, codex: adapter }, profile: () => claude })
    await mkdir(join(home, '.claude', 'skills', 'revisao'), { recursive: true }); await writeFile(join(home, '.claude', 'skills', 'revisao', 'SKILL.md'), skillMd('revisao', 'Revisa'))
    const result = await service.convert({ scope: 'global', name: 'revisao', from: 'claude', to: 'codex', reviewProfileId: claude.id })
    expect(result).toEqual({ converted: true, reviewing: true })
    expect((await service.list('global'))[0]!.providers.codex).toBe('converting')
    release(); await new Promise((resolve) => setTimeout(resolve, 20))
    expect(runs[0]!.prompt).toContain('Codex'); expect(runs[0]!.cwd).toBe(join(home, '.codex', 'skills', 'revisao'))
    expect(events).toEqual(['skills/review-started', 'skills/review-finished'])
    expect((await service.list('global'))[0]!.providers.codex).toBe('ready')
    expect(await readFile(join(home, '.codex', 'skills', 'revisao', 'SKILL.md'), 'utf8')).toContain('AGENTS.md')
    await expect(service.convert({ scope: 'global', name: 'revisao', from: 'claude', to: 'codex' })).rejects.toThrow('já existe')
    await expect(service.convert({ scope: 'global', name: 'inexistente', from: 'claude', to: 'codex' })).rejects.toThrow('não existe')
  })

  it('only accepts skill references that detection knows', async () => {
    const { home, project, service } = await setup()
    await mkdir(join(home, '.claude', 'skills', 'a'), { recursive: true }); await writeFile(join(home, '.claude', 'skills', 'a', 'SKILL.md'), skillMd('a', 'x'))
    await expect(service.assertKnown({ name: 'a', path: join(home, '.claude', 'skills', 'a') }, project.id)).resolves.toBeUndefined()
    await expect(service.assertKnown({ name: 'a', path: '/etc' }, project.id)).rejects.toThrow('desconhecida')
  })
})
