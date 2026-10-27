import { describe, expect, it } from 'vitest'
import { relativeLink, resolveRelative } from './markdownPaths'

describe('resolveRelative', () => {
  it('resolve em relação à pasta do .md', () => {
    expect(resolveRelative('docs/x/y.md', '../img/a.png')).toBe('docs/img/a.png')
    expect(resolveRelative('docs/x/y.md', 'imagens/a.png')).toBe('docs/x/imagens/a.png')
    expect(resolveRelative('docs/x/y.md', './a.png')).toBe('docs/x/a.png')
    expect(resolveRelative('C:\\proj\\docs\\y.md', 'imagens/a%20b.png')).toBe('C:/proj/docs/imagens/a b.png')
  })
  it('endereço absoluto e consulta', () => {
    expect(resolveRelative('docs/y.md', 'C:/outro/a.png')).toBe('C:/outro/a.png')
    expect(resolveRelative('docs/y.md', 'a.png?raw=1')).toBe('docs/a.png')
  })
})
describe('relativeLink', () => {
  it('calcula o caminho a partir da pasta do .md', () => {
    expect(relativeLink('C:/p/docs/y.md', 'C:/p/docs/imagens/a.png')).toBe('imagens/a.png')
    expect(relativeLink('C:/p/docs/y.md', 'C:/p/assets/a b.png')).toBe('../assets/a%20b.png')
    expect(relativeLink('C:\\p\\docs\\y.md', 'C:\\p\\docs\\y.png')).toBe('y.png')
  })
  it('discos diferentes não têm caminho relativo', () => { expect(relativeLink('C:/p/y.md', 'D:/a.png')).toBeNull() })
})
