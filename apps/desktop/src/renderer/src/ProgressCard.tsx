import React, { useCallback, useEffect, useState } from 'react'
import type { CardChecklist } from '@agentboard/contracts'
import { checklistKey } from '@agentboard/contracts'
import { InlineMarkdown } from './markdown'
import { checklistEvent, toggleChecklist } from './checklistToggle'
import { MarkBadges } from './MarkBadges'
import { plainError } from './NoticeDialog'
import { useT } from './i18n'

interface Criterion { text: string; done: boolean; line: number }
interface Task { key: string; line: number; text: string; done: boolean; criteria: Criterion[]; group: string | null }

const topItem = /^[-*+]\s+\[( |x|X)\]\s+(.*)$/, subItem = /^\s+[-*+]\s+\[( |x|X)\]\s+(.*)$/, heading = /^#{1,6}\s+(.*)$/

/** Tasks (itens de primeiro nível) com os critérios recuados dentro de cada uma; títulos `###` viram o grupo (fase) das tasks seguintes. */
export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = []
  let group: string | null = null
  markdown.split(/\r?\n/).forEach((line, index) => {
    const title = heading.exec(line)
    // O título do próprio documento ("## Tasks") não é uma fase.
    if (title) { group = /^tasks$/i.test(title[1]!.trim()) ? null : title[1]!.trim(); return }
    const top = topItem.exec(line)
    if (top) { tasks.push({ key: `${index}`, line: index, text: top[2]!.trim(), done: top[1] !== ' ', criteria: [], group }); return }
    const sub = subItem.exec(line)
    if (sub && tasks.length) tasks[tasks.length - 1]!.criteria.push({ text: sub[2]!.trim(), done: sub[1] !== ' ', line: index })
  })
  return tasks
}

const CheckMark = (): React.JSX.Element => <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5" /></svg>

/**
 * Progresso ao lado do chat: na implementação, as Tasks do card (o agente marca tasks e critérios conforme termina);
 * no teste, o checklist que o testador monta e vai marcando. Cada task é um mini card; ao expandir, mostra os critérios.
 * Atualiza sozinho quando o agente grava.
 */
