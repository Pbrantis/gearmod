import { describe, expect, it } from 'vitest'
import { shellCommand } from './terminals'

describe('shellCommand', () => {
  it('abre o PowerShell interativo (PowerShell 7 quando instalado) no Windows', () => {
    const shell = shellCommand('win32')
    expect(shell.file).toMatch(/(^|[\\/])(pwsh|powershell)\.exe$/i); expect(shell.args).toEqual(['-NoLogo'])
  })
  it('usa o shell do usuário nos outros sistemas', () => {
    expect(shellCommand('linux', '/bin/zsh').file).toBe('/bin/zsh'); expect(shellCommand('darwin').file).toBe('/bin/sh')
  })
})
