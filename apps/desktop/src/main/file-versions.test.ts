import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { fileVersions } from './file-versions'
import { BoardRepository, GitService, ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'
import { WorktreeService, nativeGit } from './worktrees'

const exec = promisify(execFile), temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const none = { git: nativeGit, baseFor: async () => null }
async function repository(): Promise<{ root: string; repo: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'gearmod-versions-'))); temporary.push(root)
  const repo = join(root, 'repo')
  await exec('git', ['init', '-b', 'dev', repo]); await exec('git', ['-C', repo, 'config', 'user.email', 'test@example.invalid']); await exec('git', ['-C', repo, 'config', 'user.name', 'GearMod Test'])
  await writeFile(join(repo, 'a.txt'), 'antes\n'); await writeFile(join(repo, 'gone.txt'), 'vai sumir\n')
  await exec('git', ['-C', repo, 'add', '.']); await exec('git', ['-C', repo, 'commit', '-m', 'base'])
  return { root, repo }
}

describe('fileVersions', () => {
  it('returns before (HEAD) and after (disk) of a changed file', async () => {
    const { repo } = await repository()
    await writeFile(join(repo, 'a.txt'), 'depois\n')
    const result = await fileVersions([repo], join(repo, 'a.txt'), none)
    expect(result).toMatchObject({ relative: 'a.txt', before: 'antes\n', after: 'depois\n', baseLabel: 'HEAD', binary: false, truncated: false })
  })
  it('a new file has a null before and a deleted file has a null after', async () => {
    const { repo } = await repository()
    await writeFile(join(repo, 'novo.txt'), 'novo\n'); await rm(join(repo, 'gone.txt'))
    expect(await fileVersions([repo], join(repo, 'novo.txt'), none)).toMatchObject({ before: null, after: 'novo\n' })
    expect(await fileVersions([repo], join(repo, 'gone.txt'), none)).toMatchObject({ before: 'vai sumir\n', after: null })
  })
  it('does not send content of binary or large files', async () => {
    const { repo } = await repository()
    await writeFile(join(repo, 'img.bin'), Buffer.from([1, 0, 2])); await writeFile(join(repo, 'grande.txt'), 'x'.repeat(1_100_000))
    expect(await fileVersions([repo], join(repo, 'img.bin'), none)).toMatchObject({ binary: true, before: null, after: null })
    expect(await fileVersions([repo], join(repo, 'grande.txt'), none)).toMatchObject({ truncated: true, before: null, after: null })
  })
  it('refuses a path outside the roots', async () => {
    const { repo, root } = await repository()
    await writeFile(join(root, 'fora.txt'), 'x')
    await expect(fileVersions([repo], join(root, 'fora.txt'), none)).rejects.toThrow('fora das pastas')
  })
  it("in a card with a worktree, uses the card's starting point as the base", async () => {
    const { root, repo } = await repository(), data = join(root, 'data')
    await mkdir(data)
    const database = new AppDatabase(join(data, 'db.sqlite'), '0.1.0'); await database.open()
    seedProfiles(new ProfileRepository(database, root))
    const projects = new ProjectRepository(database, new GitService()), project = await projects.create({ localPath: repo })
    const board = new BoardRepository(database, projects), column = board.get(project.id).columns[0]!
    const card = board.create({ projectId: project.id, columnId: column.id, title: 'Tarefa', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const service = new WorktreeService(database, data), worktree = await service.prepare(card.id), member = service.repositories(card.id)[0]!
    // The base moves on after the card was born: the card's "before" remains the branch-off point, not the base's new tip.
    await writeFile(join(repo, 'a.txt'), 'base mudou\n'); await exec('git', ['-C', repo, 'commit', '-am', 'base anda'])
    await writeFile(join(member.path, 'a.txt'), 'card mudou\n')
    const result = await fileVersions([worktree.path, member.path], join(member.path, 'a.txt'), { git: nativeGit, baseFor: (top) => service.baseFor(card.id, top) })
    expect(result.before).toBe('antes\n'); expect(result.after).toBe('card mudou\n'); expect(result.baseLabel).toContain('ponto de saída do card')
    database.close()
  })
})
