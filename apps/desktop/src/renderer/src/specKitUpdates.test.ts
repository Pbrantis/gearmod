import { describe, expect, it } from 'vitest'
import { specKitInstallCommand, specKitUpdateCeiling, specKitUpdateState } from './specKitUpdates'

describe('limite de atualização do Spec Kit', () => {
  it('fixa a instalação e informa quando a versão publicada ultrapassa o limite', () => {
    expect(specKitInstallCommand).toContain(`@v${specKitUpdateCeiling}`)
    expect(specKitUpdateState('1.0.0', '1.3.0')).toEqual({ newerAvailable: true, canUpdate: true })
  })
  it('não oferece downgrade nem atualização quando as versões não são conhecidas', () => {
    expect(specKitUpdateState('1.3.0', '1.4.0').canUpdate).toBe(false)
    expect(specKitUpdateState('1.2.5', '1.3.0').canUpdate).toBe(false)
    expect(specKitUpdateState(null, '1.3.0').canUpdate).toBe(false)
    expect(specKitUpdateState('1.0.0', null).canUpdate).toBe(false)
    expect(specKitUpdateState('1.0.0', '1.3.0-beta').canUpdate).toBe(false)
  })
})
