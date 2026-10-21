import React, { useState } from 'react'
import type { AgentConfig, AgentProfile, Card } from '@agentboard/contracts'
import { AgentMenu, useAgentConfig } from './AgentMenu'

/** Iniciar execução: agente, modelo, esforço e "Executar como?". Iniciar aprova o plano atual e leva o card para Doing. */
export function StartDialog({ card, profiles, close, start }: { card: Card; profiles: AgentProfile[]; close(): void; start(config: AgentConfig): Promise<void> }): React.JSX.Element {
  const state = useAgentConfig(card.id, 'execution', profiles, card.run.profileId && profiles.some((item) => item.id === card.run.profileId) ? card.run.profileId : undefined)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <div className="overlay top" role="dialog" aria-label="Iniciar execução"><div className="modal confirm"><header><div><p className="eyebrow">Iniciar execução</p><h2>{card.title || 'Novo card'}</h2></div></header>
    <p>Iniciar aprova o Plano atual e leva o card para Doing. O agente trabalha numa worktree do projeto.</p>
    <AgentMenu profiles={profiles} purpose="execution" state={state} inline />
    {(error || state.error) && <p className="error">{error || state.error}</p>}
    <div className="actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="button" disabled={busy || !state.config} onClick={() => { if (!state.config) return; setBusy(true); setError(''); void start(state.config).catch((reason: unknown) => { setError(String(reason)); setBusy(false) }) }}>{busy ? 'Iniciando…' : 'Iniciar'}</button></div></div></div>
}
