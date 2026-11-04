import React, { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentProfile, Card, SpecKitState } from '@gearmod/contracts'
import { plainError } from './NoticeDialog'
import { StartDialog } from './StartDialog'
import { useT } from './i18n'

/** Card Spec Kit state (chosen permission, pending cards and real artifacts); reloads with the card's events. */
export function useSpecKit(cardId: string): { state: SpecKitState | null; reload(): Promise<void> } {
  const [state, setState] = useState<SpecKitState | null>(null)
  const reload = useCallback(async (): Promise<void> => { if (!cardId) return setState(null); try { setState(await window.gearmod.invoke('speckit:state', { cardId })) } catch { setState(null) } }, [cardId])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => window.gearmod.onRunEvent((event) => { if (['gearmod/card-updated', 'gearmod/run-completed'].includes(event.eventType)) void reload() }), [reload])
  return { state, reload }
}

/** Planning chat mode control: with Spec Kit shows the chosen permission (and lets you change it); without it, the usual "Plan only". */
export function SpecKitModeChip({ cardId, spec, reload }: { cardId: string; spec: SpecKitState | null; reload(): Promise<void> }): React.JSX.Element {
  const t = useT().board.specKit
  const [open, setOpen] = useState(false), [error, setError] = useState('')
  if (!spec?.active || !spec.permission) return <span className="mode tip" data-tip={t.noFilesTip}>{t.planOnly}</span>
  const choose = async (permission: 'manual' | 'free'): Promise<void> => { try { await window.gearmod.invoke('speckit:choose', { cardId, permission }); setError(''); setOpen(false); await reload() } catch (reason) { setError(plainError(reason)) } }
  return <span className="modewrap"><button type="button" className="mode tip" data-tip={spec.texts?.[spec.permission] ?? t.skillsPermission} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{t.chip(t.permission[spec.permission])}</button>
    {open && <div className="modemenu" role="menu"><div className="mm-title">{t.skillsPermission}</div>
      {(['manual', 'free'] as const).map((value) => <button type="button" role="menuitemradio" aria-checked={spec.permission === value} key={value} className={`mm-item ${spec.permission === value ? 'on' : ''}`} onClick={() => void choose(value)}><b>{t.permission[value]}</b><small>{spec.texts?.[value]}</small></button>)}
      {error && <p className="error">{error}</p>}</div>}</span>
}

