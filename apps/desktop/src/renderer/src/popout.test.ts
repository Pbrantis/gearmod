import { describe, expect, it } from 'vitest'
import { popoutParams } from './popout'

describe('popoutParams', () => {
  it('lê uma janela completa de arquivos com suas abas', () => {
    const paths = ['C:/repo/a.ts', 'C:/repo/b #1.ts']
    const parsed = popoutParams(`?pop=files&project=p&path=${encodeURIComponent(paths[1]!)}&paths=${encodeURIComponent(JSON.stringify(paths))}`)
    expect(parsed).toMatchObject({ kind: 'files', projectId: 'p', path: paths[1], paths })
  })

  it('ignora uma lista de abas inválida sem perder a janela', () => {
    expect(popoutParams('?pop=files&project=p&paths=nope')?.paths).toEqual([])
  })
})
