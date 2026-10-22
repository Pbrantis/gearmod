import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { BoardRepository, GitService, ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'
import { WorktreeService } from './worktrees'
import { QualityService } from './quality'

const exec = promisify(execFile), roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })

describe('WorktreeService', () => {
  it('discovers sibling repositories and accepts a folder without Git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-sources-')); roots.push(root)
    const workspace = join(root, 'workspace'), front = join(workspace, 'front'), back = join(workspace, 'back'), plain = join(root, 'plain')
    await mkdir(workspace); await mkdir(plain)
    await exec('git', ['init', '-b', 'front-dev', front]); await exec('git', ['init', '-b', 'back-dev', back])
    const git = new GitService()
    const inspected = await git.inspect(workspace)
    expect(inspected.repositories.map((repository) => [repository.name, repository.currentBranch]).sort()).toEqual([['back', 'back-dev'], ['front', 'front-dev']])
    expect((await git.inspect(plain)).repositories).toEqual([])
  })

  it('creates independent persistent worktrees and reports their diffs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-worktree-')); roots.push(root)
    const repo = join(root, 'repo'), data = join(root, 'data')
    await exec('git', ['init', '-b', 'dev', repo]); await exec('git', ['-C', repo, 'config', 'user.email', 'test@example.invalid']); await exec('git', ['-C', repo, 'config', 'user.name', 'AgentBoard Test'])
    await writeFile(join(repo, 'README.md'), '# fixture'); await exec('git', ['-C', repo, 'add', 'README.md']); await exec('git', ['-C', repo, 'commit', '-m', 'fixture'])
    const database = new AppDatabase(join(data, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const projects = new ProjectRepository(database, new GitService()), project = await projects.create({ localPath: repo })
    expect(project.name).toBe('repo'); expect(project.baseBranch).toBe('dev')
    const board = new BoardRepository(database, projects), column = board.get(project.id).columns[0]!
    const first = board.create({ projectId: project.id, columnId: column.id, title: 'Primeira tarefa', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const second = board.create({ projectId: project.id, columnId: column.id, title: 'Segunda tarefa', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const service = new WorktreeService(database, data), one = await service.prepare(first.id), two = await service.prepare(second.id)
    expect(one.path).not.toBe(two.path); expect(one.branch).not.toBe(two.branch)
    await writeFile(join(one.path, '1-repo', 'change.txt'), 'isolated')
    const snapshot = await service.snapshot(first.id)
    expect(snapshot.exists).toBe(true); expect(snapshot.status).toContain('change.txt')
    expect((await service.snapshot(second.id)).status).not.toContain('change.txt')
    expect((await service.prepare(first.id)).id).toBe(one.id)
    expect(one.path.length).toBeLessThan(data.length + 16)
    // Uma tentativa anterior que falhou deixou a branch presa numa worktree pela metade: a próxima solta e recria.
    const accented = board.create({ projectId: project.id, columnId: column.id, title: 'Botão de reset', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const stale = join(data, 'worktrees', 'antiga'), branch = `agentboard/botao-de-reset-${accented.id.slice(0, 8)}`
    await exec('git', ['-C', repo, 'worktree', 'add', '-b', branch, stale, 'dev'])
    const recovered = await service.prepare(accented.id)
    expect(recovered.branch).toBe(branch)
    expect((await exec('git', ['-C', repo, 'worktree', 'list'])).stdout).not.toContain('antiga')
    const done = board.get(project.id).columns.find((item) => item.semanticState === 'done')!
    expect(() => board.move(first.id, done.id, null)).toThrow('teste aprovado')
    const quality = new QualityService(database, service)
    expect((await quality.runTest(first.id, process.execPath, ['-e', 'process.stdout.write("ok")'])).status).toBe('passed')
    expect(() => board.move(first.id, done.id, null)).toThrow('revisão aprovada')
    const review = quality.prepareLocalReview(first.id); expect(quality.approveLocal(review.id).state).toBe('approved')
    expect(board.move(first.id, done.id, null).columnId).toBe(done.id)
    database.close()
  }, 20_000)

  it('creates the worktree from the base branch chosen for the card (falls back to the current one when it does not exist)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-basebranch-')); roots.push(root)
    const repo = join(root, 'repo'), data = join(root, 'data')
    await exec('git', ['init', '-b', 'dev', repo]); await exec('git', ['-C', repo, 'config', 'user.email', 'test@example.invalid']); await exec('git', ['-C', repo, 'config', 'user.name', 'AgentBoard Test'])
    await writeFile(join(repo, 'README.md'), '# fixture'); await exec('git', ['-C', repo, 'add', 'README.md']); await exec('git', ['-C', repo, 'commit', '-m', 'fixture'])
    await exec('git', ['-C', repo, 'branch', 'release'])
    const database = new AppDatabase(join(data, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const projects = new ProjectRepository(database, new GitService()), project = await projects.create({ localPath: repo })
    const board = new BoardRepository(database, projects), column = board.get(project.id).columns[0]!
    const make = (title: string) => board.create({ projectId: project.id, columnId: column.id, title, description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const chosen = make('Da release'), missing = make('Branch inexistente'), plain = make('Sem escolha')
    board.setBaseBranch(chosen.id, 'release'); board.setBaseBranch(missing.id, 'nao-existe')
    const service = new WorktreeService(database, data)
    expect((await service.prepare(chosen.id)).baseRef).toBe('release')
    expect((await service.prepare(missing.id)).baseRef).toBe('dev')
    expect((await service.prepare(plain.id)).baseRef).toBe('dev')
    expect(board.baseBranch(chosen.id)).toBe('release')
    database.close()
  })
})
