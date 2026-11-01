import React, { useEffect, useRef, useState } from 'react'
import type { BackgroundTask } from '@agentboard/contracts'
import { useT } from './i18n'
const elapsed = (from: string, to: string | null, now: number): string => {
  const seconds = Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000))
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}min` : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`
}

/** Subagentes e comandos em segundo plano do chat, lidos dos eventos que o agente já emite. Some quando o chat nunca usou segundo plano. */
export function AgentBackground({ chatId }: { chatId?: string }): React.JSX.Element | null {
  const t = useT().chat.background
  const [tasks, setTasks] = useState<BackgroundTask[]>([]), [open, setOpen] = useState(false), [now, setNow] = useState(Date.now()), box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    setTasks([]); setOpen(false)
    if (!chatId) return
    let disposed = false, timer: number | undefined
    const load = (): void => { void window.agentboard.invoke('chats:background', { chatId }).then((items) => { if (!disposed) setTasks(items) }).catch(() => undefined) }
    const later = (): void => { window.clearTimeout(timer); timer = window.setTimeout(load, 1200) }
    const off = window.agentboard.onRunEvent((event) => {
      if (event.eventType === 'agentboard/run-completed' || event.eventType === 'agentboard/run-started' || (event.eventType === 'claude/system' && String(event.payload.subtype ?? '').startsWith('task_') && event.payload.session_id !== undefined)) later()
    })
    load()
    return () => { disposed = true; window.clearTimeout(timer); off() }
  }, [chatId])
  const running = tasks.filter((task) => task.status === 'running').length
  useEffect(() => { if (!running) return; const id = window.setInterval(() => setNow(Date.now()), 5000); return () => window.clearInterval(id) }, [running])
  useEffect(() => { if (!open) return; const out = (event: MouseEvent): void => { if (!box.current?.contains(event.target as Node)) setOpen(false) }; document.addEventListener('mousedown', out); return () => document.removeEventListener('mousedown', out) }, [open])
  if (!tasks.length) return null
  return <span className="modewrap bgtasks" ref={box}>
    <button type="button" className={`modechip ${open ? 'on' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setNow(Date.now()); setOpen(!open) }} data-tip={t.tip}>{running > 0 && <i className="bgdot" />}{running > 0 ? t.runningCount(running) : t.title}</button>
    {open && <div className="modemenu bgmenu" role="dialog" aria-label={t.tasks}><div className="mm-title">{t.title}</div>
      {tasks.map((task) => <div className={`bgtask ${task.status}`} key={task.id}>
        <div className="bgrow"><b>{task.kind === 'subagent' ? t.subagent : t.command}</b><span className="bgstate">{t.status[task.status]} · {elapsed(task.startedAt, task.endedAt, now)}</span></div>
        <div className="bgtitle" data-tip={task.title}>{task.title || t.noDescription}</div>
        {task.status === 'running' && task.activity && <small className="bgact" data-tip={task.activity}>{task.activity}</small>}
        {task.status !== 'running' && task.summary && task.summary !== task.title && <small className="bgact" data-tip={task.summary}>{task.summary}</small>}
      </div>)}
    </div>}
  </span>
}
