import React, { useState } from 'react'
import type { AgentProfile, Card } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'

/** Iniciar execução: escolhe o agente; Iniciar aprova o plano atual e leva o card para Doing. */
export function StartDialog({ card, profiles, close, start }: { card: Card; profiles: AgentProfile[]; close(): void; start(profileId: string): Promise<void> }): React.JSX.Element {
  const [profileId, setProfileId] = useState(card.run.profileId && profiles.some((item) => item.id === card.run.profileId) ? card.run.profileId : profiles[0]?.id ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const profile = profiles.find((item) => item.id === profileId)
  return <div className="overlay top" role="dialog" aria-label="Iniciar execução"><div className="modal confirm"><header><div><p className="eyebrow">Iniciar execução</p><h2>{card.title || 'Novo card'}</h2></div></header>
    <p>Iniciar aprova o Plano atual e leva o card para Doing. O agente trabalha numa worktree do projeto.</p>
    <label>Agente<span className="agentPick">{profile && <AgentIcon profile={profile} size="sm" />}<select value={profileId} onChange={(e) => setProfileId(e.target.value)}>{profiles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></span></label>
    {error && <p className="error">{error}</p>}
    <div className="actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="button" disabled={busy || !profileId} onClick={() => { setBusy(true); setError(''); void start(profileId).catch((reason: unknown) => { setError(String(reason)); setBusy(false) }) }}>{busy ? 'Iniciando…' : 'Iniciar'}</button></div></div></div>
}
