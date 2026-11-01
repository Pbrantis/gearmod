import { describe, expect, it } from 'vitest'
import { defaultPermissionMode, permissionModes } from './index'

describe('modo de permissão padrão', () => {
  it('Gemini não começa em yolo: o padrão é o modo que pergunta', () => {
    expect(defaultPermissionMode('gemini', 'execution')).toBe('manual')
    expect(permissionModes.gemini.find((mode) => mode.id === 'auto')?.recommended).toBeFalsy()
  })
  it('planejamento sempre começa em plan', () => {
    for (const provider of ['claude', 'codex', 'gemini'] as const) expect(defaultPermissionMode(provider, 'planning')).toBe('plan')
  })
})
