import { describe, expect, it } from 'vitest'
import { isLocalAbsolutePath, isTrustedSender } from './ipc'

describe('isTrustedSender', () => {
  it('aceita o arquivo local do app e a origem do servidor de dev', () => {
    expect(isTrustedSender({ senderFrame: { url: 'file:///C:/app/out/renderer/index.html?popout=1' } }, undefined)).toBe(true)
    expect(isTrustedSender({ senderFrame: { url: 'http://localhost:5173/?x=1' } }, 'http://localhost:5173')).toBe(true)
  })
  it('recusa outra origem, frame destruído e dev server fora do modo dev', () => {
    expect(isTrustedSender({ senderFrame: { url: 'https://evil.example/' } }, 'http://localhost:5173')).toBe(false)
    expect(isTrustedSender({ senderFrame: { url: 'http://localhost:5173/' } }, undefined)).toBe(false)
    expect(isTrustedSender({ senderFrame: null }, undefined)).toBe(false)
  })
})

describe('isLocalAbsolutePath', () => {
  it('recusa caminho de rede e relativo', () => {
    expect(isLocalAbsolutePath(String.raw`C:\fotos\a.png`)).toBe(true)
    expect(isLocalAbsolutePath(String.raw`\\servidor\share\a.png`)).toBe(false)
    expect(isLocalAbsolutePath('//servidor/share/a.png')).toBe(false)
    expect(isLocalAbsolutePath('fotos/a.png')).toBe(false)
  })
})
