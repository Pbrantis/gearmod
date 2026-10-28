import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { complexityDimensions, dimensionLabels, levelLabels, triggerLabels, workflowLabels, type Assessment, type Card, type CardComplexity, type CardHistory, type SddMethod, type DimensionScores, type RunMetric, type WorkflowKind } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { ConfirmDialog } from './ConfirmDialog'

const confidenceLabels = { low: 'baixa', medium: 'média', high: 'alta' } as const
const shortWorkflow: Record<WorkflowKind, string> = { light: 'curto', spec: 'spec leve', sdd: 'SDD' }
const flowTitle: Record<WorkflowKind, string> = { light: 'Fluxo curto', spec: 'Spec leve', sdd: 'SDD completo' }
const flowAbout: Record<WorkflowKind, string> = { light: 'Implementar e validar, sem documentos de planejamento.', spec: 'Especificação, Plano e Tasks enxutos.', sdd: 'Método completo de especificação do projeto.' }
const methodNames: Record<SddMethod, string> = { native: 'SDD do AgentBoard', openspec: 'OpenSpec', speckit: 'GitHub Spec Kit', custom: 'Método personalizado' }

/** Indicador de complexidade (Kanban, editor e chat): só os pontos; ao passar o mouse desce um cartão com nível, fluxo, variação e confiança. `full` mostra tudo no próprio selo, como no editor do card. */
export function ComplexityBadge({ complexity, onClick, full = false }: { complexity: CardComplexity | null; onClick?(): void; full?: boolean }): React.JSX.Element | null {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null), button = useRef<HTMLButtonElement>(null)
  if (!complexity) return null
  const delta = complexity.delta, wf = complexity.workflow ?? complexity.recommended
  const show = (): void => {
    const rect = button.current?.getBoundingClientRect(); if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 300)), below = window.innerHeight - rect.bottom
    setPos(below < 260 && rect.top > below ? { left, bottom: window.innerHeight - rect.top + 8 } : { left, top: rect.bottom + 8 })
  }
  return <button type="button" ref={button} className={`cx-badge ${complexity.level}`} aria-label={`Complexidade ${complexity.total} pontos, ${levelLabels[complexity.level]}`} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)} onClick={(event) => { event.stopPropagation(); setPos(null); onClick?.() }}>
    <b>{complexity.preliminary ? '~' : ''}{complexity.total}</b>
    {full && <>{levelLabels[complexity.level]}{delta !== null && delta !== 0 && <span className={`cx-delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>}<span className="cx-wf">{shortWorkflow[wf]}</span></>}
    {pos && createPortal(<span className="cx-pop" role="tooltip" style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}>
      <span className="cx-pop-head"><span className={`cx-pop-score ${complexity.level}`}>{complexity.preliminary ? '~' : ''}{complexity.total}</span><span className="cx-pop-title"><b>{levelLabels[complexity.level]}</b><small>pontos de complexidade{complexity.preliminary ? ' · preliminar' : ''}</small></span>
        {delta !== null && delta !== 0 && <span className={`cx-pop-delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>}</span>
      <span className="cx-pop-rows">
        <span><small>Fluxo recomendado</small><b>{workflowLabels[complexity.recommended]}</b></span>
        {complexity.workflow && <span><small>Fluxo escolhido</small><b>{workflowLabels[complexity.workflow]}</b></span>}
        <span><small>Confiança</small><b>{confidenceLabels[complexity.confidence]}</b></span>
        <span><small>Avaliação</small><b>v{complexity.version}</b></span>
      </span>
      <span className="cx-pop-foot">Clique para ver o histórico</span>
    </span>, document.body)}
  </button>
}

type Tab = 'avaliacao' | 'decisoes' | 'entendimento' | 'metricas' | 'eventos'

