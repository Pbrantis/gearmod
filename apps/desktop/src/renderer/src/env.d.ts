import type { GearModApi } from '@gearmod/contracts'

declare global {
  interface Window { gearmod: GearModApi }
}

export {}
