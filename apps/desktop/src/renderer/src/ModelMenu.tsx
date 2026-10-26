import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { defaultPermissionMode, type AgentConfig, type AgentOptions, type AgentProfile, type AgentPurpose, type Effort } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { CheckIcon } from './icons'
import { useFitInView } from './useFitInView'

export const effortLabel: Record<Effort, string> = { none: 'Nenhum', minimal: 'Mínimo', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Extra alto', max: 'Máximo', ultra: 'Ultra' }

/** Configuração de agente do card (agente, modelo, esforço e modo) para planejar ou executar; salva no card a cada mudança. */
export function useAgentConfig(cardId: string, purpose: AgentPurpose, profiles: AgentProfile[], lockedProfileId?: string): { config?: AgentConfig; options?: AgentOptions; update(patch: Partial<AgentConfig>): Promise<void>; error: string; touched: boolean } {
  const [config, setConfig] = useState<AgentConfig>(), [options, setOptions] = useState<AgentOptions>(), [error, setError] = useState('')
  const profileId = config?.profileId, profileKey = profiles.map((item) => item.id).join(',')
  const latest = useRef(profiles); latest.current = profiles
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    let alive = true
    if (!cardId) {
      const first = latest.current.find((item) => item.id === lockedProfileId) ?? latest.current[0]
      if (first) setConfig((current) => current ?? { profileId: first.id, model: null, effort: null, mode: defaultPermissionMode(first.provider, purpose) })
      return () => { alive = false }
    }
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
    void window.agentboard.invoke('agents:options', { profileId }).then((loaded) => { if (alive) setOptions(loaded) }).catch(() => { if (alive) setOptions({ models: [], mostUsed: { planning: null, execution: null, test: null } }) })
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
    if (!cardId) { setTouched(true); setConfig(next); return }
    try { setError(''); await window.agentboard.invoke('cards:set-agent-config', { cardId, purpose, config: next }); setConfig(next) } catch (reason) { setError(String(reason).replace(/^Error: /, '')) }
  }, [cardId, config, purpose])
  return { config, options, update, error, touched }
}

/**
 * Menu de modelo do protótipo (`.mmbtn` + `.mmpop`): lista de modelos, e os submenus Agente e Esforço.
 * `field` = versão do editor (mostra o nome do agente); `noAgent` = o agente é escolhido em outro campo.
 */
