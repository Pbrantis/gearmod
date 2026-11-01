import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
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
    // Duas runs do mesmo card preparando ao mesmo tempo não disputam o `worktree add` (D5).
    const concurrent = board.create({ projectId: project.id, columnId: column.id, title: 'Concorrente', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const [a, b] = await Promise.all([service.prepare(concurrent.id), service.prepare(concurrent.id)])
    expect(a.id).toBe(b.id)
    // Uma tentativa anterior que falhou deixou a branch presa numa worktree pela metade: a próxima solta e recria.
    const accented = board.create({ projectId: project.id, columnId: column.id, title: 'Botão de reset', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const stale = join(data, 'worktrees', 'antiga'), branch = `agentboard/botao-de-reset-${accented.id.slice(0, 8)}`
    await exec('git', ['-C', repo, 'worktree', 'add', '-b', branch, stale, 'dev'])
    // D5: branch velha sem commits próprios é recriada na base de agora; com commits próprios é reaproveitada.
    const oldTip = (await exec('git', ['-C', repo, 'rev-parse', 'dev'])).stdout.trim()
    const parked = board.create({ projectId: project.id, columnId: column.id, title: 'Parada', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const kept = board.create({ projectId: project.id, columnId: column.id, title: 'Com trabalho', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const parkedBranch = `agentboard/parada-${parked.id.slice(0, 8)}`, keptBranch = `agentboard/com-trabalho-${kept.id.slice(0, 8)}`
    await exec('git', ['-C', repo, 'branch', parkedBranch, oldTip]); await exec('git', ['-C', repo, 'branch', keptBranch, oldTip])
    await exec('git', ['-C', repo, 'worktree', 'add', join(data, 'tmp-kept'), keptBranch]); await writeFile(join(data, 'tmp-kept', 'meu.txt'), 'x')
    await exec('git', ['-C', join(data, 'tmp-kept'), 'add', '.']); await exec('git', ['-C', join(data, 'tmp-kept'), 'commit', '-m', 'trabalho antigo']); await exec('git', ['-C', repo, 'worktree', 'remove', '--force', join(data, 'tmp-kept')])
    await writeFile(join(repo, 'novo.txt'), 'n'); await exec('git', ['-C', repo, 'add', '.']); await exec('git', ['-C', repo, 'commit', '-m', 'avanca a dev'])
    const newTip = (await exec('git', ['-C', repo, 'rev-parse', 'dev'])).stdout.trim()
    await service.prepare(parked.id); await service.prepare(kept.id)
    expect((await exec('git', ['-C', repo, 'rev-parse', parkedBranch])).stdout.trim()).toBe(newTip)
    expect((await exec('git', ['-C', repo, 'log', '--format=%s', keptBranch])).stdout).toContain('trabalho antigo')
    const recovered = await service.prepare(accented.id)
    expect(recovered.branch).toBe(branch)
    expect((await exec('git', ['-C', repo, 'worktree', 'list'])).stdout).not.toContain('antiga')
    const done = board.get(project.id).columns.find((item) => item.semanticState === 'done')!
    expect(() => board.move(first.id, done.id, null)).toThrow('Testes automatizados')
    const quality = new QualityService(database, service)
    expect((await quality.runTest(first.id, process.execPath, ['-e', 'process.stdout.write("ok")'])).status).toBe('passed')
    expect(() => board.move(first.id, done.id, null)).toThrow('Revisar')
    const review = quality.prepareLocalReview(first.id); expect(quality.approveLocal(review.id).state).toBe('approved')
    expect(board.move(first.id, done.id, null).columnId).toBe(done.id)
    // Pasta removida manualmente: o snapshot não quebra e limpa o membro órfão do banco/Git.
    const member = database.db.prepare('SELECT path FROM worktree_members WHERE worktree_id = ?').get(one.id) as { path: string }
    await rm(member.path, { recursive: true, force: true })
    expect((await service.snapshot(first.id)).exists).toBe(false)
    expect(database.db.prepare('SELECT COUNT(*) FROM worktree_members WHERE worktree_id = ?').pluck().get(one.id)).toBe(0)
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

  it('G07 ensureMember: adiciona um repositório fora de cards.repo_ids, é idempotente e resiste a duas chamadas concorrentes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-ensure-')); roots.push(root)
    const workspace = join(root, 'ws'), app = join(workspace, 'app'), docs = join(workspace, 'docs'), data = join(root, 'data')
    await mkdir(workspace, { recursive: true })
    for (const dir of [app, docs]) {
      await exec('git', ['init', '-b', 'main', dir])
      await exec('git', ['-C', dir, 'config', 'user.email', 'test@example.invalid']); await exec('git', ['-C', dir, 'config', 'user.name', 'AgentBoard Test'])
      await writeFile(join(dir, 'README.md'), '# fixture'); await exec('git', ['-C', dir, 'add', 'README.md']); await exec('git', ['-C', dir, 'commit', '-m', 'fixture'])
    }
    const database = new AppDatabase(join(data, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const projects = new ProjectRepository(database, new GitService()), project = await projects.create({ localPath: workspace })
    const board = new BoardRepository(database, projects), column = board.get(project.id).columns[0]!
    const card = board.create({ projectId: project.id, columnId: column.id, title: 'Card', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const sources = Object.fromEntries(board.get(project.id).project.sources.map((source) => [source.name, source]))
    board.setRepos(card.id, [sources.app!.id]) // docs não entra pelo fluxo normal
    const service = new WorktreeService(database, data), lower = (path: string): string => path.toLowerCase()
    const worktree = await service.prepare(card.id)
    expect(service.repositories(card.id).map((repo) => lower(repo.repoPath))).toEqual([lower(sources.app!.localPath)])
    const added = await service.ensureMember(card.id, sources.docs!.id)
    expect(added.status).toBe('active')
    expect(existsSync(join(added.path, 'README.md'))).toBe(true)
    expect(service.repositories(card.id).map((repo) => lower(repo.repoPath)).sort()).toEqual([lower(sources.app!.localPath), lower(sources.docs!.localPath)].sort())
    // Idempotente: chamar de novo não recria nem move a pasta.
    const again = await service.ensureMember(card.id, sources.docs!.id)
    expect(again.path).toBe(added.path)
    expect(database.db.prepare('SELECT COUNT(*) FROM worktree_members WHERE worktree_id = ?').pluck().get(worktree.id)).toBe(2)
    // Concorrência: duas chamadas ao mesmo tempo para um repositório novo não duplicam o membro nem corrompem a worktree.
    const concurrent = board.create({ projectId: project.id, columnId: column.id, title: 'Outro card', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    board.setRepos(concurrent.id, [sources.app!.id])
    await service.prepare(concurrent.id)
    const [a, b] = await Promise.all([service.ensureMember(concurrent.id, sources.docs!.id), service.ensureMember(concurrent.id, sources.docs!.id)])
    expect(a.path).toBe(b.path); expect(a.status).toBe('active')
    const concurrentWorktree = await service.prepare(concurrent.id)
    expect(database.db.prepare('SELECT COUNT(*) FROM worktree_members WHERE worktree_id = ?').pluck().get(concurrentWorktree.id)).toBe(2)
    database.close()
  })
})