export function ProgressCard({ cardId, purpose }: { cardId: string; purpose: 'execution' | 'test' }): React.JSX.Element | null {
  const t = useT().board
  const [source, setSource] = useState<string>(), [open, setOpen] = useState(true), [toggled, setToggled] = useState<Record<string, boolean>>({}), [marks, setMarks] = useState<CardChecklist['marks']>({}), [problem, setProblem] = useState('')
  const load = useCallback(async () => {
    try {
      if (purpose === 'test') { const checklist = await window.agentboard.invoke('cards:checklist', { cardId }); setSource(checklist.contentMd); setMarks(checklist.marks) }
      else setSource((await window.agentboard.invoke('cards:documents', { cardId })).tasks.contentMd)
    } catch { /* painel é informativo */ }
  }, [cardId, purpose])
  useEffect(() => { const received = (event: Event): void => { const next = (event as CustomEvent<CardChecklist>).detail; if (next.cardId === cardId && purpose === 'test') { setSource(next.contentMd); setMarks(next.marks) } }; window.addEventListener(checklistEvent, received); return () => window.removeEventListener(checklistEvent, received) }, [cardId, purpose])
  // Só o checklist do teste é clicável; as Tasks da implementação continuam sendo marcadas pelo agente.
  const interactive = purpose === 'test'
  const flip = (line: number, text: string, checked: boolean): void => { setProblem(''); void toggleChecklist(cardId, line, text, checked).catch((reason: unknown) => { setProblem(plainError(reason)); void load() }) }
  const by = (text: string, done: boolean): React.ReactNode => (interactive ? <MarkBadges mark={marks[checklistKey(text)]} checked={done} /> : null)
  useEffect(() => { void load() }, [load])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (event.eventType === 'agentboard/card-updated' && event.payload.cardId === cardId) void load() }), [cardId, load])
  if (source === undefined) return null
  const tasks = parseTasks(source), done = tasks.filter((task) => task.done).length, title = purpose === 'test' ? t.progress.testChecklist : t.progress.tasks
  if (!tasks.length && purpose === 'execution') return null
  // A task em andamento (a primeira não concluída) começa aberta; as outras, fechadas. O clique do usuário vence.
  const current = tasks.find((task) => !task.done)?.key
  const expanded = (task: Task): boolean => toggled[task.key] ?? task.key === current
  return <aside className={`progress ${open ? 'open' : ''}`} aria-label={title}>
    <div className="ch-head">
      <button type="button" className="ch-title" aria-expanded={open} onClick={() => setOpen(!open)}>{title}<span className="chev chev-box" aria-hidden="true"><svg className="chev-svg" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg></span></button>
      {tasks.length > 0 && <span className="pg-count">{done}/{tasks.length}</span>}
    </div>
    {tasks.length > 0 && <span className="pg-bar"><i style={{ width: `${Math.round((done / tasks.length) * 100)}%` }} /></span>}
    {open && <div className="pg-body">{tasks.length ? tasks.map((task, index) => {
      const met = task.criteria.filter((item) => item.done).length, started = !task.done && met > 0, isOpen = task.criteria.length > 0 && expanded(task)
      return <React.Fragment key={task.key}>
        {task.group && task.group !== tasks[index - 1]?.group && <div className="pg-group">{task.group}</div>}
        <div className={`pg-task ${task.done ? 'done' : started ? 'doing' : ''} ${task.key === current ? 'current' : ''} ${isOpen ? 'expanded' : ''}`}>
          {interactive ? <div className="pg-row split">
            <button type="button" className="pg-markbtn" role="checkbox" aria-checked={task.done} aria-label={task.done ? t.testChecklist.uncheckItem(task.text) : t.testChecklist.checkItem(task.text)} data-tip={task.done ? t.testChecklist.uncheckTip : t.testChecklist.checkTip} onClick={() => flip(task.line, task.text, !task.done)}><span className="pg-mark">{task.done && <CheckMark />}</span></button>
            <button type="button" className="pg-rowmain" disabled={!task.criteria.length} aria-expanded={task.criteria.length ? isOpen : undefined} onClick={() => setToggled({ ...toggled, [task.key]: !isOpen })}>
              <span className="pg-text"><InlineMarkdown text={task.text} /></span>{by(task.text, task.done)}
              {task.criteria.length > 0 && <span className="pg-meta">{met}/{task.criteria.length}<span className="chev chev-box" aria-hidden="true"><svg className="chev-svg" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg></span></span>}
            </button>
          </div> : <button type="button" className="pg-row" disabled={!task.criteria.length} aria-expanded={task.criteria.length ? isOpen : undefined} onClick={() => setToggled({ ...toggled, [task.key]: !isOpen })}>
            <span className="pg-mark" aria-label={task.done ? t.progress.completed : started ? t.progress.inProgress : t.progress.toDo}>{task.done && <CheckMark />}</span>
            <span className="pg-text"><InlineMarkdown text={task.text} /></span>
            {task.criteria.length > 0 && <span className="pg-meta">{met}/{task.criteria.length}<span className="chev chev-box" aria-hidden="true"><svg className="chev-svg" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg></span></span>}
          </button>}
          {isOpen && <ul className="pg-criteria">{task.criteria.map((item, position) => <li key={position} className={`pg-crit ${item.done ? 'done' : ''}`}>{interactive ? <button type="button" className="pg-mark sm btn" role="checkbox" aria-checked={item.done} aria-label={item.done ? t.testChecklist.uncheckItem(item.text) : t.testChecklist.checkItem(item.text)} data-tip={item.done ? t.testChecklist.uncheckTip : t.testChecklist.checkTip} onClick={() => flip(item.line, item.text, !item.done)}>{item.done && <CheckMark />}</button> : <span className="pg-mark sm">{item.done && <CheckMark />}</span>}<span className="pg-text"><InlineMarkdown text={item.text} /></span>{by(item.text, item.done)}</li>)}</ul>}
        </div>
      </React.Fragment>
    }) : <p className="hint">{t.progress.testerHint}</p>}{problem && <p className="hint err" role="alert">{problem}</p>}</div>}
  </aside>
}
