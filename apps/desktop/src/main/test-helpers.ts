import type { ProfileRepository } from './projects'

/** Os perfis automáticos foram removidos (migração 3); os testes cadastram os seus explicitamente. */
export function seedProfiles(profiles: ProfileRepository): void {
  profiles.create({ provider: 'codex', label: 'Codex', scope: 'Pessoal', useExistingSession: false })
  profiles.create({ provider: 'claude', label: 'Claude', scope: 'Pessoal', useExistingSession: false })
}
