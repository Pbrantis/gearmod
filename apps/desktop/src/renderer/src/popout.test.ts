import { describe, expect, it } from 'vitest'
import { popoutParams } from './popout'

describe('popoutParams', () => {
  it('reads a complete files window with its tabs', () => {
    const paths = ['C:/repo/a.ts', 'C:/repo/b #1.ts']
    const parsed = popoutParams(`?pop=files&project=p&path=${encodeURIComponent(paths[1]!)}&paths=${encodeURIComponent(JSON.stringify(paths))}`)
    expect(parsed).toMatchObject({ kind: 'files', projectId: 'p', path: paths[1], paths })
  })

  it('ignores an invalid tab list without losing the window', () => {
    expect(popoutParams('?pop=files&project=p&paths=nope')?.paths).toEqual([])
  })
})
