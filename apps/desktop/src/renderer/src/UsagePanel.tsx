import React, { useCallback, useEffect, useState } from 'react'
import type { AgentProfile, AgentUsage } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { plainError } from './NoticeDialog'
import { tr, useT } from './i18n'

const level = (percent: number): string => (percent >= 85 ? 'hi' : percent >= 60 ? 'mid' : 'ok')
function resetIn(iso: string | null): string {
  if (!iso) return ''
  const minutes = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000))
  const t = tr().chat.usagePanel
  if (minutes < 60) return t.resetsInMinutes(minutes)
  if (minutes < 2880) return t.resetsInHours(Math.round(minutes / 60))
  return t.resetsInDays(Math.round(minutes / 1440))
}
function ago(iso: string | null): string {
  const t = tr().chat.usagePanel
  if (!iso) return t.noDataYet
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000))
  return minutes < 2 ? t.now : minutes < 60 ? t.minutesAgo(minutes) : minutes < 2880 ? t.hoursAgo(Math.round(minutes / 60)) : t.daysAgo(Math.round(minutes / 1440))
}

/** Uso das sessões dos agentes (janelas de 5 horas e semanal), lido das sessões do Codex e da última execução do Claude. */
export function UsagePanel({ profiles }: { profiles: AgentProfile[] }): React.JSX.Element {
  const t = useT().chat.usagePanel
  const [open, setOpen] = useState(false), [usage, setUsage] = useState<AgentUsage[]>([]), [error, setError] = useState('')
  const load = useCallback(async () => { try { setUsage(await window.agentboard.invoke('usage:list', undefined)); setError('') } catch (reason) { setError(plainError(reason)) } }, [])
  useEffect(() => { if (open) void load() }, [open, load])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (open && event.eventType === 'agentboard/run-completed') void load() }), [open, load])
  const top = Math.max(0, ...usage.flatMap((item) => item.windows.map((window) => window.usedPercent)))
  return <div className="usage">
    <button type="button" className="usedBtn tip" data-tip={t.title} aria-label={t.title} aria-expanded={open} onClick={() => setOpen(!open)}><span className={`ubar ${level(top)}`}><i style={{ width: `${top}%` }} /></span></button>
    {open && <div className="usagePanel" role="dialog" aria-label={t.title}><b>{t.title}</b>
      {profiles.length === 0 && <p className="dim">{t.noAgents}</p>}
      {profiles.map((profile) => { const item = usage.find((entry) => entry.profileId === profile.id); return <div className="usageRow" key={profile.id}>
        <div className="usageHead"><AgentIcon profile={profile} size="sm" /><span>{profile.label}</span><small>{item ? ago(item.capturedAt) : ''}</small></div>
        {item?.windows.length ? item.windows.map((window) => <div className="usageWindow" key={window.id}><div className="usageLine"><span>{window.label}</span><b>{window.usedPercent}%</b></div><div className={`ubar ${level(window.usedPercent)}`}><i style={{ width: `${window.usedPercent}%` }} /></div>{window.resetsAt && <small>{resetIn(window.resetsAt)}</small>}</div>) : <small className="dim">{profile.provider === 'claude' ? t.claudeHint : t.codexHint}</small>}
        {item && <small className="dim">{item.source}</small>}
      </div> })}
      {error && <p className="error">{error}</p>}
    </div>}
  </div>
}
