import React from 'react'
import { type AgentProfile } from '@agentboard/contracts'

const claudePath = 'M12 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM11.25 4.5h1.5V7h-1.5zM6 7h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3zM8.5 11.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 1 0 0-3.5zM15.5 11.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 1 0 0-3.5zM1 11.5h1.5v4H1zM21.5 11.5H23v4h-1.5z'
const codexPath = 'M12 1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3zM11.25 4.5h1.5V7h-1.5zM6 7h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3zM8.5 11.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 1 0 0-3.5zM15.5 11.25a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 1 0 0-3.5zM1 11.5h1.5v4H1zM21.5 11.5H23v4h-1.5z'

export function ProviderLogo({ provider }: { provider: AgentProfile['provider'] }): React.JSX.Element {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{provider === 'claude' ? <path d={claudePath} /> : <path fillRule="evenodd" clipRule="evenodd" d={codexPath} />}</svg>
}

/** Ícone do agente: logo do provedor na cor escolhida para o agente; o nome dado ao agente aparece só no tooltip. */
export function AgentIcon({ profile, size = 'md' }: { profile: Pick<AgentProfile, 'provider' | 'label' | 'color'>; size?: 'sm' | 'md' | 'lg' }): React.JSX.Element {
  return <i className={`agentIcon ${size} tip`} style={{ '--agent': profile.color } as React.CSSProperties} data-tip={profile.label} aria-label={profile.label} role="img"><ProviderLogo provider={profile.provider} /></i>
}