/** Spec Kit cards in the chat: permission choice (before the 1st skill), move to implement, and confirmation in the implementation chat. */
export function SpecKitAsks({ card, spec, reload, mode, profiles, onStarted, runNext, onSwitch, busy: chatBusy, dockHost }: { dockHost?: HTMLElement | null; card: Card; spec: SpecKitState | null; reload(): Promise<void>; mode: 'planning' | 'execution' | 'test'; profiles: AgentProfile[]; onStarted(): void; runNext?(prompt: string): void; onSwitch?(mode: 'planning' | 'execution' | 'test'): void; busy?: boolean }): React.JSX.Element | null {
  const { board: tb, common } = useT(), t = tb.specKit
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [starting, setStarting] = useState(false), [column, setColumn] = useState('')
  const working = busy
  // The next-steps card disappears as soon as a step is requested and only returns when the agent finishes without having advanced.
  const [sent, setSent] = useState(false), [artMin, setArtMin] = useState(() => { try { return localStorage.getItem('gearmod.speckit.dock.min') === '1' } catch { return false } })
  const toggleMin = (): void => { setArtMin(!artMin); try { localStorage.setItem('gearmod.speckit.dock.min', artMin ? '0' : '1') } catch { /* local preference */ } }
  useEffect(() => { if (!chatBusy) setSent(false) }, [chatBusy])
  useEffect(() => { setSent(false) }, [spec?.artifacts?.spec, spec?.artifacts?.plan, spec?.artifacts?.tasks])
  const moveId = spec?.moveRequestId ?? null
  const art = spec?.artifacts, phase: Array<{ id: string; optional?: boolean }> = !art || !art.spec ? [] : !art.plan ? [{ id: 'clarify', optional: true }, { id: 'plan' }] : !art.tasks ? [{ id: 'checklist', optional: true }, { id: 'tasks' }] : [{ id: 'analyze', optional: true }, { id: 'implement' }]
  useEffect(() => { if (!moveId) return; void window.gearmod.invoke('approvals:list', { cardId: card.id }).then((items) => { const found = items.find((item) => item.id === moveId); setColumn(String(found?.payload.columnLabel ?? '')) }).catch(() => undefined) }, [moveId, card.id])
  const startId = spec?.startRequestId ?? null
  useEffect(() => { if (mode === 'execution' && startId) setStarting(true) }, [mode, startId])
  if (!spec?.active) return null
  const run = async (task: () => Promise<unknown>): Promise<void> => { setBusy(true); setError(''); try { await task(); await reload() } catch (reason) { setError(plainError(reason)); await reload() } finally { setBusy(false) } }
  const pickPermission = (permission: 'manual' | 'free'): Promise<void> => run(() => window.gearmod.invoke('speckit:choose', { cardId: card.id, permission }))
  const decide = (approve: boolean, note?: string): Promise<void> => run(async () => { await window.gearmod.invoke('approvals:decide', { id: moveId!, approve, note }); if (approve && note === 'move-and-implement') onSwitch?.('execution') })
  const texts = spec.texts ?? { manual: t.defaultManualText, free: t.defaultFreeText }
  return <>
    {!spec.enabled && <div className="cask"><div className="cgprop-h"><b>{t.notConfigured}</b></div><p className="cgprop-msg">{spec.reason}</p></div>}
    {spec.enabled && mode === 'planning' && !spec.permission && <div className="cask" role="group" aria-label={t.skillsPermission}>
      <div className="cgprop-h"><b>{t.howCanWrite}</b><small>{t.chooseBeforeFirst}</small></div>
      <p className="cgprop-msg">{t.writeExplain}</p>
      <p className="cgprop-msg"><b>{t.permission.manual}:</b> {texts.manual}</p><p className="cgprop-msg"><b>{t.permission.free}:</b> {texts.free}</p>
      {error && <p className="error">{error}</p>}
      <div className="cgrow"><button type="button" className="mini secondary" disabled={busy} onClick={() => void pickPermission('manual')}>{t.permission.manual}</button><span className="grow1" /><button type="button" className="mini" disabled={busy} onClick={() => void pickPermission('free')}>{t.permission.free}</button></div>
    </div>}
    {mode === 'planning' && spec.artifacts && (spec.artifacts.spec || spec.artifacts.plan || spec.artifacts.tasks) && dockHost && !chatBusy && !working && !sent && !moveId && createPortal(<div className={`cask skdock${artMin ? ' min' : ''}`}>
      <button type="button" className="skdock-toggle" aria-expanded={!artMin} data-tip={artMin ? t.showArtifacts : t.minimize} onClick={toggleMin}><b>{t.artifactsTitle}</b>{!artMin && <small className="skdock-dir">{spec.artifacts.featureDir}</small>}<span className="skdock-chev" aria-hidden="true" /></button>
      {!artMin && <div className="skdock-in">
        <ul className="skart" aria-label={t.featureArtifacts}>{([['spec', t.artifactNames.spec], ['plan', t.artifactNames.plan], ['tasks', t.artifactNames.tasks]] as const).map(([key, label]) => <li key={key} className={spec.artifacts![key] ? 'ok' : ''}><span className="skart-mark" aria-hidden="true">{spec.artifacts![key] ? '✓' : ''}</span><span className="skart-name"><b>{label}</b><small>{key}.md</small></span><em>{spec.artifacts![key] ? t.generated : t.pending}</em></li>)}</ul>
        <p className="cgprop-msg skart-note">{spec.artifacts.ready ? t.planningReady : t.realFilesNote}</p>
        {phase.length > 0 && spec.permission && runNext && !moveId && <div className="cgrow">{phase.map((step) => <button type="button" key={step.id} className={step.optional ? 'mini secondary' : 'mini'} disabled={busy || working} onClick={() => step.id === 'implement' ? void run(() => window.gearmod.invoke('speckit:request-move', { cardId: card.id })) : (setSent(true), runNext(`${spec.provider === 'codex' ? '$' : '/'}speckit-${step.id}`))}>{step.id === 'implement' ? t.implement : step.optional ? t.optionalStep(step.id) : t.nextStep(step.id)}</button>)}</div>}
      </div>}
    </div>, dockHost)}
    {mode === 'planning' && moveId && <div className="cask" role="group" aria-label={t.moveAria}>
      <div className="cgprop-h"><b>{t.moveTitle}</b><small>{t.asksApproval}</small></div>
      <p className="cgprop-msg">{t.moveText(column)}</p>
      {error && <p className="error">{error}</p>}
      <div className="cgrow"><button type="button" className="mini" disabled={busy} onClick={() => void decide(true, 'move-and-implement')}>{t.moveAndImplement}</button><button type="button" className="mini secondary" disabled={busy} onClick={() => void decide(true, 'move-only')}>{t.moveOnly}</button><span className="grow1" /><button type="button" className="mini secondary" disabled={busy} onClick={() => void decide(false)}>{common.cancel}</button></div>
    </div>}
    {mode === 'execution' && spec.startRequestId && <div className="cask" role="group" aria-label={t.execAria}>
      <div className="cgprop-h"><b>{t.execTitle}</b><small>{t.execHint}</small></div>
      <p className="cgprop-msg">{t.execText}</p>
      <div className="cgrow"><button type="button" className="mini" onClick={() => setStarting(true)}>{t.chooseAgentAndStart}</button></div>
      {starting && <StartDialog card={card} purpose="execution" profiles={profiles} close={() => setStarting(false)} start={async (config, baseBranch) => { await window.gearmod.invoke('cards:start', { cardId: card.id, config, purpose: 'execution', baseBranch }); setStarting(false); await reload(); onStarted() }} />}
    </div>}
  </>
}
