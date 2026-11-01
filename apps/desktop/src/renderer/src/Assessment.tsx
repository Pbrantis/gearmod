import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { complexityDimensions, type Assessment, type Card, type CardComplexity, type CardHistory, type DimensionScores, type RunMetric, type WorkflowKind } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { Markdown } from './markdown'
import { useEscape } from './useEscape'
import { dateLocale, tr, useT } from './i18n'

/** Indicador de complexidade (Kanban, editor e chat): só os pontos; ao passar o mouse desce um cartão com nível, fluxo, variação e confiança. `full` mostra tudo no próprio selo, como no editor do card. */
export function ComplexityBadge({ complexity, onClick, full = false }: { complexity: CardComplexity | null; onClick?(): void; full?: boolean }): React.JSX.Element | null {
  const tb = useT().board, t = tb.assessment
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null), button = useRef<HTMLButtonElement>(null)
  if (!complexity) return null
  const delta = complexity.delta, wf = complexity.workflow ?? complexity.recommended
  const show = (): void => {
    const rect = button.current?.getBoundingClientRect(); if (!rect) return
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 300)), below = window.innerHeight - rect.bottom
    setPos(below < 260 && rect.top > below ? { left, bottom: window.innerHeight - rect.top + 8 } : { left, top: rect.bottom + 8 })
  }
  return <button type="button" ref={button} className={`cx-badge ${complexity.level}`} aria-label={t.complexityAria(complexity.total, tb.levelLabels[complexity.level])} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)} onClick={(event) => { event.stopPropagation(); setPos(null); onClick?.() }}>
    <b>{complexity.preliminary ? '~' : ''}{complexity.total}</b>
    {full && <>{tb.levelLabels[complexity.level]}{delta !== null && delta !== 0 && <span className={`cx-delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>}<span className="cx-wf">{t.shortWorkflow[wf]}</span></>}
    {pos && createPortal(<span className="cx-pop" role="tooltip" style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}>
      <span className="cx-pop-head"><span className={`cx-pop-score ${complexity.level}`}>{complexity.preliminary ? '~' : ''}{complexity.total}</span><span className="cx-pop-title"><b>{tb.levelLabels[complexity.level]}</b><small>{t.complexityPoints}{complexity.preliminary ? ` · ${t.preliminary}` : ''}</small></span>
        {delta !== null && delta !== 0 && <span className={`cx-pop-delta ${delta > 0 ? 'up' : 'down'}`}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>}</span>
      <span className="cx-pop-rows">
        <span><small>{t.recommendedFlow}</small><b>{tb.workflowLabels[complexity.recommended]}</b></span>
        {complexity.workflow && <span><small>{t.chosenFlow}</small><b>{tb.workflowLabels[complexity.workflow]}</b></span>}
        <span><small>{t.confidence}</small><b>{tb.confidenceLabels[complexity.confidence]}</b></span>
        <span><small>{t.assessment}</small><b>v{complexity.version}</b></span>
      </span>
      <span className="cx-pop-foot">{t.clickForHistory}</span>
    </span>, document.body)}
  </button>
}

type Tab = 'avaliacao' | 'decisoes' | 'entendimento' | 'metricas' | 'eventos'

/** Histórico auditável do card: versões da avaliação, comparação, evidências, decisões, contestação e escolha do fluxo. */
export function AssessmentDialog({ card, close, changed }: { card: Card; close(): void; changed(): void }): React.JSX.Element {
  const { board: tb, common } = useT(), t = tb.assessment
  const [history, setHistory] = useState<CardHistory>(), [metrics, setMetrics] = useState<RunMetric[]>([]), [selected, setSelected] = useState<string>(), [tab, setTab] = useState<Tab>('avaliacao'), [error, setError] = useState(''), [contesting, setContesting] = useState(false)
  const load = async (): Promise<void> => {
    try { const [next, runs] = await Promise.all([window.agentboard.invoke('history:get', { cardId: card.id }), window.agentboard.invoke('metrics:card', { cardId: card.id })]); setHistory(next); setMetrics(runs) } catch (reason) { setError(plainError(reason)) }
  }
  const [specKit, setSpecKit] = useState<{ enabled: boolean; reason: string | null }>({ enabled: false, reason: t.specKitDisabled })
  useEffect(() => { void window.agentboard.invoke('speckit:availability', { projectId: card.projectId }).then(setSpecKit).catch(() => undefined) }, [card.projectId])
  useEffect(() => { void load() }, [card.id])
  useEscape(close)
  const apply = async (task: Promise<CardHistory>): Promise<void> => { try { setHistory(await task); setError(''); changed() } catch (reason) { setError(plainError(reason)) } }
  const assessments = history?.assessments ?? [], current = assessments.find((item) => item.id === selected) ?? assessments.at(-1)
  const previous = current ? assessments.find((item) => item.version === current.version - 1) : undefined
  return <div className="overlay top" role="dialog" aria-label={t.historyLabel} onClick={close}><div className="modal cx-dialog" onClick={(event) => event.stopPropagation()}>
    <header><div><div className="eyebrow">{t.eyebrow}</div><h2>{card.title || t.untitledCard}</h2></div><button type="button" className="x" onClick={close} aria-label={common.close}>×</button></header>
    <div className="cx-tabrow"><div className="tabs" role="tablist">{([['avaliacao', t.tabs.assessment], ['decisoes', t.tabs.decisions(history?.decisions.length ?? 0)], ['entendimento', t.tabs.understanding], ['metricas', t.tabs.metrics], ['eventos', t.tabs.events]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={`tab ${tab === value ? 'on' : ''}`} onClick={() => setTab(value)}>{label}</button>)}</div><button type="button" className="mini secondary cx-open" onClick={() => { void window.agentboard.invoke('history:open-folder', { cardId: card.id }).catch((reason) => setError(plainError(reason))) }}>{t.openArtifacts}</button></div>
    {error && <div className="cx-error" role="alert">{error}</div>}
    {!history ? <p className="cx-muted">{common.loading}</p> : <div className={`cx-body ${tab === 'decisoes' ? 'cx-body-decisions' : tab === 'eventos' ? 'cx-body-events' : ''}`}>
      {tab === 'avaliacao' && <div className="cx-grid">
        <aside className="cx-versions">{assessments.length ? [...assessments].reverse().map((item) => <button type="button" key={item.id} className={`cx-version ${item.id === current?.id ? 'on' : ''}`} onClick={() => { setSelected(item.id); setContesting(false) }}>
          <span className={`cx-dot ${item.level}`} /><b>v{item.version}</b><span>{item.preliminary ? '~' : ''}{item.total} {t.pts} · {tb.levelLabels[item.level]}</span><small>{tb.triggerLabels[item.trigger]} · {item.actor === 'user' ? t.you : item.model ?? item.provider ?? t.agentFallback}</small><small>{formatDate(item.createdAt)}</small>
        </button>) : <p className="cx-muted">{t.noAssessmentYet}</p>}</aside>
        <section className="cx-detail">{contesting || !current ? <ContestForm current={current} cancel={current ? () => setContesting(false) : undefined} submit={(scores, reason) => apply(window.agentboard.invoke('history:contest', { cardId: card.id, scores, reason }).then((next) => { setSelected(undefined); setContesting(false); return next }))} />
          : <AssessmentView item={current} previous={previous} latest={current.id === assessments.at(-1)?.id} history={history} specKit={specKit} contest={() => setContesting(true)} choose={(workflow, method) => apply(window.agentboard.invoke('history:select-workflow', { cardId: card.id, workflow, ...(method ? { method } : {}) }))} />}</section>
      </div>}
      {tab === 'decisoes' && <Decisions history={history} set={(decisionId, status) => apply(window.agentboard.invoke('history:set-decision', { decisionId, status }))} add={(statement) => apply(window.agentboard.invoke('history:add-decision', { cardId: card.id, kind: 'other', statement }))} />}
      {tab === 'entendimento' && <Understanding history={history} />}
      {tab === 'metricas' && <Metrics runs={metrics} simple={card.workflow === 'light'} />}
      {tab === 'eventos' && <Events history={history} rebuild={async () => { try { const result = await window.agentboard.invoke('history:rebuild', { cardId: card.id }); setError(t.rebuilt(result.events, result.assessments, result.decisions)); await load(); changed() } catch (reason) { setError(plainError(reason)) } }} />}
    </div>}
  </div></div>
}

function AssessmentView({ item, previous, latest, history, specKit, contest, choose }: { item: Assessment; previous?: Assessment; latest: boolean; history: CardHistory; specKit: { enabled: boolean; reason: string | null }; contest(): void; choose(workflow: WorkflowKind, method?: 'native' | 'speckit'): void }): React.JSX.Element {
  const tb = useT().board, t = tb.assessment
  const { workflow, sddMethod, recommendedSddMethod, sddMethodReason } = history
  const delta = previous ? item.total - previous.total : null
  return <>
    <div className="cx-summary">
      <div className={`cx-score ${item.level}`}><b>{item.total}</b><span>{tb.levelLabels[item.level]}{item.preliminary ? ` · ${t.preliminary}` : ''}</span></div>
      <div className="cx-facts">
        <div>{t.confidence} <b>{tb.confidenceLabels[item.confidence]}</b> · {t.evidenceCount(item.evidence.length)}{delta !== null && <> · <span className={delta > 0 ? 'cx-up' : delta < 0 ? 'cx-down' : ''}>{t.sinceVersion(delta, previous!.version)}</span></>}</div>
        <div>{item.actor === 'user' ? <b>{t.userCorrection}</b> : <>{t.agentRecommendation} <b>{[item.provider, item.model, item.effort].filter(Boolean).join(' · ') || t.agentFallback}</b></>} · {formatDate(item.createdAt)}</div>
        <div className="cx-muted">{tb.triggerLabels[item.trigger]}: {item.reason}</div>
        {item.codeVersion && <div className="cx-muted">{t.codeAnalyzed} <code>{item.codeVersion}</code></div>}
      </div>
    </div>
    <table className="cx-table cx-dimtable"><colgroup><col style={{ width: 130 }} /><col style={{ width: 120 }} /><col style={{ width: 54 }} /><col style={{ width: 64 }} /><col /></colgroup><thead><tr><th>{t.dimension}</th><th>{t.score}</th><th>{t.weight}</th><th>{t.points}</th><th>{t.justification}</th></tr></thead><tbody>
      {complexityDimensions.map((dimension) => { const before = previous?.scores[dimension], diff = before === undefined ? 0 : item.scores[dimension] - before
        return <tr key={dimension} className={diff ? 'changed' : ''}><td>{tb.dimensionLabels[dimension]}</td><td><Dots value={item.scores[dimension]} />{diff !== 0 && <span className={`cx-delta ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? `+${diff}` : diff}</span>}</td><td>×{item.weights[dimension]}</td><td>{item.scores[dimension] * item.weights[dimension]}</td><td>{item.justifications[dimension] || <span className="cx-muted">—</span>}</td></tr> })}
    </tbody></table>
    {item.criticalRisks.length > 0 && <div className="cx-risks"><b>{t.criticalRisks}</b><ul>{item.criticalRisks.map((risk) => <li key={risk}>{risk}</li>)}</ul></div>}
    {item.evidence.length > 0 && <div className="cx-evidence"><b>{t.evidence}</b><ul>{item.evidence.map((evidence, index) => <li key={index}><span className="cx-kind">{evidence.kind}</span><code>{evidence.ref}{evidence.line ? `:${evidence.line}` : ''}</code>{evidence.commit && <small> @ {evidence.commit}</small>}{evidence.detail && <span> — {evidence.detail}</span>}</li>)}</ul></div>}
    {latest && <div className="cx-flow">
      <div className="cx-flowhead"><b>{t.cardFlow}</b><span className="cx-muted">{t.cardFlowHint}</span></div>
      <div className="cx-flowstat"><span>{t.recommendedByAgent}</span><span className="cx-chip rec">{t.flowTitle[item.workflow]}</span><span className="cx-sep">·</span><span>{t.chosenByYou}</span>{workflow ? <span className={`cx-chip ${workflow === item.workflow ? 'ok' : 'diff'}`}>{t.flowTitle[workflow]}</span> : <span className="cx-muted">{t.notChosenYet}</span>}{workflow && workflow !== item.workflow && <span className="cx-warn">{t.differsFromRecommended}</span>}</div>
      <div className="cx-flowpick" role="radiogroup" aria-label={t.cardFlow}>{(['light', 'spec'] as const).map((value) => <button type="button" role="radio" aria-checked={workflow === value} key={value} className={`cx-opt ${workflow === value ? 'on' : ''}`} onClick={() => workflow !== value && choose(value)}><span className="cx-opt-t">{t.flowTitle[value]}{item.workflow === value && <em>{t.recommendedTag}</em>}</span><small>{t.flowAbout[value]}</small></button>)}{(['native', 'speckit'] as const).map((method) => <button type="button" role="radio" aria-checked={workflow === 'sdd' && sddMethod === method} key={method} disabled={method === 'speckit' && !specKit.enabled} data-tip={method === 'speckit' && !specKit.enabled ? specKit.reason ?? undefined : undefined} className={`cx-opt ${workflow === 'sdd' && sddMethod === method ? 'on' : ''}`} onClick={() => (workflow !== 'sdd' || sddMethod !== method) && choose('sdd', method)}><span className="cx-opt-t">{t.methodNames[method]}{item.workflow === 'sdd' && recommendedSddMethod === method && <em>{t.recommendedTag}</em>}</span><small>{t.methodAbout[method]}</small></button>)}</div>
      {(item.workflow === 'sdd' || workflow === 'sdd') && <div className="cx-flowmethod"><span>{t.methodForCard}</span>{sddMethod ? <span className="cx-chip ok">{t.methodNames[sddMethod]}</span> : <span className="cx-muted">{t.chooseMethod}</span>}{recommendedSddMethod && <span className="cx-muted">{t.aiRecommendation} {t.methodNames[recommendedSddMethod]}{sddMethodReason ? ` — ${sddMethodReason}` : ''}</span>}</div>}
      <div className="cx-flowfoot"><span className="cx-muted">{t.disagree}</span><button type="button" className="mini secondary" onClick={contest}>{t.contest}</button></div>
    </div>}
  </>
}

