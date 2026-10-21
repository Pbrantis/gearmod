import React, { useCallback, useEffect, useRef, useState } from 'react'
import { defaultPermissionMode, permissionModes, type AgentConfig, type AgentOptions, type AgentProfile, type AgentPurpose, type Effort, type ModelOption } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { ConfirmDialog } from './ConfirmDialog'

const effortLabel: Record<Effort, string> = { none: 'Nenhum', minimal: 'Mínimo', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo' }

/** Configuração de agente do card (agente, modelo, esforço e modo) para planejar ou executar; salva no card a cada mudança. */
export function useAgentConfig(cardId: string, purpose: AgentPurpose, profiles: AgentProfile[], lockedProfileId?: string): { config?: AgentConfig; options?: AgentOptions; update(patch: Partial<AgentConfig>): Promise<void>; error: string } {
  const [config, setConfig] = useState<AgentConfig>(), [options, setOptions] = useState<AgentOptions>(), [error, setError] = useState('')
  const profileId = config?.profileId, profileKey = profiles.map((item) => item.id).join(',')
  const latest = useRef(profiles); latest.current = profiles
  useEffect(() => {
    if (!cardId) return
    let alive = true
    void window.agentboard.invoke('cards:agent-config', { cardId }).then((saved) => {
      if (!alive) return
      const list = latest.current, stored = saved[purpose], first = list.find((item) => item.id === lockedProfileId) ?? list.find((item) => item.id === stored?.profileId) ?? list[0]
      if (!first) return
      setConfig(stored && stored.profileId === first.id ? stored : { profileId: first.id, model: null, effort: null, mode: defaultPermissionMode(first.provider, purpose) })
    }).catch((reason: unknown) => setError(String(reason)))
    return () => { alive = false }
  }, [cardId, purpose, lockedProfileId, profileKey])
  useEffect(() => {
    if (!profileId) return
    let alive = true
    void window.agentboard.invoke('agents:options', { profileId }).then((loaded) => { if (alive) setOptions(loaded) }).catch(() => { if (alive) setOptions({ models: [], mostUsed: { planning: null, execution: null } }) })
    return () => { alive = false }
  }, [profileId])
  // Sem escolha salva, mostra o padrão: o mais usado ou o recomendado para a finalidade.
  useEffect(() => {
    if (!config || !options || config.model !== null || config.effort !== null) return
    const used = options.mostUsed[purpose], recommended = options.models.find((model) => model.recommendedFor.includes(purpose))
    const model = used?.model ?? recommended?.id ?? null
    if (model) setConfig({ ...config, model, effort: used?.effort ?? options.models.find((item) => item.id === model)?.defaultEffort ?? null })
  }, [config, options, purpose])
  const update = useCallback(async (patch: Partial<AgentConfig>): Promise<void> => {
    if (!config) return
    const next = { ...config, ...patch }
    try { setError(''); await window.agentboard.invoke('cards:set-agent-config', { cardId, purpose, config: next }); setConfig(next) } catch (reason) { setError(String(reason).replace(/^Error: /, '')) }
  }, [cardId, config, purpose])
  return { config, options, update, error }
}

export function AgentMenu({ profiles, purpose, state, lockProfile = false, showMode = true, inline = false }: { profiles: AgentProfile[]; purpose: AgentPurpose; state: ReturnType<typeof useAgentConfig>; lockProfile?: boolean; showMode?: boolean; inline?: boolean }): React.JSX.Element {
  const { config, options, update, error } = state
  const [openState, setOpen] = useState(false), [danger, setDanger] = useState(false)
  const open = inline || openState
  const profile = profiles.find((item) => item.id === config?.profileId)
  if (!config || !profile) return <span className="agentMenuEmpty">Nenhum agente</span>
  const model = options?.models.find((item) => item.id === config.model)
  const modes = permissionModes[profile.provider].filter((item) => item.purposes.includes(purpose)), mode = modes.find((item) => item.id === config.mode)
  const used = options?.mostUsed[purpose]
  const tag = (item: ModelOption): string => (used?.model === item.id ? 'Mais usado' : item.recommendedFor.includes(purpose) ? 'Recomendado' : '')
  const efforts = model?.efforts ?? []
  return <div className="agentMenu">
    {!inline && <button type="button" className="agentMenuButton" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}><AgentIcon profile={profile} size="sm" /><span>{model?.label ?? config.model ?? 'Modelo padrão'}</span>{config.effort && <span className="dim">· {effortLabel[config.effort]}</span>}{showMode && mode && <span className="dim">· {mode.label}</span>}<span aria-hidden="true">▾</span></button>}
    {open && <div className={`agentPanel ${inline ? 'inline' : ''}`} role="dialog" aria-label="Agente, modelo, esforço e modo">
      <div className="panelSection"><span className="sectitle">Agente</span><select value={config.profileId} disabled={lockProfile} aria-label="Agente" onChange={(e) => { const next = profiles.find((item) => item.id === e.target.value); if (next) void update({ profileId: next.id, model: null, effort: null, mode: defaultPermissionMode(next.provider, purpose) }) }}>{profiles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
      <div className="panelSection"><span className="sectitle">Modelo</span>
        <button type="button" className={`opt ${config.model === null ? 'sel' : ''}`} onClick={() => void update({ model: null, effort: null })}><b>Padrão do agente</b><small>Usa o que o {profile.provider === 'codex' ? 'Codex' : 'Claude'} escolher</small></button>
        {options?.models.map((item) => <button type="button" key={item.id} className={`opt ${config.model === item.id ? 'sel' : ''}`} onClick={() => void update({ model: item.id, effort: item.efforts.includes(config.effort as Effort) ? config.effort : item.defaultEffort })}><b>{item.label}{tag(item) && <em>{tag(item)}</em>}</b><small>{item.description}</small></button>)}
        {options && !options.models.length && <small className="dim">Não foi possível listar os modelos agora.</small>}</div>
      {efforts.length > 0 && <div className="panelSection"><span className="sectitle">Esforço</span><div className="chipsRow">{efforts.map((item) => <button type="button" key={item} className={`chipBtn ${config.effort === item ? 'sel' : ''}`} onClick={() => void update({ effort: item })}>{effortLabel[item]}{used?.effort === item && used.model === config.model ? <em>Mais usado</em> : null}</button>)}</div></div>}
      {showMode && <div className="panelSection"><span className="sectitle">{purpose === 'planning' ? 'Modo' : 'Executar como?'}</span>
        {modes.map((item) => <button type="button" key={item.id} disabled={item.needsApprovalUi} title={item.needsApprovalUi ? 'Precisa da tela de aprovação (em breve)' : undefined} className={`opt ${config.mode === item.id ? 'sel' : ''}`} onClick={() => (item.dangerous ? setDanger(true) : void update({ mode: item.id }))}><b>{item.label}{item.recommended && <em>Recomendado</em>}{item.dangerous && <em className="warn">Cuidado</em>}</b><small>{item.description}</small></button>)}</div>}
      {error && <p className="error">{error}</p>}
      {!inline && <div className="actions"><button type="button" className="secondary mini" onClick={() => setOpen(false)}>Fechar</button></div>}
    </div>}
    {danger && <ConfirmDialog eyebrow="Ignorar permissões" title="Executar sem nenhuma proteção?" text="O agente poderá editar e apagar arquivos e rodar comandos sem pedir aprovação. Use só em ambiente descartável." ok="Ignorar permissões" danger cancel={() => setDanger(false)} confirm={() => { setDanger(false); void update({ mode: 'bypass' }) }} />}
    {error && !open && <small className="error">{error}</small>}
  </div>
}
