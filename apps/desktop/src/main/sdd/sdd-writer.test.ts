import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { SddConflict, SddWriter } from './sdd-writer'

const exec = promisify(execFile), roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const git = (dir: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> => exec('git', ['-C', dir, ...args])

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-sddwriter-')); roots.push(root)
  const dir = join(root, 'repo')
  await exec('git', ['init', '-b', 'main', dir])
  await git(dir, 'config', 'user.email', 'test@example.invalid'); await git(dir, 'config', 'user.name', 'GearMod Test')
  await writeFile(join(dir, '.gitkeep'), ''); await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'inicial')
  return dir
}

/** Fake test worktree: `ensureMember` always returns the same member, already created via `git worktree add`. */
async function fakeWorktree(main: string) {
  const root = join(main, '..'), path = join(root, 'wt')
  await git(main, 'worktree', 'add', '-b', 'card/x', path, 'main')
  return { worktrees: { ensureMember: async () => ({ repoPath: main, path, baseRef: 'main', status: 'active' as const, error: null }) }, path }
}

describe('SddWriter', () => {
  it('writes a new file (expect.blobSha null) and returns the blob sha of what it wrote', async () => {
    const main = await repo()
    await writeFile(join(main, 'README.md'), 'x'); await git(main, 'add', '.'); await git(main, 'commit', '-m', 'inicial')
    const { worktrees, path } = await fakeWorktree(main)
    const writer = new SddWriter(worktrees)
    const result = await writer.write('card-1', 'source-1', 'constitution.md', 'Primeira versão', { blobSha: null })
    expect(await readFile(join(path, 'constitution.md'), 'utf8')).toBe('Primeira versão')
    expect(result.blobSha).toMatch(/^[0-9a-f]{40}$/)
  })

  it('SddConflict when the expected blob sha does not match the current one; the main copy does not change', async () => {
    const main = await repo()
    await writeFile(join(main, 'constitution.md'), 'versão da cópia principal'); await git(main, 'add', '.'); await git(main, 'commit', '-m', 'inicial')
    const { worktrees, path } = await fakeWorktree(main)
    await writeFile(join(path, 'constitution.md'), 'editado por fora, sem o writer saber')
    const writer = new SddWriter(worktrees)
    await expect(writer.write('card-1', 'source-1', 'constitution.md', 'minha versão', { blobSha: null })).rejects.toThrow(SddConflict)
    expect(await readFile(join(main, 'constitution.md'), 'utf8')).toBe('versão da cópia principal')
  })

  it('a successful write does not touch the main copy (byte-for-byte identical)', async () => {
    const main = await repo()
    await writeFile(join(main, 'constitution.md'), 'original'); await git(main, 'add', '.'); await git(main, 'commit', '-m', 'inicial')
    const { worktrees } = await fakeWorktree(main)
    const writer = new SddWriter(worktrees)
    const current = (await git(main, 'rev-parse', 'HEAD:constitution.md')).stdout.trim()
    await writer.write('card-1', 'source-1', 'constitution.md', 'alterado na worktree', { blobSha: current })
    expect(await readFile(join(main, 'constitution.md'), 'utf8')).toBe('original')
  })

  it('refuses an absolute path, ".." and a reserved Windows name', async () => {
    const main = await repo()
    const { worktrees } = await fakeWorktree(main)
    const writer = new SddWriter(worktrees)
    await expect(writer.write('c', 's', '/etc/passwd', 'x', { blobSha: null })).rejects.toThrow(/relativo/)
    await expect(writer.write('c', 's', '../fora/arquivo.md', 'x', { blobSha: null })).rejects.toThrow(/\.\./)
    await expect(writer.write('c', 's', 'pasta/CON.md', 'x', { blobSha: null })).rejects.toThrow(/reservado/)
    await expect(writer.write('c', 's', 'LPT1', 'x', { blobSha: null })).rejects.toThrow(/reservado/)
  })

  it('refuses a symbolic link that escapes the SDD root', async () => {
    const main = await repo()
    const { worktrees, path } = await fakeWorktree(main)
    const outside = join(path, '..', 'fora-da-worktree')
    await mkdir(outside, { recursive: true })
    try { await symlink(outside, join(path, 'link-escape'), 'junction') } catch { return /* environment without symlink permission: skip */ }
    const writer = new SddWriter(worktrees)
    await expect(writer.write('c', 's', 'link-escape/arquivo.md', 'x', { blobSha: null })).rejects.toThrow(/escapa/)
  })
})
