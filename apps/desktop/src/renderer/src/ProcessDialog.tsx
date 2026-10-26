import React, { useEffect } from 'react'
import { useTasks } from './backgroundTasks'

/**
 * Diálogo de andamento de um processo longo. Enquanto roda, "Acompanhar em segundo plano" fecha o diálogo e o processo segue
 * na lista da barra de título; ao terminar, mostra o resultado e o botão de fechar.
 */
export function ProcessDialog({ taskId, title, log, background, close }: { taskId: string; title: string; log?: string; background(): void; close(): void }): React.JSX.Element | null {
  const task = useTasks().find((item) => item.id === taskId)
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); if (task?.state === 'running') background(); else close() } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [task?.state, background, close])
  if (!task) return null
  const tail = (log ?? '').trim().split(/\r?\n/).slice(-10).join('\n')
  return <div className="overlay top" role="alertdialog" aria-label={title}><div className="modal" style={{ width: 'min(520px,100%)' }}>
    <header><div><div className="eyebrow">{task.state === 'running' ? 'Em andamento' : task.state === 'done' ? 'Concluído' : 'Falhou'}</div><h2>{title}</h2></div></header>
    <div className="stack" style={{ gap: 10 }}>
      <div className={`proc-state ${task.state}`}>{task.state === 'running' ? <><span className="spin" /> <span>{task.detail ? `${task.detail} · ` : ''}isso pode levar alguns minutos. Você pode continuar usando o app.</span></> : task.state === 'done' ? <span>✓ Tudo certo{task.detail ? ` em ${task.detail}` : ''}.</span> : <span className="error">{task.error ?? 'Não foi possível concluir.'}</span>}</div>
      {tail && <pre className="proc-log" aria-label="Últimas linhas do processo">{tail}</pre>}
    </div>
    <div className="actions">{task.state === 'running' ? <button type="button" onClick={background}>Acompanhar em segundo plano</button> : <button type="button" onClick={close}>Fechar</button>}</div>
  </div></div>
}
