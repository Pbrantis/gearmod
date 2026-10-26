import React, { useEffect, useRef, useState } from 'react'
import { tasks, useTasks, type BgTask } from './backgroundTasks'
import { useFitInView } from './useFitInView'

const elapsed = (task: BgTask, now: number): string => {
  const seconds = Math.max(0, Math.round(((task.endedAt ?? now) - task.startedAt) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${String(seconds % 60).padStart(2, '0')}s`
}

/** Botão da barra de título com os processos em segundo plano (instalações, revisões…) e o andamento de cada um. */
export function TasksButton(): React.JSX.Element {
  const list = useTasks(), running = list.filter((item) => item.state === 'running').length, failed = list.filter((item) => item.state === 'failed').length
  const [open, setOpen] = useState(false), [now, setNow] = useState(() => Date.now()), box = useRef<HTMLSpanElement>(null), pop = useRef<HTMLDivElement>(null)
  useFitInView(pop, open)
  useEffect(() => { if (!open && !running) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [open, running])
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent): void => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const esc = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const label = running ? `${running} processo${running === 1 ? '' : 's'} em segundo plano` : 'Processos em segundo plano'
  return <span className="popwrap tasksbtn" ref={box}>
    <button type="button" className={`ibtn tip ${open ? 'on' : ''} ${running ? 'busy' : ''}`} data-tip={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
      {running ? <span className="spin sm" aria-hidden="true" /> : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h3l2-5 4 10 2-5h3" /></svg>}
      {(running > 0 || failed > 0) && <i className={`tasks-badge ${running ? '' : 'bad'}`}>{running || failed}</i>}
    </button>
    {open && <div className="tasks-pop" ref={pop} role="dialog" aria-label="Processos em segundo plano">
      <header><b>Processos</b>{list.some((item) => item.state !== 'running') && <button type="button" className="ghost" onClick={() => tasks.clearFinished()}>Limpar concluídos</button>}</header>
      {!list.length ? <p className="tasks-empty">Nenhum processo em segundo plano. Instalações e revisões longas aparecem aqui enquanto rodam.</p>
        : <ul>{list.map((task) => <li key={task.id} className={`tasks-item ${task.state}`}>
          <span className="tasks-ico" aria-hidden="true">{task.state === 'running' ? <span className="spin sm" /> : task.state === 'done' ? '✓' : '!'}</span>
          <span className="tasks-txt"><b>{task.title}</b>{task.detail && <small>{task.detail}</small>}{task.error && <small className="err">{task.error}</small>}</span>
          <span className="tasks-time">{task.state === 'running' ? elapsed(task, now) : task.state === 'done' ? `Concluído · ${elapsed(task, now)}` : `Falhou · ${elapsed(task, now)}`}</span>
          {task.state !== 'running' && <button type="button" className="x" aria-label="Remover da lista" onClick={() => tasks.dismiss(task.id)}>×</button>}
        </li>)}</ul>}
    </div>}
  </span>
}
