import React, { useEffect, useState } from 'react'
import { isOutdated, type PlaywrightStatus } from '@gearmod/contracts'
import { plainError } from './NoticeDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { MultiSelect } from './MultiSelect'
import { ProcessDialog } from './ProcessDialog'
import { tasks, useTasks } from './backgroundTasks'
import { Select } from './Select'
import { Checkbox } from './Checkbox'
import { useT } from './i18n'
import { TrashIcon } from './icons'
import { loadLatest } from './toolUpdates'

/** Playwright CLI: ferramenta do app, em pasta própria, com várias versões e uma escolhida por projeto. */
export function PlaywrightSection({ projectId, enabled, toggle, latest }: { projectId: string; enabled: boolean; toggle(value: boolean): void; latest?: string | null }): React.JSX.Element {
  const t = useT(), tw = t.settings.playwright
  const [status, setStatus] = useState<PlaywrightStatus>(), [sources, setSources] = useState<Array<{ id: string; name: string; node: boolean }>>([]), [sourceId, setSourceId] = useState('')
  const [checkingLatest, setCheckingLatest] = useState(false), [version, setVersion] = useState(''), [browser, setBrowser] = useState(true), [skills, setSkills] = useState<Array<'claude' | 'agents'>>([])
  const [confirming, setConfirming] = useState(false), [removing, setRemoving] = useState<string>(), [downloading, setDownloading] = useState(false), [error, setError] = useState('')
  const [picking, setPicking] = useState(false), [available, setAvailable] = useState<string[]>(), [pickError, setPickError] = useState(''), [processId, setProcessId] = useState<string>(), [processOpen, setProcessOpen] = useState(false)
  useEffect(() => {
    void window.gearmod.invoke('playwright:status', { projectId }).then(setStatus).catch((reason) => setError(plainError(reason)))
    void window.gearmod.invoke('playwright:sources', { projectId }).then((found) => { setSources(found); setSourceId((current) => current || found[0]?.id || '') }).catch(() => undefined)
  }, [projectId])
  useEffect(() => { setVersion((current) => current || latest || 'latest') }, [latest])
  const busy = useTasks().some((item) => item.key === `playwright:${projectId}` && item.state === 'running')
  // O diálogo mostra o andamento ao vivo (o log do processo principal) e pode ser minimizado: a instalação continua em segundo plano.
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => { void window.gearmod.invoke('playwright:status', { projectId }).then(setStatus).catch(() => undefined) }, 1500)
    return () => window.clearInterval(timer)
  }, [busy, projectId])
  const act = async (call: () => Promise<PlaywrightStatus>): Promise<void> => { setError(''); try { setStatus(await call()) } catch (reason) { setError(plainError(reason)) } }
  const downloadBrowser = async (): Promise<void> => { setDownloading(true); await act(() => window.gearmod.invoke('playwright:install-browser', { projectId })); setDownloading(false) }
  const openPicker = async (): Promise<void> => {
    setPicking(true); setAvailable(undefined); setPickError('')
    try { const list = await window.gearmod.invoke('playwright:versions', undefined); setAvailable(list); setVersion((current) => list.includes(current) ? current : list[0] ?? '') } catch (reason) { setPickError(plainError(reason)) }
  }
  const runInstall = (): void => {
    setConfirming(false); setError('')
    const wanted = version.trim() || 'latest'
    const { id, promise } = tasks.track({ key: `playwright:${projectId}`, title: tw.taskTitle, detail: wanted }, async () => {
      const result = await window.gearmod.invoke('playwright:install', { projectId, version: wanted, browser, skills, ...(skills.length && sourceId ? { sourceId } : {}) })
      setStatus(result)
      if (result.error) throw new Error(result.error)
      return result
    })
    setProcessId(id); setProcessOpen(true)
    void promise.catch(() => undefined)
  }
  const nodeChip = status ? (status.node.system ? tw.nodeSystem(status.node.system.replace(/^v/, '')) : status.node.managed ? tw.nodeManaged(status.node.managed) : null) : null
  return <div className="cx-wfpanel">
    <section className="cx-wfcard">
    <h4>{tw.title}</h4>
    <p className="cx-muted">{tw.description}</p>
    <div className="pw-badges"><span>{tw.badgeApp}</span><span>{tw.badgeVersions}</span><span>{tw.badgeConfirm}</span></div>
    {status ? <>
      <div className="pw-chips">
        <span className={`pw-chip ${nodeChip ? '' : 'warn'}`} data-tip={tw.nodeTip}>{nodeChip ?? tw.nodeWillDownload}</span>
        <span className={`pw-chip ${status.browserReady ? 'ok' : 'warn'}`}>{status.browserReady ? <><i aria-hidden="true" />{tw.browserDownloaded}</> : tw.browserPending}</span>
        <span className="pw-chip" data-tip={status.toolsDir}>{tw.folderChip}</span>
      </div>
      {status.versions.length > 0 && !status.browserReady && <div className="cx-note warn cx-browserrow"><span>{tw.browserMissing}</span><button type="button" className="mini" disabled={downloading || busy} onClick={() => void downloadBrowser()}>{downloading ? tw.downloading : tw.downloadBrowser}</button></div>}
      <h5 className="pw-subtitle pw-subtitle-row"><span>{tw.versionsTitle}</span>{!latest && <button type="button" className="linklike" disabled={checkingLatest} onClick={() => { setCheckingLatest(true); void loadLatest(true).catch(() => undefined).finally(() => setCheckingLatest(false)) }}>{checkingLatest ? tw.checkingVersion : tw.checkNewVersion}</button>}</h5>
      {status.versions.length ? <ul className="pw-versions">{status.versions.map((item) => <li key={item.version} className={item.version === status.selected ? 'on' : ''}>
        <code data-tip={item.path}>v{item.version}</code>
        {item.version === status.selected ? <span className="pw-chip ok"><i aria-hidden="true" />{tw.inUse}</span> : <button type="button" className="mini secondary" disabled={busy} onClick={() => void act(() => window.gearmod.invoke('playwright:select', { projectId, version: item.version }))}>{tw.use}</button>}
        {item.version === status.selected && latest && isOutdated(item.version, latest) && <><span className="pw-chip warn"><i aria-hidden="true" />{tw.newVersion(latest)}</span><button type="button" className="mini" disabled={busy} onClick={() => { setVersion(latest); void openPicker() }}>{tw.installVersion(latest)}</button></>}
        <span className="ch-spacer" />
        <button type="button" className="ibtn tip danger" data-tip={tw.removeVersion(item.version)} aria-label={tw.removeVersion(item.version)} disabled={busy} onClick={() => setRemoving(item.version)}><TrashIcon /></button>
      </li>)}</ul> : <p className="cx-muted">{tw.noVersions}</p>}
      <div className="cx-offerrow pw-install-row">
        <label className="ck-line"><Checkbox checked={enabled} disabled={status.versions.length === 0} onChange={toggle} /> {tw.offer}</label>
        <button type="button" className="mini secondary" disabled={busy} onClick={() => void openPicker()}>{busy ? tw.installing : tw.installNew}</button>
      </div>
      {status.error && <div className="cx-error">{status.error}</div>}
    </> : <p className="cx-muted">{tw.checking}</p>}
    </section>
    {error && <div className="cx-error">{error}</div>}
    {picking && !confirming && <ConfirmDialog eyebrow="Playwright CLI" title={tw.pickTitle} text={tw.pickText} extra={<div className="pw-pick">
      {pickError ? <div className="cx-error">{pickError}</div> : !available ? <p className="cx-muted">{tw.loadingVersions}</p> : <ul className="pw-pick-list" role="listbox" aria-label={tw.pickTitle}>{available.map((item, index) => { const installed = status?.versions.some((entry) => entry.version === item) ?? false
        return <li key={item}><button type="button" role="option" aria-selected={version === item} disabled={installed} className={`pw-pick-row ${version === item ? 'on' : ''}`} onClick={() => setVersion(item)}>
          <code>v{item}</code>{index === 0 && <span className="pw-chip">{tw.newest}</span>}{installed && <span className="pw-chip ok"><i aria-hidden="true" />{tw.installedTag}</span>}</button></li> })}</ul>}
    </div>} ok={tw.install} okDisabled={!version.trim() || !available || (status?.versions.some((entry) => entry.version === version) ?? false)} cancel={() => setPicking(false)} confirm={() => setConfirming(true)} />}
    {confirming && <ConfirmDialog eyebrow="Playwright CLI" title={tw.confirmTitle} text={tw.confirmText} extra={<div className="pw-install">
      <div className="pw-plan"><span className="pw-planlabel">{tw.command}</span><code>npm install @playwright/cli@{version.trim() || 'latest'}</code><small>{tw.installIn(status?.toolsDir ?? '')}</small></div>
      <label className="ck-line"><Checkbox checked={browser} onChange={setBrowser} /><span className="t">{tw.downloadBrowserOption}<small>{tw.downloadBrowserHint}</small></span></label>
      <label className="f"><span>{tw.agentSkill}</span><MultiSelect label={tw.agentSkill} empty={tw.noSkill} value={skills} options={[{ value: 'claude', label: tw.optionClaude }, { value: 'agents', label: tw.optionCodex }]} onChange={(value) => setSkills(value as Array<'claude' | 'agents'>)} /></label>
      {skills.length > 0 && <><label className="f"><span>{tw.skillRepo}</span><Select label={tw.skillRepo} value={sourceId} options={sources.map((item) => ({ value: item.id, label: item.name, disabled: false }))} onChange={setSourceId} /></label><div className="pw-skillnote">{tw.skillNote}</div></>}
    </div>} ok={tw.install} okDisabled={skills.length > 0 && !sourceId} cancel={() => setConfirming(false)} confirm={() => { setPicking(false); runInstall() }} />}
    {removing && <ConfirmDialog eyebrow="Playwright CLI" title={tw.removeTitle(removing)} text={tw.removeText} ok={tw.remove} danger cancel={() => setRemoving(undefined)} confirm={() => { const target = removing; setRemoving(undefined); void act(() => window.gearmod.invoke('playwright:remove', { projectId, version: target })) }} />}
    {processOpen && processId && <ProcessDialog taskId={processId} title={tw.processTitle} log={status?.log} background={() => setProcessOpen(false)} close={() => setProcessOpen(false)} />}
  </div>
}
