import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentUsage, UsageWindow } from '@agentboard/contracts'

/** A semana só ganha um anel próprio quando o limite está perto de acabar. */
const weekFrom = 75
const level = (percent: number): string => (percent >= 90 ? 'hi' : percent >= 70 ? 'mid' : 'ok')
const at = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const radius = 7, circumference = 2 * Math.PI * radius

function left(iso: string | null): string {
  if (!iso) return ''
  const minutes = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000)), days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60)
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes % 60}min` : `${minutes}min`
}

function Ring({ window, name }: { window: UsageWindow; name: string }): React.JSX.Element {
  const percent = Math.round(window.usedPercent), reset = left(window.resetsAt)
  const tip = `${name}: ${percent}% usado${reset ? ` · reseta em ${reset}` : ''}`
  return <span className={`uring tip ${level(percent)}`} data-tip={tip} role="img" aria-label={tip}>
    <svg viewBox="0 0 18 18" aria-hidden="true"><circle className="rt" cx="9" cy="9" r={radius} /><circle className="rv" cx="9" cy="9" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, percent) / 100)} transform="rotate(-90 9 9)" /></svg>
  </span>
}

/** Anéis ao lado do agente no chat: limite da sessão (5 h) sempre; o da semana só quando está perto de acabar. */
export function UsageRings({ profileId }: { profileId?: string }): React.JSX.Element | null {
  const [usage, setUsage] = useState<AgentUsage[]>([]), [open, setOpen] = useState(false)
  const load = useCallback(async () => { try { setUsage(await window.agentboard.invoke('usage:list', undefined)) } catch { /* uso é informativo */ } }, [])
  useEffect(() => { void load() }, [load, profileId])
  // O Claude só informa o limite quando roda: recarrega quando uma execução termina.
  useEffect(() => window.agentboard.onRunEvent((event) => { if (event.eventType === 'agentboard/run-completed') void load() }), [load])
  const entry = usage.find((item) => item.profileId === profileId), windows = entry?.windows ?? []
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    void window.agentboard.invoke('usage:refresh', undefined).then(setUsage).catch(() => undefined)
    const out = (e: MouseEvent): void => { if (!box.current?.contains(e.target as Node)) setOpen(false) }, key = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', out); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', key) }
  }, [open])
  const session = windows.find((item) => item.id === 'five_hour'), week = windows.find((item) => item.id === 'seven_day')
  const showWeek = week && week.usedPercent >= weekFrom
  if (!session && !showWeek) return null
  return <span className="uwrap" ref={box}>
    <button type="button" className="urings" aria-label="Ver uso do plano" aria-expanded={open} onClick={() => setOpen(!open)}>{session && <Ring window={session} name="Sessão (5 h)" />}{showWeek && <Ring window={week} name="Semana" />}</button>
    {open && <div className="upop2" role="dialog" aria-label="Limites de uso do agente"><div className="up2t">Limites de uso do plano</div>
      {windows.map((item) => { const percent = Math.round(item.usedPercent); return <div className="up2r" key={item.id}><div className="up2h"><span>{item.label}</span>{item.resetsAt && <small>Reseta em {left(item.resetsAt)} · {at(item.resetsAt)}</small>}<b>{percent}%</b></div><div className="ubar"><i className={level(percent)} style={{ width: `${Math.min(100, percent)}%` }} /></div></div> })}</div>}
  </span>
}
