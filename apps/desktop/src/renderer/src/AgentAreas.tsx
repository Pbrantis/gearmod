import React, { useCallback, useEffect, useState } from 'react'
import type { AgentProfile, AgentUsage, Card } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'

type Area = 'idle' | 'working' | 'paused' | 'empty'
const areas: Array<{ key: Area; label: string }> = [{ key: 'idle', label: 'Livre' }, { key: 'working', label: 'Trabalhando' }, { key: 'paused', label: 'Interrompido' }, { key: 'empty', label: 'Sem fôlego' }]
const clock = (iso: string): string => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/**
 * Agentes do projeto separados por estado: livre, trabalhando, interrompido (execução parada) e sem fôlego (limite de uso esgotado).
 * Trabalhando vence os outros; sem fôlego vem antes de interrompido porque é o motivo de ter parado.
 */
export function AgentAreas({ profiles, cards }: { profiles: AgentProfile[]; cards: Card[] }): React.JSX.Element {
  const [usage, setUsage] = useState<AgentUsage[]>([])
  const load = useCallback(async () => { try { setUsage(await window.agentboard.invoke('usage:list', undefined)) } catch { /* uso é informativo */ } }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (event.eventType === 'agentboard/run-completed') void load() }), [load])

  const status = (profile: AgentProfile): { area: Area; detail: string } => {
    const mine = cards.filter((card) => card.run.profileId === profile.id), titles = (list: Card[]): string => list.map((card) => card.title || 'Novo card').join(', ')
    const working = mine.filter((card) => card.run.state === 'running' || card.run.state === 'planning')
    if (working.length) return { area: 'working', detail: titles(working) }
    const full = usage.find((item) => item.profileId === profile.id)?.windows.filter((window) => window.usedPercent >= 100 && window.resetsAt && Date.parse(window.resetsAt) > Date.now()) ?? []
    if (full.length) return { area: 'empty', detail: `limite de uso esgotado; volta às ${clock(full.map((window) => window.resetsAt!).sort().at(-1)!)}` }
    const paused = mine.filter((card) => card.run.state === 'paused')
    if (paused.length) return { area: 'paused', detail: titles(paused) }
    return { area: 'idle', detail: '' }
  }
  const grouped = profiles.map((profile) => ({ profile, ...status(profile) }))
  if (!grouped.length) return <></>
  return <div className="agentareas" aria-label="Agentes do projeto">{areas.map(({ key, label }) => {
    const list = grouped.filter((item) => item.area === key)
    if (!list.length) return null
    return <div key={key} className={`agarea ${key}`}>
      <span className="aglabel">{key === 'working' && list.length ? <span className="spin sm" /> : <span className="agdot" />}{label}</span>
      {list.map(({ profile, detail }) => <span key={profile.id} className="agface tip" data-tip={detail ? `${profile.label}: ${detail}` : profile.label}><AgentIcon profile={profile} size="sm" tip={false} /></span>)}
    </div>
  })}</div>
}
