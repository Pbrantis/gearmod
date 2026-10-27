import { describe, expect, it } from 'vitest'
import { rankPaths } from './quickOpen'

describe('rankPaths', () => {
  const paths = ['/p/src/workspace.ts', '/p/src/WorkspaceFiles.tsx', '/p/docs/notes.md', '/p/src/renderer/Window Files.tsx']
  it('wsf acha WorkspaceFiles.tsx e deixa de fora quem não tem as letras', () => {
    const ranked = rankPaths('wsf', paths)
    expect(ranked[0]!.name).toBe('WorkspaceFiles.tsx')
    expect(ranked.map((item) => item.name)).not.toContain('workspace.ts')
    expect(ranked[0]!.matched.length).toBe(3)
  })
  it('nome vale mais que pasta, e começo de palavra mais que letra solta', () => {
    const ranked = rankPaths('ws', ['/p/ws/readme.md', '/p/src/WorkSpace.ts', '/p/src/awsome.ts'])
    expect(ranked[0]!.name).toBe('WorkSpace.ts')
    expect(ranked.at(-1)!.name).toBe('readme.md')
  })
  it('recentes sobem quando o resto empata', () => {
    const both = ['/p/a/index.ts', '/p/b/index.ts']
    expect(rankPaths('idx', both, ['/p/b/index.ts'])[0]!.path).toBe('/p/b/index.ts')
  })
  it('sem texto mantém a ordem recebida', () => {
    expect(rankPaths('', ['/p/b', '/p/a']).map((item) => item.path)).toEqual(['/p/b', '/p/a'])
  })
})
