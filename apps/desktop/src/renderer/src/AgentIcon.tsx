import React from 'react'
import { type AgentProfile } from '@gearmod/contracts'

/** Ícone genérico de agente (robô), igual para todos os provedores: a cor do agente é o que distingue um do outro. */
const agentGlyph = 'M12 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM11.25 4.5h1.5V7h-1.5zM6 7h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3zM8.5 11.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 1 0 0-3.5zM15.5 11.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 1 0 0-3.5zM1 11.5h1.5v4H1zM21.5 11.5H23v4h-1.5z'

// Por enquanto o desenho é o mesmo para todos os provedores; `data-provider` fica para estilo e testes.
export function ProviderLogo({ provider }: { provider: AgentProfile['provider'] }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true" data-provider={provider}><path fillRule="evenodd" clipRule="evenodd" d={agentGlyph} /></svg>
}

/** Avatar do agente (`.av`): ícone de agente na cor do agente; o nome dado ao agente aparece só no tooltip. */
export function AgentIcon({ profile, size = 'md', tip = true }: { profile: Pick<AgentProfile, 'provider' | 'label' | 'color'>; size?: 'sm' | 'md' | 'lg'; tip?: boolean }): React.JSX.Element {
  return <i className={`av ${profile.provider} ${size === 'lg' ? 'lg' : ''} ${size === 'sm' ? 'smav' : ''} ${tip ? 'tip' : ''} tc`} style={{ '--tc': profile.color } as React.CSSProperties} data-tip={tip ? profile.label : undefined} role="img" aria-label={profile.label}><ProviderLogo provider={profile.provider} /></i>
}