export function ModelMenu({ profiles, purpose, state, noAgent = false, field = false, lockProfile = false, onLockedPick }: { profiles: AgentProfile[]; purpose: AgentPurpose; state: ReturnType<typeof useAgentConfig>; noAgent?: boolean; field?: boolean; lockProfile?: boolean; onLockedPick?(profile: AgentProfile): void }): React.JSX.Element {
  const { config, options, update, error } = state
  const [open, setOpen] = useState(false), [sub, setSub] = useState<'agent' | 'effort' | null>(null), [pos, setPos] = useState<{ right: number; bottom?: number; top?: number }>(), [subPos, setSubPos] = useState<React.CSSProperties>()
  const button = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null), row = useRef<HTMLButtonElement | null>(null), wrap = useRef<HTMLDivElement>(null), subBox = useRef<HTMLDivElement>(null)
  useFitInView(pop, open); useFitInView(subBox, open && sub !== null)
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const rect = button.current.getBoundingClientRect()
    setPos({ right: window.innerWidth - rect.right, ...(field ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }) })
  }, [open, field])
  useLayoutEffect(() => {
    if (!open || !sub || !pop.current || !row.current) { setSubPos(undefined); return }
    const popRect = pop.current.getBoundingClientRect(), rowRect = row.current.getBoundingClientRect(), width = 300
    setSubPos({ ...(field ? { top: rowRect.top - 6 } : { bottom: window.innerHeight - rowRect.bottom - 6 }), ...(popRect.left - 6 - width >= 8 ? { right: window.innerWidth - popRect.left + 6 } : { left: popRect.right + 6 }) })
  }, [open, sub, field])
  useEffect(() => {
    if (!open) return
    const close = (event: Event): void => { if (!wrap.current?.contains(event.target as Node)) { setOpen(false); setSub(null) } }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); setSub(null) } }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key, true) }
  }, [open])
  const profile = profiles.find((item) => item.id === config?.profileId)
  if (!config || !profile) return <span className="hint">Nenhum agente</span>
  const used = options?.mostUsed[purpose]
  const modelBadges = (id: string, recommended: boolean): React.ReactNode => <>{recommended && <em>Recomendado</em>}{used?.model === id && <em className="used">Mais usado</em>}</>
  const model = options?.models.find((item) => item.id === config.model)
  const efforts = model?.efforts ?? []
  return <div className="mm" ref={wrap}>
    <button type="button" ref={button} className={`mmbtn ${field ? 'field' : ''} ${open ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(!open); setSub(null) }}>{!noAgent && <AgentIcon profile={profile} size="sm" tip={false} />}{field && !noAgent && <span className="mag">{profile.label}</span>}<span className="mname">{model?.label ?? config.model ?? 'Modelo padrão'}</span>{config.effort && <span className="meff">{effortLabel[config.effort]}</span>}</button>
    {open && pos && <div className="mmpop" ref={pop} role="menu" style={{ right: pos.right, bottom: pos.bottom, top: pos.top, maxHeight: field ? window.innerHeight - (pos.top ?? 0) - 12 : undefined, overflowY: field ? 'auto' : undefined }}>
      <button type="button" role="menuitem" className="mmi" onClick={() => void update({ model: null, effort: null })}><span>Padrão do agente</span><small>{config.model === null ? <CheckIcon /> : ''}</small></button>
      {options?.models.map((item, index) => <button type="button" role="menuitem" key={item.id} className="mmi" onClick={() => void update({ model: item.id, effort: item.efforts.includes(config.effort as Effort) ? config.effort : item.defaultEffort })}><span>{item.label}{modelBadges(item.id, item.recommendedFor.includes(purpose))}</span><small>{config.model === item.id ? <CheckIcon /> : index + 1}</small></button>)}
      {options && !options.models.length && <p className="mmnote">Não foi possível listar os modelos agora.{options.error ? ` Motivo: ${options.error}` : ''}</p>}
      <div className="mmsep" />
      {!noAgent && <button type="button" role="menuitem" ref={sub === 'agent' ? row : undefined} className={`mmi sub ${sub === 'agent' ? 'mmact' : ''}`} onClick={() => setSub(sub === 'agent' ? null : 'agent')}><span>Agente</span><small>{profile.label} ›</small></button>}
      {efforts.length > 0 && <button type="button" role="menuitem" ref={sub === 'effort' ? row : undefined} className={`mmi sub ${sub === 'effort' ? 'mmact' : ''}`} onClick={() => setSub(sub === 'effort' ? null : 'effort')}><span>Esforço</span><small>{config.effort ? effortLabel[config.effort] : 'Padrão'} ›</small></button>}
    </div>}
    {open && sub === 'effort' && subPos && <div className="mmpop mmsub" ref={subBox} style={subPos}><p className="mmnote">Mais esforço significa respostas mais completas, mas leva mais tempo e consome seus limites mais rápido.</p>{efforts.map((item) => <button type="button" key={item} className="mmi" onClick={() => void update({ effort: item })}><span>{effortLabel[item]}{used?.model === config.model && used.effort === item && <em className="used">Mais usado</em>}{model?.defaultEffort === item && <em>Recomendado</em>}</span><small>{config.effort === item && <CheckIcon />}</small></button>)}</div>}
    {open && sub === 'agent' && subPos && <div className="mmpop mmsub" ref={subBox} style={subPos}>{lockProfile && <p className="mmnote">Este chat já começou com {profile.label}. Trocar o agente reinicia o chat.</p>}{profiles.map((item) => <button type="button" key={item.id} className="mmi" onClick={() => { setSub(null); if (lockProfile && item.id !== profile.id) { setOpen(false); onLockedPick?.(item); return } void update({ profileId: item.id, model: null, effort: null, mode: defaultPermissionMode(item.provider, purpose) }) }}><span className="mmag"><AgentIcon profile={item} size="sm" tip={false} />{item.label}</span><small>{item.id === profile.id && <CheckIcon />}</small></button>)}</div>}
    {error && <small className="error">{error}</small>}
  </div>
}
