import { describe, expect, it } from 'vitest'
import { defaultPermissionMode, permissionModes } from './index'

describe('default permission mode', () => {
  it('Gemini does not start in yolo: the default is the mode that asks', () => {
    expect(defaultPermissionMode('gemini', 'execution')).toBe('manual')
    expect(permissionModes.gemini.find((mode) => mode.id === 'auto')?.recommended).toBeFalsy()
  })
  it('planning always starts in plan', () => {
    for (const provider of ['claude', 'codex', 'gemini'] as const) expect(defaultPermissionMode(provider, 'planning')).toBe('plan')
  })
})
