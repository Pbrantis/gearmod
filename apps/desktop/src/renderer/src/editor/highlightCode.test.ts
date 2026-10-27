import { describe, expect, it } from 'vitest'
import { extensionForFence, highlightCode } from './highlightCode'

describe('extensionForFence', () => {
  it('mapeia nomes de linguagem de bloco', () => {
    expect(extensionForFence('ts')).toBe('ts'); expect(extensionForFence('TypeScript')).toBe('ts'); expect(extensionForFence('powershell')).toBe('ps1')
    expect(extensionForFence('bash')).toBe('sh'); expect(extensionForFence('json')).toBe('json'); expect(extensionForFence(' yml ')).toBe('yml')
  })
  it('sem linguagem ou desconhecida não tem extensão', () => { expect(extensionForFence('')).toBeNull(); expect(extensionForFence('klingon')).toBeNull() })
})
describe('highlightCode', () => {
  it('colore TypeScript com as classes tok-* e preserva o texto', async () => {
    const code = 'const a = "x" // c', pieces = await highlightCode(code, 'ts')
    expect(pieces.map((piece) => piece.text).join('')).toBe(code)
    expect(pieces.some((piece) => piece.cls.includes('tok-keyword') && piece.text === 'const')).toBe(true)
    expect(pieces.some((piece) => piece.cls.includes('tok-string'))).toBe(true); expect(pieces.some((piece) => piece.cls.includes('tok-comment'))).toBe(true)
  })
  it('JSON e PowerShell (modo legado) também colorem', async () => {
    expect((await highlightCode('{"a": 1}', 'json')).some((piece) => piece.cls.includes('tok-'))).toBe(true)
    expect((await highlightCode('Get-ChildItem -Path "x" # oi', 'powershell')).some((piece) => piece.cls.includes('tok-'))).toBe(true)
  })
  it('diff colore por linha', async () => {
    const pieces = await highlightCode('@@ -1 +1 @@\n-velho\n+novo\n igual', 'diff')
    expect(pieces.map((piece) => piece.cls)).toEqual(['cb-hunk', 'cb-del', 'cb-add', ''])
  })
  it('sem linguagem ou bloco enorme não colore', async () => {
    expect(await highlightCode('x', '')).toEqual([]); expect(await highlightCode('a'.repeat(20_001), 'ts')).toEqual([])
  })
})
