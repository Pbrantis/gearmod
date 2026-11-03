import { describe, expect, it } from 'vitest'
import { groupChanges, parseChanges, tabLabels } from './changes'

describe('parseChanges', () => {
  it('counts added and removed lines per file across repositories and lists untracked files', () => {
    const diff = [
      '\n### GearMod root: C:/worktree/repo\n',
      'diff --git a/api/views.py b/api/views.py',
      'index 1..2 100644',
      '--- a/api/views.py',
      '+++ b/api/views.py',
      '@@ -1,3 +1,4 @@',
      ' import os',
      '-old = 1',
      '+new = 1',
      '+extra = 2',
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-# a',
      '+# b',
      ''
    ].join('\n')
    const files = parseChanges({ worktreeId: '00000000-0000-4000-8000-000000000000', exists: true, diff, status: '\n### GearMod root: C:/worktree/repo\n## gearmod/x\n M api/views.py\n?? api/reset.py\n' })
    expect(files.map(({ path, root, added, removed, untracked }) => ({ path, root, added, removed, untracked }))).toEqual([
      { path: 'api/views.py', root: 'C:/worktree/repo', added: 2, removed: 1, untracked: undefined },
      { path: 'README.md', root: 'C:/worktree/repo', added: 1, removed: 1, untracked: undefined },
      { path: 'api/reset.py', root: 'C:/worktree/repo', added: 0, removed: 0, untracked: true }
    ])
    expect(files[0]!.diff).toContain('+extra = 2'); expect(files[0]!.diff).not.toContain('README')
  })

  it('keeps each relative file attached to its real worktree root', () => {
    const block = (root: string, path: string): string => `\n### GearMod root: ${root}\ndiff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`
    const files = parseChanges({ worktreeId: '00000000-0000-4000-8000-000000000000', exists: true, diff: block('C:/wt/frontend', 'src/index.ts') + block('C:/wt/backend', 'src/index.ts'), status: '' })
    expect(files.map((item) => [item.root, item.path])).toEqual([['C:/wt/frontend', 'src/index.ts'], ['C:/wt/backend', 'src/index.ts']])
  })
})

describe('groupChanges', () => {
  const root = (path: string, name: string, primary = false) => ({ path, name, branch: 'dev', worktree: true, primary })
  const change = (path: string, rootPath: string | undefined, added: number, removed: number) => ({ path, ...(rootPath ? { root: rootPath } : {}), added, removed, diff: '' })
  it('separa por repositório com o total de cada um, principal primeiro', () => {
    const roots = [root('C:/wt/2-web', '2-web'), root('C:/wt/1-api', '1-api', true)]
    const groups = groupChanges([change('a.ts', 'C:/wt/2-web', 3, 1), change('b.py', 'C:\\wt\\1-api\\', 2, 0), change('c.ts', 'C:/wt/2-web', 1, 1)], roots)
    expect(groups.map((group) => [group.name, group.added, group.removed, group.files.length])).toEqual([['api', 2, 0, 1], ['web', 4, 2, 2]])
    expect(groups[0]!.branch).toBe('dev')
  })
  it('um repositório sem root forma um grupo único e sem nome', () => {
    const groups = groupChanges([change('a.ts', undefined, 1, 0), change('b.ts', undefined, 2, 2)], [])
    expect(groups).toHaveLength(1); expect(groups[0]).toMatchObject({ root: null, name: '', added: 3, removed: 2 })
  })
})

describe('tabLabels', () => {
  const roots = [{ path: 'C:/wt', name: 'wt', branch: null, worktree: true, primary: true }, { path: 'C:/wt/1-app', name: '1-app', branch: null, worktree: true, primary: false }, { path: 'C:/wt/2-api', name: '2-api', branch: null, worktree: true, primary: false }]
  it('com dois repositórios, nomes iguais ganham o repo', () => {
    const labels = tabLabels(['C:/wt/1-app/package.json', 'C:/wt/2-api/package.json', 'C:/wt/2-api/main.py'], roots)
    expect(labels['C:/wt/1-app/package.json']).toEqual({ name: 'package.json', repo: 'app' })
    expect(labels['C:/wt/2-api/package.json']).toEqual({ name: 'package.json', repo: 'api' })
    expect(labels['C:/wt/2-api/main.py']).toEqual({ name: 'main.py', repo: 'api' })
  })
  it('com um repositório só, mostra apenas o nome', () => {
    const one = roots.slice(0, 2)
    expect(tabLabels(['C:/wt/1-app/package.json'], one)['C:/wt/1-app/package.json']).toEqual({ name: 'package.json', repo: null })
  })
})