function ContestForm({ current, cancel, submit }: { current?: Assessment; cancel?(): void; submit(scores: DimensionScores, reason: string): Promise<void> }): React.JSX.Element {
  const { board: tb, common } = useT(), t = tb.assessment
  const [scores, setScores] = useState<DimensionScores>(() => current?.scores ?? { escopo: 1, acoplamento: 1, incerteza: 1, risco: 1, novidade: 0, validacao: 1 }), [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  const changed = useMemo(() => !current || complexityDimensions.some((dimension) => scores[dimension] !== current.scores[dimension]), [scores, current])
  return <form className="cx-contest" onSubmit={(event) => { event.preventDefault(); if (busy || !changed || !reason.trim()) return; setBusy(true); void submit(scores, reason.trim()).finally(() => setBusy(false)) }}>
    <h3>{current ? t.fixTitle(current.version) : t.registerTitle}</h3>
    <p className="cx-muted">{current ? t.fixHint : t.registerHint}</p>
    {complexityDimensions.map((dimension) => <label key={dimension} className="cx-slider"><span>{tb.dimensionLabels[dimension]}</span><span className="cx-pick">{[0, 1, 2, 3].map((value) => <button type="button" key={value} className={scores[dimension] === value ? 'on' : ''} onClick={() => setScores({ ...scores, [dimension]: value })}>{value}</button>)}</span>{current && current.scores[dimension] !== scores[dimension] && <small>{t.was(current.scores[dimension])}</small>}</label>)}
    <label className="cx-reason"><span className="cx-reason-label">{t.reasonLabel} <span>{t.required}</span></span><span className="cx-reason-hint">{t.reasonHint}</span><textarea className="in" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={4000} required placeholder={t.reasonPlaceholder} /></label>
    <div className="cx-actions">{cancel && <button type="button" className="mini secondary" onClick={cancel}>{common.cancel}</button>}<button type="submit" className="mini" disabled={busy || !changed || !reason.trim()}>{t.registerCorrection}</button></div>
  </form>
}

function Decisions({ history, set, add }: { history: CardHistory; set(id: string, status: 'approved' | 'superseded'): void; add(statement: string): void }): React.JSX.Element {
  const t = useT().board.assessment
  const [text, setText] = useState('')
  const labels = t.decisionStatus, kinds = t.decisionKinds
  const open = history.decisions.filter((item) => item.status === 'proposed').length
  return <div className="cx-decisions">
    <div className="cx-sechead"><h3>{t.cardDecisions}</h3><span className="cx-count">{history.decisions.length}</span>{open > 0 && <span className="cx-pill warn">{t.waitingForYou(open)}</span>}</div>
    {history.decisions.length ? <ul>{history.decisions.map((item) => <li key={item.id} className={item.status}>
      <span className="cx-num">D{String(item.number).padStart(3, '0')}</span>
      <div className="cx-dbody">
        <div className="cx-dtop"><span className={`cx-status ${item.status}`}>{labels[item.status]}</span><span className="cx-chip">{kinds[item.kind]}</span><small>{formatDate(item.createdAt)}</small></div>
        <p className="cx-statement">{item.statement}</p>{item.rationale && <p className="cx-muted">{item.rationale}</p>}
        {item.supersedesId && <p className="cx-muted">{item.status === 'proposed' ? t.willReplace : item.status === 'approved' ? t.replaced : t.proposedReplace} D{String(history.decisions.find((previous) => previous.id === item.supersedesId)?.number ?? '?').padStart(3, '0')}{': '}{history.decisions.find((previous) => previous.id === item.supersedesId)?.statement}</p>}
        {item.status === 'proposed' && <div className="cx-actions"><button type="button" className="mini" onClick={() => set(item.id, 'approved')}>{t.approve}</button><button type="button" className="mini secondary" onClick={() => set(item.id, 'superseded')}>{t.discard}</button></div>}
      </div></li>)}</ul> : <div className="cx-empty"><b>{t.noDecisions}</b><span>{t.noDecisionsHint}</span></div>}
    <form className="cx-add" onSubmit={(event) => { event.preventDefault(); if (text.trim()) { add(text.trim()); setText('') } }}><input value={text} onChange={(event) => setText(event.target.value)} placeholder={t.addDecisionPlaceholder} /><button type="submit" className="mini" disabled={!text.trim()}>{t.register}</button></form>
  </div>
}

function Understanding({ history }: { history: CardHistory }): React.JSX.Element {
  const t = useT().board.assessment
  const brief = history.discovery, exploration = history.exploration
  const list = (title: string, items: string[], tone = ''): React.JSX.Element | null => items.length ? <section className={`cx-card ${tone}`}><h4>{title}<span className="cx-count">{items.length}</span></h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section> : null
  return <div className="cx-brief">
    {brief ? <>
      <section className="cx-hero"><div className="cx-sechead"><h3>{t.objective}</h3><span className={`cx-pill ${brief.prontidao === 'pronto' ? 'ok' : 'warn'}`}>{brief.prontidao === 'pronto' ? t.readyToPlan : t.needsClarifying}</span>{brief.registradoEm && <small className="cx-muted">{formatDate(brief.registradoEm)}</small>}</div>
        <p>{brief.objetivo}</p>{brief.motivacao && <p className="cx-muted"><b>{t.motivation}</b> {brief.motivacao}</p>}</section>
      <div className="cx-cards">{list(t.scope, brief.escopo)}{list(t.outOfScope, brief.exclusoes, 'muted')}{list(t.acceptanceCriteria, brief.criterios, 'ok')}{list(t.pendingItems, brief.pendencias, 'warn')}</div>
      {brief.contextoTecnico && <section className="cx-card"><h4>{t.technicalContext}</h4><p>{brief.contextoTecnico}</p></section>}
    </> : <div className="cx-empty"><b>{t.noBrief}</b><span>{t.noBriefHint}</span></div>}
    {exploration && <section className="cx-card cx-exploration"><h4>{t.codeExploration} {exploration.stale ? <span className="cx-pill warn">{t.stale}</span> : <span className="cx-pill ok">{t.valid}</span>}</h4><div className="md cx-exploration-summary"><Markdown source={exploration.summary} runnable={false} /></div>{exploration.evidence.length > 0 && <><h4 className="cx-exploration-evidence-title">{t.evidence}</h4><ul>{exploration.evidence.map((item, index) => <li key={index}><code>{item.ref}{item.line ? `:${item.line}` : ''}</code>{item.detail && ` — ${item.detail}`}</li>)}</ul></>}</section>}
  </div>
}

const fmt = (value: number): string => value.toLocaleString(dateLocale())
const compact = (value: number): string => { const t = tr().board.assessment; return (value < 1000 ? String(value) : value < 1_000_000 ? `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}${t.thousandUnit}` : `${(value / 1_000_000).toFixed(1)}${t.millionUnit}`).replace('.', t.decimalSeparator) }
const seconds = (ms: number): string => ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1).replace('.', tr().board.assessment.decimalSeparator)} h`

function Metrics({ runs, simple }: { runs: RunMetric[]; simple: boolean }): React.JSX.Element {
  const t = useT().board.assessment
  const [view, setView] = useState<'dashboard' | 'tabela'>(() => { try { return localStorage.getItem('agentboard.metricsView') === 'tabela' ? 'tabela' : 'dashboard' } catch { return 'dashboard' } })
  const [runsOpen, setRunsOpen] = useState(false)
  const choose = (value: 'dashboard' | 'tabela'): void => { setView(value); try { localStorage.setItem('agentboard.metricsView', value) } catch { /* só conveniência */ } }
  if (!runs.length) return <div className="cx-empty"><b>{t.noRuns}</b><span>{t.noRunsHint}</span></div>
  const total = runs.reduce((sum, run) => ({ input: sum.input + run.input, cached: sum.cached + run.cached, output: sum.output + run.output, cost: sum.cost + (run.costUsd ?? 0), unknown: sum.unknown + (run.costUsd === null ? 1 : 0), ms: sum.ms + (run.durationMs ?? 0) }), { input: 0, cached: 0, output: 0, cost: 0, unknown: 0, ms: 0 })
  // Comparação honesta do Playwright CLI: média de tokens das execuções de teste com e sem ele (só quando há as duas).
  const tests = runs.filter((run) => run.purpose === 'test'), average = (items: RunMetric[]): number => Math.round(items.reduce((sum, run) => sum + run.input + run.output, 0) / items.length)
  const withCli = tests.filter((run) => run.usedPlaywrightCli), withoutCli = tests.filter((run) => !run.usedPlaywrightCli)
  const steps = ['planning', 'execution', 'test'].map((key) => { const items = runs.filter((run) => run.purpose === key); return { key, runs: items.length, input: items.reduce((s, r) => s + r.input, 0), output: items.reduce((s, r) => s + r.output, 0), cached: items.reduce((s, r) => s + r.cached, 0), ms: items.reduce((s, r) => s + (r.durationMs ?? 0), 0) } }).filter((step) => step.runs > 0)
  const singleAgent = simple && steps.length === 1 && steps[0]?.key !== 'test'
  const stepName = (purpose: string | null): string => singleAgent && purpose === steps[0]?.key ? t.agentFallbackTitle : (t.stepLabels as Record<string, string>)[purpose ?? ''] ?? purpose ?? '—'
  const biggest = Math.max(1, ...steps.map((step) => step.input + step.output))
  return <div className="cx-metrics">
    <div className="cx-sechead"><h3>{t.metricsTitle}</h3><span className="cx-count">{runs.length}</span><span className="cx-spacer" />
      <div className="cx-seg" role="tablist" aria-label={t.viewLabel}><button type="button" role="tab" aria-selected={view === 'dashboard'} className={view === 'dashboard' ? 'on' : ''} onClick={() => choose('dashboard')}>{t.dashboard}</button><button type="button" role="tab" aria-selected={view === 'tabela'} className={view === 'tabela' ? 'on' : ''} onClick={() => choose('tabela')}>{t.table}</button></div></div>
    <p className="cx-muted">{t.metricsNote}</p>
    {view === 'dashboard' ? <>
      <div className="cx-tiles">
        <div className="cx-tile"><span>{t.runs}</span><b>{runs.length}</b></div>
        <div className="cx-tile"><span>{t.tokensInOut}</span><b>{compact(total.input + total.output)}</b><small>{t.readWritten(compact(total.input), compact(total.output))}</small></div>
        <div className="cx-tile"><span>{t.cache}</span><b>{compact(total.cached)}</b><small>{t.cacheNote}</small></div>
        <div className="cx-tile"><span>{t.reportedCost}</span><b>{t.usd(total.cost.toFixed(2))}</b>{total.unknown > 0 && <small>{t.runsWithoutValue(total.unknown)}</small>}</div>
        <div className="cx-tile"><span>{t.runTime}</span><b>{seconds(total.ms)}</b></div>
      </div>
      <section className="cx-card"><h4>{t.tokensByStep}</h4>
        <div className="cx-bars">{steps.map((step) => <div className="cx-bar" key={step.key}><span className="cx-bl">{stepName(step.key)}<small>{t.runCount(step.runs)} · {seconds(step.ms)}</small></span>
          <div className="cx-track" data-tip={t.trackTip(fmt(step.input), fmt(step.output), fmt(step.cached))}><i className="in" style={{ width: `${(step.input / biggest) * 100}%` }} /><i className="out" style={{ width: `${(step.output / biggest) * 100}%` }} /></div>
          <b>{compact(step.input + step.output)}</b></div>)}</div>
        <div className="cx-legend"><span><i className="in" />{t.read}</span><span><i className="out" />{t.written}</span></div></section>
      <section className="cx-card"><h4><button type="button" className="cx-fold" aria-expanded={runsOpen} onClick={() => setRunsOpen(!runsOpen)}><span className="cx-chev">{runsOpen ? '▾' : '▸'}</span>{t.runs}<span className="cx-count">{runs.length}</span></button></h4>
        {runsOpen && <ul className="cx-runs">{[...runs].reverse().map((run) => <li key={run.runId}><span className={`cx-dot ${run.status === 'failed' ? 'complex' : run.status === 'running' ? 'medium' : 'simple'}`} />
          <div><b>{stepName(run.purpose)}</b>{run.usedPlaywrightCli && <span className="cx-kind" style={{ marginLeft: 6 }}>playwright-cli</span>}<small>{[run.provider, run.modelEffective && run.modelEffective !== run.model ? `${run.model} → ${run.modelEffective}` : run.model, run.effort].filter(Boolean).join(' · ') || '—'}</small></div>
          <span className="cx-run-n">{compact(run.input + run.output)}<small>{t.tokens}</small></span><span className="cx-run-n">{run.durationMs === null ? '—' : seconds(run.durationMs)}<small>{t.duration}</small></span><span className="cx-run-n">{run.costUsd === null ? '—' : t.usd(run.costUsd.toFixed(2))}<small>{t.cost}</small></span></li>)}</ul>}</section>
    </> : <div className="cx-tablewrap"><table className="cx-table cx-mtable"><thead><tr><th>{t.step}</th><th>{t.status}</th><th>{t.agentModel}</th><th>{t.effort}</th><th className="num">{t.durationHeader}</th><th className="num">{t.input}</th><th className="num">{t.cache}</th><th className="num">{t.output}</th><th className="num">{t.contextSent}</th><th className="num">{t.costHeader}</th></tr></thead><tbody>
      {runs.map((run) => <tr key={run.runId}><td>{stepName(run.purpose)}{run.usedPlaywrightCli && <span className="cx-kind" style={{ marginLeft: 6 }}>playwright-cli</span>}</td><td><span className={`cx-pill ${run.status === 'failed' ? 'bad' : run.status === 'running' ? 'warn' : 'ok'}`}>{run.status}</span></td><td>{[run.provider, run.modelEffective && run.modelEffective !== run.model ? `${run.model} → ${run.modelEffective}` : run.model].filter(Boolean).join(' · ') || '—'}</td><td>{run.effort ?? '—'}</td><td className="num">{run.durationMs === null ? '—' : seconds(run.durationMs)}</td><td className="num">{fmt(run.input)}</td><td className="num">{fmt(run.cached)}</td><td className="num">{fmt(run.output)}</td><td className="num">{run.promptChars === null ? '—' : t.chars(fmt(run.promptChars))}</td><td className="num">{run.costUsd === null ? <span className="cx-muted">{t.notReported}</span> : t.usd(run.costUsd.toFixed(4))}</td></tr>)}
      <tr className="cx-total"><td colSpan={5}>{t.total(runs.length)}</td><td className="num">{fmt(total.input)}</td><td className="num">{fmt(total.cached)}</td><td className="num">{fmt(total.output)}</td><td /><td className="num">{t.usd(total.cost.toFixed(4))}{total.unknown ? ` + ${t.withoutValue(total.unknown)}` : ''}</td></tr>
    </tbody></table></div>}
    {withCli.length > 0 && <p className="cx-muted">{t.playwrightCompare(withCli.length, fmt(average(withCli)), withoutCli.length, withoutCli.length ? fmt(average(withoutCli)) : '')}</p>}
  </div>
}

const artifactFiles = ['history.jsonl', 'discovery.md', 'implementation.md', 'verification.md'] as const
const artifactKeys = { 'history.jsonl': 'history', 'discovery.md': 'discovery', 'implementation.md': 'implementation', 'verification.md': 'verification' } as const
const eventTone = (type: string): string => /fail|error|erro|reject|recus/i.test(type) ? 'bad' : /approv|aprov|done|complet|finish|pass/i.test(type) ? 'ok' : /warn|stale|contest|propos/i.test(type) ? 'warn' : ''

function Events({ history, rebuild }: { history: CardHistory; rebuild(): void }): React.JSX.Element {
  const tb = useT().board, t = tb.assessment
  const [confirmRebuild, setConfirmRebuild] = useState(false)
  return <div className="cx-events">
    {confirmRebuild && <ConfirmDialog eyebrow={t.rebuildEyebrow} title={t.rebuildTitle} text={t.rebuildText} ok={t.rebuildOk} cancel={() => setConfirmRebuild(false)} confirm={() => { setConfirmRebuild(false); rebuild() }} />}
    <div className="cx-sechead"><h3>{t.tabs.events}</h3><span className="cx-count">{history.events.length}</span><span className="cx-spacer" /><button type="button" className="mini secondary" onClick={() => setConfirmRebuild(true)} data-tip={t.rebuildTip}>{t.rebuildTitle.replace(/\?$/, '')}</button></div>
    <section className="cx-card"><h4>{t.cardFiles}</h4>
      <div className="cx-files">{artifactFiles.map((name) => <span key={name} className="cx-file tip" data-tip={t.artifactAbout[artifactKeys[name]]}><span className="cx-fext">{name.split('.').pop()}</span><span>{name}</span></span>)}</div>
      <p className="cx-muted cx-path"><span>{t.liveIn}</span><code className="cx-pathchip" data-tip={history.artifactsDir}>{history.artifactsDir}</code><span>{t.enoughToRebuild}</span></p></section>
    {history.events.length ? <div className="cx-timeline-scroll" tabIndex={0} aria-label={t.eventList}><ol className="cx-timeline">{[...history.events].reverse().map((event) => <li key={event.id} className={eventTone(event.type)}><span className="cx-tdot" /><div><code>{event.type}</code><small>{formatDate(event.at)} · {event.source.actor === 'user' ? t.you : event.source.actor}</small></div></li>)}</ol></div> : <div className="cx-empty"><b>{t.noEvents}</b><span>{t.noEventsHint}</span></div>}
  </div>
}

function Dots({ value }: { value: number }): React.JSX.Element {
  const t = useT().board.assessment
  return <span className="cx-dots" aria-label={t.ofThree(value)}>{[1, 2, 3].map((index) => <i key={index} className={index <= value ? 'on' : ''} />)}</span>
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString(dateLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
