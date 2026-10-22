import { describe, expect, it } from 'vitest'
import { parseChanges } from './changes'

describe('parseChanges', () => {
  it('counts added and removed lines per file across repositories and lists untracked files', () => {
    const diff = [
      '\n## C:/repo\n',
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
    const files = parseChanges({ worktreeId: '00000000-0000-4000-8000-000000000000', exists: true, diff, status: '\n## C:/repo\n## agentboard/x\n M api/views.py\n?? api/reset.py\n' })
    expect(files.map(({ path, added, removed, untracked }) => ({ path, added, removed, untracked }))).toEqual([
      { path: 'api/views.py', added: 2, removed: 1, untracked: undefined },
      { path: 'README.md', added: 1, removed: 1, untracked: undefined },
      { path: 'api/reset.py', added: 0, removed: 0, untracked: true }
    ])
    expect(files[0]!.diff).toContain('+extra = 2'); expect(files[0]!.diff).not.toContain('README')
  })
})
