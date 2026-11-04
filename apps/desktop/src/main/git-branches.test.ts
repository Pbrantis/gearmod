import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { friendlyError, GitManager } from './git-manager'
import { GitService, ProjectRepository } from './projects'

const exec = promisify(execFile), roots: string[] = [], opened: AppDatabase[] = []
afterEach(async () => { opened.splice(0).forEach((item) => item.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const git = (dir: string, ...args: string[]): Promise<{ stdout: string }> => exec('git', ['-C', dir, ...args])

/** Repository with a bare remote (origin) that already has main and the feature/x branch. */
async function withRemote(): Promise<{ manager: GitManager; repo: string; remote: string; sourceId: string }> {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-branches-')); roots.push(root)
  const repo = join(root, 'repo'), remote = join(root, 'remote.git')
  await exec('git', ['init', '--bare', '-b', 'main', remote]); await exec('git', ['init', '-b', 'main', repo])
  await git(repo, 'config', 'user.email', 'test@example.invalid'); await git(repo, 'config', 'user.name', 'GearMod Test')
  await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'primeiro')
  await git(repo, 'remote', 'add', 'origin', remote); await git(repo, 'push', '-u', 'origin', 'main')
  await git(repo, 'checkout', '-b', 'feature/x'); await writeFile(join(repo, 'b.txt'), 'b\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'feature'); await git(repo, 'push', 'origin', 'feature/x')
  await git(repo, 'checkout', 'main'); await git(repo, 'branch', '-D', 'feature/x'); await git(repo, 'remote', 'set-head', 'origin', 'main')
  const database = new AppDatabase(join(root, 'data', 'db.sqlite'), '0.1.0'); await database.open(); opened.push(database)
  const project = await new ProjectRepository(database, new GitService()).create({ localPath: repo })
  const source = database.db.prepare('SELECT id FROM project_sources WHERE project_id = ?').get(project.id) as { id: string }
  return { manager: new GitManager(database), repo, remote, sourceId: source.id }
}

describe('remote branches', () => {
  it('fast-forwards the remote branch when opening it and refuses divergences', async () => {
    const { manager, repo, remote, sourceId } = await withRemote()
    const other = join(repo, '..', 'other'); await exec('git', ['clone', remote, other])
    await git(other, 'config', 'user.email', 'test@example.invalid'); await git(other, 'config', 'user.name', 'Test')
    await writeFile(join(other, 'remote.txt'), 'remoto\n'); await git(other, 'add', '.'); await git(other, 'commit', '-m', 'remoto'); await git(other, 'push')
    expect((await manager.checkoutRemote(sourceId, null, 'origin/main')).output).toContain('fast-forward')
    expect((await git(repo, 'rev-parse', 'HEAD')).stdout.trim()).toBe((await git(other, 'rev-parse', 'HEAD')).stdout.trim())
    await writeFile(join(repo, 'local.txt'), 'local\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'local')
    await writeFile(join(other, 'remote2.txt'), 'remoto\n'); await git(other, 'add', '.'); await git(other, 'commit', '-m', 'remoto 2'); await git(other, 'push')
    const before = (await git(repo, 'rev-parse', 'HEAD')).stdout.trim()
    await expect(manager.checkoutRemote(sourceId, null, 'origin/main')).rejects.toThrow(/divergiram/)
    expect((await git(repo, 'rev-parse', 'HEAD')).stdout.trim()).toBe(before)
  })
  it('checking out a remote branch creates the local one tracking the remote and, if the local one already exists, just switches to it', async () => {
    const { manager, repo, sourceId } = await withRemote()
    const first = await manager.branchAction(sourceId, { action: 'checkout', name: 'origin/feature/x' })
    expect(first.output).toContain('criada'); expect((await git(repo, 'branch', '--show-current')).stdout.trim()).toBe('feature/x')
    expect((await git(repo, 'rev-parse', '--abbrev-ref', 'feature/x@{upstream}')).stdout.trim()).toBe('origin/feature/x')
    await manager.branchAction(sourceId, { action: 'checkout', name: 'main' })
    const again = await manager.branchAction(sourceId, { action: 'checkout', name: 'origin/feature/x' })
    expect(again.output).toContain('já existia'); expect((await git(repo, 'branch', '--show-current')).stdout.trim()).toBe('feature/x')
  })
  it('deletes the branch on the server, but refuses the remote default, HEAD and names that do not exist', async () => {
    const { manager, repo, remote, sourceId } = await withRemote()
    await expect(manager.branchAction(sourceId, { action: 'delete-remote', name: 'origin/main' })).rejects.toThrow(/padrão/)
    await expect(manager.branchAction(sourceId, { action: 'delete-remote', name: 'origin/HEAD' })).rejects.toThrow()
    await expect(manager.branchAction(sourceId, { action: 'delete-remote', name: 'origin/nao-existe' })).rejects.toThrow(/não existe/)
    await expect(manager.branchAction(sourceId, { action: 'delete-remote', name: 'feature/x' })).rejects.toThrow()
    const done = await manager.branchAction(sourceId, { action: 'delete-remote', name: 'origin/feature/x' })
    expect(done.output).toContain('apagada')
    expect((await exec('git', ['-C', remote, 'branch', '--list'])).stdout).not.toContain('feature/x')
    expect((await git(repo, 'branch', '-r')).stdout).not.toContain('feature/x')
  })
})

describe('delete local branch', () => {
  it('explains when the branch is in use by a worktree or has not been merged yet', async () => {
    const { manager, repo, sourceId } = await withRemote()
    const wt = join(repo, '..', 'wt'); await git(repo, 'worktree', 'add', '-b', 'gearmod/card', wt)
    await expect(manager.branchAction(sourceId, { action: 'delete', name: 'gearmod/card' })).rejects.toThrow(/em uso por uma worktree/)
    await git(repo, 'worktree', 'remove', '--force', wt)
    await git(repo, 'checkout', '-b', 'solta'); await writeFile(join(repo, 'c.txt'), 'c'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'so aqui'); await git(repo, 'checkout', 'main')
    await expect(manager.branchAction(sourceId, { action: 'delete', name: 'solta' })).rejects.toThrow(/ainda não estão em outra branch/)
    expect(friendlyError(new Error("error: cannot delete branch 'x' used by worktree at 'C:/p'"))).toContain('em uso por uma worktree (C:/p)')
  })
})

describe('remote and pull branch', () => {
  it('detects a branch with no linked remote, links it to a branch that exists and explains when it does not exist', async () => {
    const { manager, repo, sourceId } = await withRemote()
    await git(repo, 'checkout', '-b', 'novo'); await git(repo, 'push', 'origin', 'novo')
    expect(await manager.upstream(sourceId, null)).toEqual({ branch: 'novo', upstream: null, remotes: ['origin'] })
    await expect(manager.setUpstream({ sourceId, cardId: null, remote: 'origin', branch: 'nao-existe' })).rejects.toThrow(/ainda não existe em origin/)
    await expect(manager.setUpstream({ sourceId, cardId: null, remote: 'outro', branch: 'novo' })).rejects.toThrow(/não existe neste repositório/)
    await expect(manager.setUpstream({ sourceId, cardId: null, remote: 'origin', branch: '--evil' })).rejects.toThrow(/inválido/)
    expect(await manager.setUpstream({ sourceId, cardId: null, remote: 'origin', branch: 'novo' })).toEqual({ upstream: 'origin/novo' })
    expect((await manager.upstream(sourceId, null)).upstream).toBe('origin/novo')
    expect((await manager.sync(sourceId, null, 'pull', 'rebase')).output).toBeTruthy()
  })
})
