import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWorkflowConfig } from '@gearmod/contracts'
import { AppDatabase } from '../database'
import { CardHistoryService } from '../history'
import { BoardRepository, GitService, ProfileRepository, ProjectRepository } from '../projects'
import { seedProfiles } from '../test-helpers'
import { WorktreeService } from '../worktrees'
import { SddResolver } from './sdd-resolver'

const exec = promisify(execFile), roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const git = (dir: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> => exec('git', ['-C', dir, ...args])

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-sddresolver-')); roots.push(root)
  const ws = join(root, 'ws'), app = join(ws, 'app'), docs = join(ws, 'docs'), data = join(root, 'data')
  await mkdir(ws, { recursive: true })
  for (const dir of [app, docs]) {
    await exec('git', ['init', '-b', 'main', dir])
    await git(dir, 'config', 'user.email', 'test@example.invalid'); await git(dir, 'config', 'user.name', 'GearMod Test')
  }
  await mkdir(join(app, '.gearmod'), { recursive: true }); await writeFile(join(app, '.gearmod', 'constitution.md'), 'Constitution do app na main')
  await git(app, 'add', '.'); await git(app, 'commit', '-m', 'inicial')
  await mkdir(join(docs, 'sdd', '.gearmod'), { recursive: true }); await writeFile(join(docs, 'sdd', '.gearmod', 'constitution.md'), 'Constitution dos docs, fora da raiz')
  await git(docs, 'add', '.'); await git(docs, 'commit', '-m', 'inicial')
  const database = new AppDatabase(join(data, 'db.sqlite'), '0.1.0'); await database.open()
  const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
  const projects = new ProjectRepository(database, new GitService()), project = await projects.create({ localPath: ws })
  const board = new BoardRepository(database, projects), column = board.get(project.id).columns[0]!
  const card = board.create({ projectId: project.id, columnId: column.id, title: 'Card', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
  const sources = Object.fromEntries(board.get(project.id).project.sources.map((source) => [source.name, source]))
  const history = new CardHistoryService(database, data)
  const worktrees = new WorktreeService(database, data)
  const resolver = new SddResolver(history, board, projects, worktrees)
  return { root, ws, app, docs, data, database, history, board, projects, card, sources, worktrees, resolver, project }
}

describe('SddResolver.locate', () => {
  it('monorepo: sem sourceId configurado, usa o primeiro repositório Git do projeto; lê por ref sem worktree', async () => {
    const { resolver, project, database } = await workspace()
    const location = await resolver.locate({ projectId: project.id })
    expect(location.via).toBe('ref'); expect(location.ref).toBe('main')
    database.close()
  })

  it('repo de docs separado, SDD fora da raiz: configura sourceId=docs e root=sdd, lê de lá', async () => {
    const { resolver, history, project, sources, database } = await workspace()
    history.setConfig(project.id, { ...defaultWorkflowConfig, sdd: { ...defaultWorkflowConfig.sdd, sourceId: sources.docs!.id, root: 'sdd' } })
    const view = await resolver.constitution({ projectId: project.id })
    expect(view.content).toBe('Constitution dos docs, fora da raiz')
    expect(view.path).toBe('sdd/.gearmod/constitution.md')
    database.close()
  })

  it('usa somente a origem de Constitution selecionada no projeto', async () => {
    const { resolver, history, project, app, database } = await workspace()
    await mkdir(join(app, '.specify', 'memory'), { recursive: true })
    await writeFile(join(app, '.specify', 'memory', 'constitution.md'), 'Constitution do Spec Kit')
    await git(app, 'add', '.'); await git(app, 'commit', '-m', 'adiciona speckit')
    history.setConfig(project.id, { ...defaultWorkflowConfig, sdd: { ...defaultWorkflowConfig.sdd, method: 'speckit' } })
    const view = await resolver.constitution({ projectId: project.id })
    expect(view.method).toBe('speckit')
    expect(view.path).toBe('.specify/memory/constitution.md')
    expect(view.content).toBe('Constitution do Spec Kit')
    database.close()
  })

  it('sourceId removido do projeto gera erro acionável (não um crash genérico)', async () => {
    const { resolver, history, project, database } = await workspace()
    const fakeId = '00000000-0000-4000-8000-000000000099'
    history.setConfig(project.id, { ...defaultWorkflowConfig, sdd: { ...defaultWorkflowConfig.sdd, sourceId: fakeId } })
    await expect(resolver.locate({ projectId: project.id })).rejects.toThrow(/não existe mais no projeto/)
    database.close()
  })

  it('card sem worktree lê por ref; card com worktree lê o arquivo da worktree (mesmo não commitado)', async () => {
    const { resolver, board, card, worktrees, sources, project, database } = await workspace()
    board.setRepos(card.id, [sources.app!.id])
    const withoutWorktree = await resolver.locate({ projectId: project.id, cardId: card.id })
    expect(withoutWorktree.via).toBe('ref')
    await worktrees.prepare(card.id)
    const withWorktree = await resolver.locate({ projectId: project.id, cardId: card.id })
    expect(withWorktree.via).toBe('worktree')
    const member = worktrees.repositories(card.id)[0]!
    await writeFile(join(member.path, '.gearmod', 'constitution.md'), 'editado na worktree, sem commit')
    const view = await resolver.constitution({ projectId: project.id, cardId: card.id })
    expect(view.content).toBe('editado na worktree, sem commit')
    expect(view.via).toBe('worktree')
    database.close()
  })

  it('trocar a base do card troca a fonte da leitura (sem worktree)', async () => {
    const { resolver, board, card, project, app, sources, database } = await workspace()
    board.setRepos(card.id, [sources.app!.id])
    await git(app, 'checkout', '-b', 'outra-branch')
    await writeFile(join(app, '.gearmod', 'constitution.md'), 'Constitution na outra branch')
    await git(app, 'add', '.'); await git(app, 'commit', '-m', 'outra versão')
    await git(app, 'checkout', 'main')
    expect((await resolver.constitution({ projectId: project.id, cardId: card.id })).content).toBe('Constitution do app na main')
    board.setBaseBranch(card.id, 'outra-branch')
    expect((await resolver.constitution({ projectId: project.id, cardId: card.id })).content).toBe('Constitution na outra branch')
    database.close()
  })
})
