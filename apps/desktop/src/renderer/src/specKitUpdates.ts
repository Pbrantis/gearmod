import { isOutdated } from '@gearmod/contracts'

// Release consultada em 29/10/2026. Este limite de atualização não é uma
// afirmação de que a integração nativa do GearMod já foi validada.
export const specKitUpdateCeiling = '1.2.5'
export const specKitInstallCommand = `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v${specKitUpdateCeiling}`

export function specKitUpdateState(installed: string | null, latest: string | null): { newerAvailable: boolean; canUpdate: boolean } {
  const valid = (value: string | null): boolean => value !== null && /^\d+\.\d+\.\d+$/.test(value)
  return {
    newerAvailable: valid(latest) && isOutdated(specKitUpdateCeiling, latest),
    canUpdate: valid(installed) && valid(latest) && isOutdated(installed, latest) && isOutdated(installed, specKitUpdateCeiling)
  }
}
