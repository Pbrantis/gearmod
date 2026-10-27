import { describe, expect, it } from 'vitest'
import { parseChanges } from './changes'

describe('parseChanges', () => {
  it('counts added and removed lines per file across repositories and lists untracked files', () => {
    const diff = [
      '\n### AgentBoard root: C:/worktree/repo\n',
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
    const files = parseChanges({ worktreeId: '00000000-0000-4000-8000-000000000000', exists: true, diff, status: '\n### AgentBoard root: C:/worktree/repo\n## agentboard/x\n M api/views.py\n?? api/reset.py\n' })
    expect(files.map(({ path, root, added, removed, untracked }) => ({ path, root, added, removed, untracked }))).toEqual([
      { path: 'api/views.py', root: 'C:/worktree/repo', added: 2, removed: 1, untracked: undefined },
      { path: 'README.md', root: 'C:/worktree/repo', added: 1, removed: 1, untracked: undefined },
      { path: 'api/reset.py', root: 'C:/worktree/repo', added: 0, removed: 0, untracked: true }
    ])
    expect(files[0]!.diff).toContain('+extra = 2'); expect(files[0]!.diff).not.toContain('README')
  })

  it('keeps each relative file attached to its real worktree root', () => {
    const block = (root: string, path: string): string => `\n### AgentBoard root: ${root}\ndiff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`
    const files = parseChanges({ worktreeId: '00000000-0000-4000-8000-000000000000', exists: true, diff: block('C:/wt/frontend', 'src/index.ts') + block('C:/wt/backend', 'src/index.ts'), status: '' })
    expect(files.map((item) => [item.root, item.path])).toEqual([['C:/wt/frontend', 'src/index.ts'], ['C:/wt/backend', 'src/index.ts']])
  })
})