/** Histórico auditável do card: versões da avaliação, comparação, evidências, decisões, contestação e escolha do fluxo. */
export function AssessmentDialog({ card, close, changed }: { card: Card; close(): void; changed(): void }): React.JSX.Element {
  const [history, setHistory] = useState<CardHistory>(), [metrics, setMetrics] = useState<RunMetric[]>([]), [selected, setSelected] = useState<string>(), [tab, setTab] = useState<Tab>('avaliacao'), [error, setError] = useState(''), [contesting, setContesting] = useState(false), [method, setMethod] = useState<SddMethod>('native')
  const load = async (): Promise<void> => {
    try { const [next, runs] = await Promise.all([window.agentboard.invoke('history:get', { cardId: card.id }), window.agentboard.invoke('metrics:card', { cardId: card.id })]); setHistory(next); setMetrics(runs); void window.agentboard.invoke('workflow:get', { projectId: card.projectId }).then((state) => setMethod(state.config.complexMethod)).catch(() => undefined) } catch (reason) { setError(plainError(reason)) }
  }
  useEffect(() => { void load() }, [card.id])
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); close() } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [close])
  const apply = async (task: Promise<CardHistory>): Promise<void> => { try { setHistory(await task); setError(''); changed() } catch (reason) { setError(plainError(reason)) } }
  const assessments = history?.assessments ?? [], current = assessments.find((item) => item.id === selected) ?? assessments.at(-1)
  const previous = current ? assessments.find((item) => item.version === current.version - 1) : undefined
  return <div className="overlay top" role="dialog" aria-label="Histórico de avaliações" onClick={close}><div className="modal cx-dialog" onClick={(event) => event.stopPropagation()}>
    <header><div><div className="eyebrow">Complexidade e decisões</div><h2>{card.title || 'Card sem título'}</h2></div><button type="button" className="x" onClick={close} aria-label="Fechar">×</button></header>
    <div className="cx-tabrow"><div className="tabs" role="tablist">{([['avaliacao', 'Avaliação'], ['decisoes', `Decisões${history?.decisions.length ? ` (${history.decisions.length})` : ''}`], ['entendimento', 'Entendimento'], ['metricas', 'Métricas'], ['eventos', 'Eventos']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={`tab ${tab === value ? 'on' : ''}`} onClick={() => setTab(value)}>{label}</button>)}</div><button type="button" className="mini secondary cx-open" onClick={() => { void window.agentboard.invoke('history:open-folder', { cardId: card.id }).catch((reason) => setError(plainError(reason))) }}>Abrir artefatos</button></div>
    {error && <div className="cx-error" role="alert">{error}</div>}
    {!history ? <p className="cx-muted">Carregando…</p> : <div className={`cx-body ${tab === 'decisoes' ? 'cx-body-decisions' : ''}`}>
      {tab === 'avaliacao' && <div className="cx-grid">
        <aside className="cx-versions">{assessments.length ? [...assessments].reverse().map((item) => <button type="button" key={item.id} className={`cx-version ${item.id === current?.id ? 'on' : ''}`} onClick={() => { setSelected(item.id); setContesting(false) }}>
          <span className={`cx-dot ${item.level}`} /><b>v{item.version}</b><span>{item.preliminary ? '~' : ''}{item.total} pts · {levelLabels[item.level]}</span><small>{triggerLabels[item.trigger]} · {item.actor === 'user' ? 'você' : item.model ?? item.provider ?? 'agente'}</small><small>{formatDate(item.createdAt)}</small>
        </button>) : <p className="cx-muted">O agente ainda não avaliou este card. A avaliação aparece aqui quando o discovery ou o planejamento rodar; você também pode registrar uma.</p>}</aside>
        <section className="cx-detail">{contesting || !current ? <ContestForm current={current} cancel={current ? () => setContesting(false) : undefined} submit={(scores, reason) => apply(window.agentboard.invoke('history:contest', { cardId: card.id, scores, reason }).then((next) => { setSelected(undefined); setContesting(false); return next }))} />
          : <AssessmentView item={current} previous={previous} latest={current.id === assessments.at(-1)?.id} workflow={history.workflow} method={method} contest={() => setContesting(true)} choose={(workflow) => apply(window.agentboard.invoke('history:select-workflow', { cardId: card.id, workflow }))} />}</section>
      </div>}
      {tab === 'decisoes' && <Decisions history={history} set={(decisionId, status) => apply(window.agentboard.invoke('history:set-decision', { decisionId, status }))} add={(statement) => apply(window.agentboard.invoke('history:add-decision', { cardId: card.id, kind: 'other', statement }))} />}
      {tab === 'entendimento' && <Understanding history={history} />}
      {tab === 'metricas' && <Metrics runs={metrics} simple={card.type === 'minor'} />}
      {tab === 'eventos' && <Events history={history} rebuild={async () => { try { const result = await window.agentboard.invoke('history:rebuild', { cardId: card.id }); setError(`Reconstruído do history.jsonl: ${result.events} eventos, ${result.assessments} avaliações e ${result.decisions} decisões que faltavam no banco.`); await load(); changed() } catch (reason) { setError(plainError(reason)) } }} />}
    </div>}
  </div></div>
}

