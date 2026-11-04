import { describe, expect, it } from 'vitest'
import { languageFor } from './languages'

describe('languageFor', () => {
  it('recognizes common extensions', async () => {
    for (const path of ['a/b.ts', 'x.tsx', 'x.js', 'dados.json', 'LEIA.md', 'run.ps1', 'x.css', 'x.html', 'x.py', 'x.yml', 'x.sh', 'Program.cs', '.env', 'pasta\\config.toml']) expect(await languageFor(path), path).not.toBeNull()
  })
  it('returns plain text for what has no language', async () => {
    for (const path of ['a.bin', 'LICENSE', 'x.png']) expect(await languageFor(path), path).toBeNull()
  })
})
