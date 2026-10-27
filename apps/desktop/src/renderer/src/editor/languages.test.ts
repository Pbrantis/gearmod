import { describe, expect, it } from 'vitest'
import { languageFor } from './languages'

describe('languageFor', () => {
  it('reconhece as extensões comuns', async () => {
    for (const path of ['a/b.ts', 'x.tsx', 'x.js', 'dados.json', 'LEIA.md', 'run.ps1', 'x.css', 'x.html', 'x.py', 'x.yml', 'x.sh', 'Program.cs', '.env', 'pasta\\config.toml']) expect(await languageFor(path), path).not.toBeNull()
  })
  it('devolve texto puro para o que não tem linguagem', async () => {
    for (const path of ['a.bin', 'LICENSE', 'x.png']) expect(await languageFor(path), path).toBeNull()
  })
})
