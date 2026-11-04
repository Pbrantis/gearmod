import { isOutdated } from '@gearmod/contracts'

// Release checked on 10/29/2026. This update ceiling is not a
// claim that GearMod's native integration has already been validated.
export const specKitUpdateCeiling = '1.2.5'
export const specKitInstallCommand = `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@v${specKitUpdateCeiling}`

export function specKitUpdateState(installed: string | null, latest: string | null): { newerAvailable: boolean; canUpdate: boolean } {
  const valid = (value: string | null): boolean => value !== null && /^\d+\.\d+\.\d+$/.test(value)
  return {
    newerAvailable: valid(latest) && isOutdated(specKitUpdateCeiling, latest),
    canUpdate: valid(installed) && valid(latest) && isOutdated(installed, latest) && isOutdated(installed, specKitUpdateCeiling)
  }
}
