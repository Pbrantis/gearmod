import type { ProfileRepository } from './projects'

/** The automatic profiles were removed (migration 3); tests register their own explicitly. */
export function seedProfiles(profiles: ProfileRepository): void {
  profiles.create({ provider: 'codex', label: 'Codex', scope: 'Pessoal' })
  profiles.create({ provider: 'claude', label: 'Claude', scope: 'Pessoal' })
}
