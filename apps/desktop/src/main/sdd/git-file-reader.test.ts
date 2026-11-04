import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { GitFileReader, SddGitError } from './git-file-reader'

const exec = promisify(execFile), roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const git = (dir: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> => exec('git', ['-C', dir, ...args])

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-gitreader-')); roots.push(root)
  const dir = join(root, 'repo')
  await exec('git', ['init', '-b', 'main', dir])
  await git(dir, 'config', 'user.email', 'test@example.invalid'); await git(dir, 'config', 'user.name', 'GearMod Test'); await git(dir, 'config', 'core.autocrlf', 'false')
  return dir
}

describe('GitFileReader', () => {
  it('reads show/blobSha/exists/list on an existing ref, including a path with spaces, Unicode and preserved CRLF', async () => {
    const dir = await repo()
    await mkdir(join(dir, 'pasta com espaço', 'subpasta-ação'), { recursive: true })
    await writeFile(join(dir, 'pasta com espaço', 'subpasta-ação', 'arquivo.md'), 'linha1\r\nlinha2\r\n')
    await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'inicial')
    const reader = new GitFileReader(dir)
    const path = 'pasta com espaço/subpasta-ação/arquivo.md'
    expect(await reader.exists('main', path)).toBe(true)
    const sha = await reader.blobSha('main', path)
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
    const content = await reader.show('main', path)
    expect(content).toBe('linha1\r\nlinha2\r\n')
    const listed = await reader.list('main', 'pasta com espaço/subpasta-ação')
    expect(listed).toEqual(['arquivo.md'])
  })

  it('returns null (does not throw) for a missing file on a valid ref', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'a.md'), 'x'); await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'inicial')
    const reader = new GitFileReader(dir)
    expect(await reader.exists('main', 'nao-existe.md')).toBe(false)
    expect(await reader.blobSha('main', 'nao-existe.md')).toBeNull()
    expect(await reader.show('main', 'nao-existe.md')).toBeNull()
    expect(await reader.list('main', 'pasta-ausente')).toEqual([])
  })

  it('a nonexistent ref raises a typed error (ref-not-found), not swallowed as a missing file', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'a.md'), 'x'); await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'inicial')
    const reader = new GitFileReader(dir)
    await expect(reader.show('branch-que-nao-existe', 'a.md')).rejects.toThrow(SddGitError)
    await expect(reader.show('branch-que-nao-existe', 'a.md')).rejects.toMatchObject({ code: 'ref-not-found' })
    await expect(reader.list('branch-que-nao-existe', '')).rejects.toMatchObject({ code: 'ref-not-found' })
  })

  it('reads from another ref (not the current one), without depending on the open checkout', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'a.md'), 'versão 1'); await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'v1')
    await git(dir, 'checkout', '-b', 'feature')
    await writeFile(join(dir, 'a.md'), 'versão 2'); await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'v2')
    const reader = new GitFileReader(dir)
    expect(await reader.show('main', 'a.md')).toBe('versão 1')
    expect(await reader.show('feature', 'a.md')).toBe('versão 2')
  })
})
