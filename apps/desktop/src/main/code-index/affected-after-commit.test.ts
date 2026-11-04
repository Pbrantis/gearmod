import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodeIndex } from './code-index'

const dirs: string[] = []
const indexes: CodeIndex[] = []
afterEach(async () => {
  for (const index of indexes.splice(0)) index.close()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})
const git = (root: string, ...args: string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true })
const write = async (root: string, path: string, content: string): Promise<void> => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content) }

describe('gearmod_code_affected_tests after a commit (B7)', () => {
  it('still finds the tests of files already committed on the branch, not only those from git status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-affected-')); dirs.push(root)
    git(root, 'init', '-b', 'main'); git(root, 'config', 'user.email', 't@example.invalid'); git(root, 'config', 'user.name', 'T'); git(root, 'config', 'core.autocrlf', 'false')
    await write(root, 'src/soma.ts', 'export const soma = (a: number, b: number): number => a + b\n')
    await write(root, 'src/soma.test.ts', "import { soma } from './soma'\nexport const ok = soma(1, 2)\n")
    git(root, 'add', '.'); git(root, 'commit', '-m', 'base')
    git(root, 'checkout', '-b', 'gearmod/card')
    await write(root, 'src/soma.ts', 'export const soma = (a: number, b: number): number => b + a\n')
    git(root, 'commit', '-am', 'muda soma')
    const index = new CodeIndex(join(await mkdtemp(join(tmpdir(), 'gearmod-affected-db-')), 'index.sqlite')); indexes.push(index)
    await index.index(root)
    const text = index.q(root).affected()
    expect(text).not.toContain('Nothing changed')
    expect(text).toContain('src/soma.test.ts')
  })
})