function AssessmentView({ item, previous, latest, workflow, method, contest, choose }: { item: Assessment; previous?: Assessment; latest: boolean; workflow: WorkflowKind | null; method: SddMethod; contest(): void; choose(workflow: WorkflowKind): void }): React.JSX.Element {
  const delta = previous ? item.total - previous.total : null
  return <>
    <div className="cx-summary">
      <div className={`cx-score ${item.level}`}><b>{item.total}</b><span>{levelLabels[item.level]}{item.preliminary ? ' · preliminar' : ''}</span></div>
      <div className="cx-facts">
        <div>Confiança <b>{confidenceLabels[item.confidence]}</b> · {item.evidence.length} evidência{item.evidence.length === 1 ? '' : 's'}{delta !== null && <> · <span className={delta > 0 ? 'cx-up' : delta < 0 ? 'cx-down' : ''}>{delta > 0 ? '+' : ''}{delta} desde v{previous!.version}</span></>}</div>
        <div>{item.actor === 'user' ? <b>Correção do usuário</b> : <>Recomendação do agente <b>{[item.provider, item.model, item.effort].filter(Boolean).join(' · ') || 'agente'}</b></>} · {formatDate(item.createdAt)}</div>
        <div className="cx-muted">{triggerLabels[item.trigger]}: {item.reason}</div>
        {item.codeVersion && <div className="cx-muted">Código analisado: <code>{item.codeVersion}</code></div>}
      </div>
    </div>
    <table className="cx-table cx-dimtable"><colgroup><col style={{ width: 130 }} /><col style={{ width: 120 }} /><col style={{ width: 54 }} /><col style={{ width: 64 }} /><col /></colgroup><thead><tr><th>Dimensão</th><th>Nota</th><th>Peso</th><th>Pontos</th><th>Justificativa</th></tr></thead><tbody>
      {complexityDimensions.map((dimension) => { const before = previous?.scores[dimension], diff = before === undefined ? 0 : item.scores[dimension] - before
        return <tr key={dimension} className={diff ? 'changed' : ''}><td>{dimensionLabels[dimension]}</td><td><Dots value={item.scores[dimension]} />{diff !== 0 && <span className={`cx-delta ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? `+${diff}` : diff}</span>}</td><td>×{item.weights[dimension]}</td><td>{item.scores[dimension] * item.weights[dimension]}</td><td>{item.justifications[dimension] || <span className="cx-muted">—</span>}</td></tr> })}
    </tbody></table>
    {item.criticalRisks.length > 0 && <div className="cx-risks"><b>Riscos críticos</b><ul>{item.criticalRisks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>}
    {item.evidence.length > 0 && <div className="cx-evidence"><b>Evidências</b><ul>{item.evidence.map((evidence, index) => <li key={index}><span className="cx-kind">{evidence.kind}</span><code>{evidence.ref}{evidence.line ? `:${evidence.line}` : ''}</code>{evidence.commit && <small> @ {evidence.commit}</small>}{evidence.detail && <span> — {evidence.detail}</span>}</li>)}</ul></div>}
    {latest && <div className="cx-flow">
      <div className="cx-flowhead"><b>Fluxo do card</b><span className="cx-muted">O agente recomenda um fluxo pela complexidade; a escolha final é sua.</span></div>
      <div className="cx-flowstat"><span>Recomendado pelo agente</span><span className="cx-chip rec">{flowTitle[item.workflow]}</span><span className="cx-sep">·</span><span>Escolhido por você</span>{workflow ? <span className={`cx-chip ${workflow === item.workflow ? 'ok' : 'diff'}`}>{flowTitle[workflow]}</span> : <span className="cx-muted">ainda não escolheu</span>}{workflow && workflow !== item.workflow && <span className="cx-warn">diferente do recomendado</span>}</div>
      <div className="cx-flowpick" role="radiogroup" aria-label="Fluxo do card">{(['light', 'spec', 'sdd'] as const).map((value) => <button type="button" role="radio" aria-checked={workflow === value} key={value} className={`cx-opt ${workflow === value ? 'on' : ''}`} onClick={() => workflow !== value && choose(value)}><span className="cx-opt-t">{flowTitle[value]}{item.workflow === value && <em>recomendado</em>}</span><small>{flowAbout[value]}</small></button>)}</div>
      {(item.workflow === 'sdd' || workflow === 'sdd') && <div className="cx-flowmethod"><span>Método do SDD</span><span className="cx-chip rec">{methodNames[method]}</span><span className="cx-muted">definido no projeto (Configurações › Workflow): SDD do AgentBoard, OpenSpec ou GitHub Spec Kit.</span></div>}
      <div className="cx-flowfoot"><span className="cx-muted">Não concorda com as notas?</span><button type="button" className="mini secondary" onClick={contest}>Contestar avaliação</button></div>
    </div>}
  </>
}

function ContestForm({ current, cancel, submit }: { current?: Assessment; cancel?(): void; submit(scores: DimensionScores, reason: string): Promise<void> }): React.JSX.Element {
  const [scores, setScores] = useState<DimensionScores>(() => current?.scores ?? { escopo: 1, acoplamento: 1, incerteza: 1, risco: 1, novidade: 0, validacao: 1 }), [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  const changed = useMemo(() => !current || complexityDimensions.some((dimension) => scores[dimension] !== current.scores[dimension]), [scores, current])
  return <form className="cx-contest" onSubmit={(event) => { event.preventDefault(); if (busy || !changed || !reason.trim()) return; setBusy(true); void submit(scores, reason.trim()).finally(() => setBusy(false)) }}>
    <h3>{current ? `Corrigir a avaliação v${current.version}` : 'Registrar uma avaliação'}</h3>
    <p className="cx-muted">{current ? 'A avaliação do agente continua no histórico; a sua vira uma versão nova, marcada como correção do usuário.' : 'Notas de 0 a 3 por dimensão; os pesos do projeto calculam a pontuação.'}</p>
    {complexityDimensions.map((dimension) => <label key={dimension} className="cx-slider"><span>{dimensionLabels[dimension]}</span><span className="cx-pick">{[0, 1, 2, 3].map((value) => <button type="button" key={value} className={scores[dimension] === value ? 'on' : ''} onClick={() => setScores({ ...scores, [dimension]: value })}>{value}</button>)}</span>{current && current.scores[dimension] !== scores[dimension] && <small>era {current.scores[dimension]}</small>}</label>)}
    <label className="cx-reason"><span className="cx-reason-label">Motivo da correção <span>Obrigatório</span></span><span className="cx-reason-hint">Explique o que mudou ou por que as notas precisam ser ajustadas. O motivo ficará registrado como evidência.</span><textarea className="in" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={4000} required placeholder="Ex.: o endpoint de notificações já existe no backend; o escopo é só no app." /></label>
    <div className="cx-actions">{cancel && <button type="button" className="mini secondary" onClick={cancel}>Cancelar</button>}<button type="submit" className="mini" disabled={busy || !changed || !reason.trim()}>Registrar correção</button></div>
  </form>
}

function Decisions({ history, set, add }: { history: CardHistory; set(id: string, status: 'approved' | 'superseded'): void; add(statement: string): void }): React.JSX.Element {
  const [text, setText] = useState('')
  const labels = { approved: 'Aprovada por você', proposed: 'Recomendação do agente', superseded: 'Substituída' } as const
  const open = history.decisions.filter((item) => item.status === 'proposed').length
  return <div className="cx-decisions">
    <div className="cx-sechead"><h3>Decisões do card</h3><span className="cx-count">{history.decisions.length}</span>{open > 0 && <span className="cx-pill warn">{open} esperando você</span>}</div>
    {history.decisions.length ? <ul>{history.decisions.map((item) => <li key={item.id} className={item.status}>
      <span className="cx-num">D{String(item.number).padStart(3, '0')}</span>
      <div className="cx-dbody">
        <div className="cx-dtop"><span className={`cx-status ${item.status}`}>{labels[item.status]}</span><span className="cx-chip">{item.kind}</span><small>{formatDate(item.createdAt)}</small></div>
        <p className="cx-statement">{item.statement}</p>{item.rationale && <p className="cx-muted">{item.rationale}</p>}
        {item.status === 'proposed' && <div className="cx-actions"><button type="button" className="mini" onClick={() => set(item.id, 'approved')}>Aprovar</button><button type="button" className="mini secondary" onClick={() => set(item.id, 'superseded')}>Descartar</button></div>}
      </div></li>)}</ul> : <div className="cx-empty"><b>Nenhuma decisão registrada ainda</b><span>As recomendações do agente e as suas decisões ficam aqui, com histórico.</span></div>}
    <form className="cx-add" onSubmit={(event) => { event.preventDefault(); if (text.trim()) { add(text.trim()); setText('') } }}><input value={text} onChange={(event) => setText(event.target.value)} placeholder="Registrar uma decisão sua (ex.: notificações só no Android por enquanto)" /><button type="submit" className="mini" disabled={!text.trim()}>Registrar</button></form>
  </div>
}

function Understanding({ history }: { history: CardHistory }): React.JSX.Element {
  const brief = history.discovery, exploration = history.exploration
  const list = (title: string, items: string[], tone = ''): React.JSX.Element | null => items.length ? <section className={`cx-card ${tone}`}><h4>{title}<span className="cx-count">{items.length}</span></h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section> : null
  return <div className="cx-brief">
    {brief ? <>
      <section className="cx-hero"><div className="cx-sechead"><h3>Objetivo</h3><span className={`cx-pill ${brief.prontidao === 'pronto' ? 'ok' : 'warn'}`}>{brief.prontidao === 'pronto' ? 'pronto para planejar' : 'precisa esclarecer'}</span>{brief.registradoEm && <small className="cx-muted">{formatDate(brief.registradoEm)}</small>}</div>
        <p>{brief.objetivo}</p>{brief.motivacao && <p className="cx-muted"><b>Motivação:</b> {brief.motivacao}</p>}</section>
      <div className="cx-cards">{list('Escopo', brief.escopo)}{list('Fora do escopo', brief.exclusoes, 'muted')}{list('Critérios de aceite', brief.criterios, 'ok')}{list('Pendências', brief.pendencias, 'warn')}</div>
      {brief.contextoTecnico && <section className="cx-card"><h4>Contexto técnico</h4><p>{brief.contextoTecnico}</p></section>}
    </> : <div className="cx-empty"><b>Sem entendimento registrado</b><span>O entendimento estruturado aparece aqui quando o agente registrar o discovery.</span></div>}
    {exploration && <section className="cx-card"><h4>Exploração do código {exploration.stale ? <span className="cx-pill warn">desatualizada (o código mudou)</span> : <span className="cx-pill ok">válida para o código atual</span>}</h4><p>{exploration.summary}</p>{exploration.evidence.length > 0 && <ul>{exploration.evidence.map((item, index) => <li key={index}><code>{item.ref}{item.line ? `:${item.line}` : ''}</code>{item.detail && ` — ${item.detail}`}</li>)}</ul>}</section>}
  </div>
}

const stepLabels: Record<string, string> = { planning: 'Planejamento', execution: 'Implementação', test: 'Teste' }
const fmt = (value: number): string => value.toLocaleString('pt-BR')
const compact = (value: number): string => (value < 1000 ? String(value) : value < 1_000_000 ? `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} mil` : `${(value / 1_000_000).toFixed(1)} mi`).replace('.', ',')
const seconds = (ms: number): string => ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1).replace('.', ',')} h`

function Metrics({ runs, simple }: { runs: RunMetric[]; simple: boolean }): React.JSX.Element {
  const [view, setView] = useState<'dashboard' | 'tabela'>(() => { try { return localStorage.getItem('agentboard.metricsView') === 'tabela' ? 'tabela' : 'dashboard' } catch { return 'dashboard' } })
  const [runsOpen, setRunsOpen] = useState(false)
  const choose = (value: 'dashboard' | 'tabela'): void => { setView(value); try { localStorage.setItem('agentboard.metricsView', value) } catch { /* só conveniência */ } }
  if (!runs.length) return <div className="cx-empty"><b>Nenhuma execução neste card ainda</b><span>As métricas aparecem quando um agente rodar.</span></div>
  const total = runs.reduce((sum, run) => ({ input: sum.input + run.input, cached: sum.cached + run.cached, output: sum.output + run.output, cost: sum.cost + (run.costUsd ?? 0), unknown: sum.unknown + (run.costUsd === null ? 1 : 0), ms: sum.ms + (run.durationMs ?? 0) }), { input: 0, cached: 0, output: 0, cost: 0, unknown: 0, ms: 0 })
  // Comparação honesta do Playwright CLI: média de tokens das execuções de teste com e sem ele (só quando há as duas).
  const tests = runs.filter((run) => run.purpose === 'test'), average = (items: RunMetric[]): number => Math.round(items.reduce((sum, run) => sum + run.input + run.output, 0) / items.length)
  const withCli = tests.filter((run) => run.usedPlaywrightCli), withoutCli = tests.filter((run) => !run.usedPlaywrightCli)
  const steps = ['planning', 'execution', 'test'].map((key) => { const items = runs.filter((run) => run.purpose === key); return { key, runs: items.length, input: items.reduce((s, r) => s + r.input, 0), output: items.reduce((s, r) => s + r.output, 0), cached: items.reduce((s, r) => s + r.cached, 0), ms: items.reduce((s, r) => s + (r.durationMs ?? 0), 0) } }).filter((step) => step.runs > 0)
  const singleAgent = simple && steps.length === 1 && steps[0]?.key !== 'test'
  const stepName = (purpose: string | null): string => singleAgent && purpose === steps[0]?.key ? 'Agente' : stepLabels[purpose ?? ''] ?? purpose ?? '—'
  const biggest = Math.max(1, ...steps.map((step) => step.input + step.output))
  return <div className="cx-metrics">
    <div className="cx-sechead"><h3>Métricas das execuções</h3><span className="cx-count">{runs.length}</span><span className="cx-spacer" />
      <div className="cx-seg" role="tablist" aria-label="Visualização"><button type="button" role="tab" aria-selected={view === 'dashboard'} className={view === 'dashboard' ? 'on' : ''} onClick={() => choose('dashboard')}>Dashboard</button><button type="button" role="tab" aria-selected={view === 'tabela'} className={view === 'tabela' ? 'on' : ''} onClick={() => choose('tabela')}>Tabela</button></div></div>
    <p className="cx-muted">Só o que cada agente informou. Custo "não informado" quando o provedor não manda o valor (o Codex não informa; o Claude informa o custo de cada execução). Tokens do cache ficam separados para não contar duas vezes.</p>
    {view === 'dashboard' ? <>
      <div className="cx-tiles">
        <div className="cx-tile"><span>Execuções</span><b>{runs.length}</b></div>
        <div className="cx-tile"><span>Tokens (entrada + saída)</span><b>{compact(total.input + total.output)}</b><small>{compact(total.input)} lidos · {compact(total.output)} escritos</small></div>
        <div className="cx-tile"><span>Cache</span><b>{compact(total.cached)}</b><small>leitura barata, fora da conta</small></div>
        <div className="cx-tile"><span>Custo informado</span><b>US$ {total.cost.toFixed(2)}</b>{total.unknown > 0 && <small>+ {total.unknown} execução(ões) sem valor</small>}</div>
        <div className="cx-tile"><span>Tempo de execução</span><b>{seconds(total.ms)}</b></div>
      </div>
      <section className="cx-card"><h4>Tokens por etapa</h4>
        <div className="cx-bars">{steps.map((step) => <div className="cx-bar" key={step.key}><span className="cx-bl">{stepName(step.key)}<small>{step.runs} {step.runs === 1 ? 'execução' : 'execuções'} · {seconds(step.ms)}</small></span>
          <div className="cx-track" title={`${fmt(step.input)} lidos · ${fmt(step.output)} escritos · ${fmt(step.cached)} do cache`}><i className="in" style={{ width: `${(step.input / biggest) * 100}%` }} /><i className="out" style={{ width: `${(step.output / biggest) * 100}%` }} /></div>
          <b>{compact(step.input + step.output)}</b></div>)}</div>
        <div className="cx-legend"><span><i className="in" />lidos</span><span><i className="out" />escritos</span></div></section>
      <section className="cx-card"><h4><button type="button" className="cx-fold" aria-expanded={runsOpen} onClick={() => setRunsOpen(!runsOpen)}><span className="cx-chev">{runsOpen ? '▾' : '▸'}</span>Execuções<span className="cx-count">{runs.length}</span></button></h4>
        {runsOpen && <ul className="cx-runs">{[...runs].reverse().map((run) => <li key={run.runId}><span className={`cx-dot ${run.status === 'failed' ? 'complex' : run.status === 'running' ? 'medium' : 'simple'}`} />
          <div><b>{stepName(run.purpose)}</b>{run.usedPlaywrightCli && <span className="cx-kind" style={{ marginLeft: 6 }}>playwright-cli</span>}<small>{[run.provider, run.model, run.effort].filter(Boolean).join(' · ') || '—'}</small></div>
          <span className="cx-run-n">{compact(run.input + run.output)}<small>tokens</small></span><span className="cx-run-n">{run.durationMs === null ? '—' : seconds(run.durationMs)}<small>duração</small></span><span className="cx-run-n">{run.costUsd === null ? '—' : `US$ ${run.costUsd.toFixed(2)}`}<small>custo</small></span></li>)}</ul>}</section>
    </> : <div className="cx-tablewrap"><table className="cx-table cx-mtable"><thead><tr><th>Etapa</th><th>Status</th><th>Agente / modelo</th><th>Esforço</th><th className="num">Duração</th><th className="num">Entrada</th><th className="num">Cache</th><th className="num">Saída</th><th className="num">Contexto enviado</th><th className="num">Custo</th></tr></thead><tbody>
      {runs.map((run) => <tr key={run.runId}><td>{stepName(run.purpose)}{run.usedPlaywrightCli && <span className="cx-kind" style={{ marginLeft: 6 }}>playwright-cli</span>}</td><td><span className={`cx-pill ${run.status === 'failed' ? 'bad' : run.status === 'running' ? 'warn' : 'ok'}`}>{run.status}</span></td><td>{[run.provider, run.model].filter(Boolean).join(' · ') || '—'}</td><td>{run.effort ?? '—'}</td><td className="num">{run.durationMs === null ? '—' : seconds(run.durationMs)}</td><td className="num">{fmt(run.input)}</td><td className="num">{fmt(run.cached)}</td><td className="num">{fmt(run.output)}</td><td className="num">{run.promptChars === null ? '—' : `${fmt(run.promptChars)} caract.`}</td><td className="num">{run.costUsd === null ? <span className="cx-muted">não informado</span> : `US$ ${run.costUsd.toFixed(4)}`}</td></tr>)}
      <tr className="cx-total"><td colSpan={5}>Total ({runs.length} execuções)</td><td className="num">{fmt(total.input)}</td><td className="num">{fmt(total.cached)}</td><td className="num">{fmt(total.output)}</td><td /><td className="num">US$ {total.cost.toFixed(4)}{total.unknown ? ` + ${total.unknown} sem valor` : ''}</td></tr>
    </tbody></table></div>}
    {withCli.length > 0 && <p className="cx-muted">Testes com Playwright CLI: {withCli.length} execução(ões), média de {fmt(average(withCli))} tokens{withoutCli.length ? `; sem ele: ${withoutCli.length}, média de ${fmt(average(withoutCli))} tokens. A diferença depende do que cada teste verificou; compare cards parecidos.` : '. Ainda não há teste sem ele neste card para comparar.'}</p>}
  </div>
}

const artifactFiles = [['history.jsonl', 'linha do tempo de tudo o que aconteceu'], ['discovery.md', 'entendimento do card'], ['implementation.md', 'o que foi implementado'], ['verification.md', 'o que foi verificado']] as const
const eventTone = (type: string): string => /fail|error|erro|reject|recus/i.test(type) ? 'bad' : /approv|aprov|done|complet|finish|pass/i.test(type) ? 'ok' : /warn|stale|contest|propos/i.test(type) ? 'warn' : ''

function Events({ history, rebuild }: { history: CardHistory; rebuild(): void }): React.JSX.Element {
  const [confirmRebuild, setConfirmRebuild] = useState(false)
  return <div className="cx-events">
    {confirmRebuild && <ConfirmDialog eyebrow="Reconstruir" title="Reconstruir do history.jsonl?" text="Recria no banco as avaliações e decisões que estiverem faltando, a partir do arquivo history.jsonl. O que já existe no banco não é apagado, mas vale conferir o resultado depois." ok="Reconstruir" cancel={() => setConfirmRebuild(false)} confirm={() => { setConfirmRebuild(false); rebuild() }} />}
    <div className="cx-sechead"><h3>Eventos</h3><span className="cx-count">{history.events.length}</span><span className="cx-spacer" /><button type="button" className="mini secondary" onClick={() => setConfirmRebuild(true)} title="Recria avaliações e decisões que faltarem no banco, a partir do history.jsonl">Reconstruir do history.jsonl</button></div>
    <section className="cx-card"><h4>Arquivos do card</h4>
      <div className="cx-files">{artifactFiles.map(([name, about]) => <span key={name} className="cx-file tip" data-tip={about}><span className="cx-fext">{name.split('.').pop()}</span><span>{name}</span></span>)}</div>
      <p className="cx-muted cx-path"><span>Ficam em</span><code className="cx-pathchip" title={history.artifactsDir}>{history.artifactsDir}</code><span>Bastam para reconstruir avaliações e decisões sem o banco. Use "Abrir artefatos" para ver a pasta.</span></p></section>
    {history.events.length ? <ol className="cx-timeline">{[...history.events].reverse().map((event) => <li key={event.id} className={eventTone(event.type)}><span className="cx-tdot" /><div><code>{event.type}</code><small>{formatDate(event.at)} · {event.source.actor === 'user' ? 'você' : event.source.actor}</small></div></li>)}</ol> : <div className="cx-empty"><b>Sem eventos ainda</b><span>Cada ação do card entra aqui.</span></div>}
  </div>
}

function Dots({ value }: { value: number }): React.JSX.Element {
  return <span className="cx-dots" aria-label={`${value} de 3`}>{[1, 2, 3].map((index) => <i key={index} className={index <= value ? 'on' : ''} />)}</span>
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
