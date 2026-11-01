import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { nativeGit } from '../worktrees'
import { constitutionState, mergeBaseCommit, type ThreeWayState } from './constitution-state'
import { GitFileReader } from './git-file-reader'

describe('constitutionState (pura, tabela-verdade)', () => {
  const table: Array<[string | null, string | null, string | null, ThreeWayState]> = [
    ['m', 'm', null, 'missing'],
    ['m', 'm', 'm', 'in-sync'],
    ['m', 'b', 'b', 'in-sync'],
    ['m', 'm', 'h', 'ahead'],
    [null, null, 'h', 'ahead'],
    ['m', 'b', 'm', 'behind'],
    [null, 'b', null, 'missing'],
    ['m', 'b', 'h', 'diverged'],
    [null, 'b', 'h', 'diverged']
  ]
  it.each(table)('mergeBase=%s baseTip=%s head=%s → %s', (mergeBase, baseTip, head, expected) => {
    expect(constitutionState(mergeBase, baseTip, head)).toBe(expected)
  })
})

const exec = promisify(execFile), roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const git = (dir: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> => exec('git', ['-C', dir, ...args])

describe('mergeBaseCommit + constitutionState (integração real)', () => {
  it('branch do card ahead: mudou a constituição, a base não', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-constate-')); roots.push(root)
    const dir = join(root, 'repo')
    await exec('git', ['init', '-b', 'main', dir])
    await git(dir, 'config', 'user.email', 't@t.invalid'); await git(dir, 'config', 'user.name', 'T')
    await writeFile(join(dir, 'constitution.md'), 'v1'); await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'v1')
    await git(dir, 'checkout', '-b', 'card/x')
    await writeFile(join(dir, 'constitution.md'), 'v2 do card'); await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'v2')
    const reader = new GitFileReader(dir)
    const base = await mergeBaseCommit(nativeGit, dir, 'main', 'card/x')
    expect(base).not.toBeNull()
    const mergeBase = await reader.blobSha(base!, 'constitution.md'), baseTip = await reader.blobSha('main', 'constitution.md'), head = await reader.blobSha('card/x', 'constitution.md')
    expect(constitutionState(mergeBase, baseTip, head)).toBe('ahead')
  })

  it('base behind: a base ganhou um commit novo, o card não mudou o arquivo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-constate-')); roots.push(root)
    const dir = join(root, 'repo')
    await exec('git', ['init', '-b', 'main', dir])
    await git(dir, 'config', 'user.email', 't@t.invalid'); await git(dir, 'config', 'user.name', 'T')
    await writeFile(join(dir, 'constitution.md'), 'v1'); await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'v1')
    await git(dir, 'checkout', '-b', 'card/x')
    await writeFile(join(dir, 'outro.md'), 'x'); await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'outro arquivo, não a constituição')
    await git(dir, 'checkout', 'main')
    await writeFile(join(dir, 'constitution.md'), 'v2 da base'); await git(dir, 'add', '.'); await git(dir, 'commit', '-m', 'v2')
    const reader = new GitFileReader(dir)
    const base = await mergeBaseCommit(nativeGit, dir, 'main', 'card/x')
    const mergeBase = await reader.blobSha(base!, 'constitution.md'), baseTip = await reader.blobSha('main', 'constitution.md'), head = await reader.blobSha('card/x', 'constitution.md')
    expect(constitutionState(mergeBase, baseTip, head)).toBe('behind')
  })
})
