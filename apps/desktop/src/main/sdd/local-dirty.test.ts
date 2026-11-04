import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { nativeGit } from '../worktrees'
import { localDirty } from './local-dirty'

const exec = promisify(execFile), roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const git = (dir: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> => exec('git', ['-C', dir, ...args])

describe('localDirty', () => {
  it('detects a modified file in the open checkout and does not flag what did not change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-dirty-')); roots.push(root)
    const dir = join(root, 'repo')
    await exec('git', ['init', '-b', 'main', dir])
    await git(dir, 'config', 'user.email', 't@t.invalid'); await git(dir, 'config', 'user.name', 'T')
    await writeFile(join(dir, 'constitution.md'), 'v1'); await writeFile(join(dir, 'outro.md'), 'x')
    await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'v1')
    expect(await localDirty(nativeGit, dir, 'constitution.md')).toBe(false)
    await writeFile(join(dir, 'constitution.md'), 'editado à mão, sem commitar')
    expect(await localDirty(nativeGit, dir, 'constitution.md')).toBe(true)
    expect(await localDirty(nativeGit, dir, 'outro.md')).toBe(false)
  })

  it('never throws: a folder without a Git repository returns false', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-dirty-')); roots.push(root)
    expect(await localDirty(nativeGit, root, 'qualquer.md')).toBe(false)
  })
})
