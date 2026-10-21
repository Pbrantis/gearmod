import React, { useEffect, useState } from 'react'
import { permissionModes, type AgentConfig, type AgentProfile, type Card } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { CheckIcon } from './icons'
import { effortLabel, useAgentConfig } from './ModelMenu'

/** Iniciar execução (protótipo): agente · modelo · esforço e "Executar como?". Iniciar aprova o plano atual e leva o card para Doing. */
export function StartDialog({ card, profiles, close, start }: { card: Card; profiles: AgentProfile[]; close(): void; start(config: AgentConfig): Promise<void> }): React.JSX.Element {
  const lockedId = card.execProfileId && profiles.some((item) => item.id === card.execProfileId) ? card.execProfileId : undefined
  const state = useAgentConfig(card.id, 'execution', profiles, lockedId)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close])
  const profile = profiles.find((item) => item.id === state.config?.profileId)
  const modes = profile ? permissionModes[profile.provider].filter((item) => item.purposes.includes('execution')) : []
  const model = state.options?.models.find((item) => item.id === state.config?.model)
  return <div className="overlay" role="dialog" aria-label="Iniciar execução"><div className="modal" style={{ width: 'min(480px,100%)' }}>
    <header><div><div className="eyebrow">Iniciar execução</div><h2>{card.title || 'Novo card'}</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    {profile && <p style={{ marginBottom: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}><AgentIcon profile={profile} tip={false} /><span>{profile.label}{(model?.label ?? state.config?.model) ? ` · ${model?.label ?? state.config?.model}` : ''}{state.config?.effort ? ` · ${effortLabel[state.config.effort]}` : ''}</span></p>}
    <div className="sectitle" style={{ marginBottom: 8 }}>Executar como?</div>
    <div className="stack" style={{ gap: 8 }}>{modes.map((item) => <button type="button" key={item.id} disabled={item.needsApprovalUi} title={item.needsApprovalUi ? 'Precisa da tela de aprovação (em breve)' : undefined} className={`startopt ${state.config?.mode === item.id ? 'sel' : ''}`} onClick={() => void state.update({ mode: item.id })}><span className="mo-t"><b>{item.label}</b>{item.recommended && <em>Recomendado</em>}{item.dangerous && <em>Cuidado</em>}<small>{item.description}</small></span><span className="mo-r">{state.config?.mode === item.id && <CheckIcon />}</span></button>)}</div>
    {(error || state.error) && <p className="error" style={{ marginTop: 10 }}>{error || state.error}</p>}
    <div className="actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="button" disabled={busy || !state.config} onClick={() => { if (!state.config) return; setBusy(true); setError(''); void start(state.config).catch((reason: unknown) => { setError(String(reason).replace(/^Error: /, '')); setBusy(false) }) }}>{busy ? 'Iniciando…' : 'Iniciar'}</button></div>
  </div></div>
}
