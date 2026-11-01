import React, { useEffect, useState } from 'react'
import { isOutdated, type PlaywrightStatus } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { MultiSelect } from './MultiSelect'
import { ProcessDialog } from './ProcessDialog'
import { tasks, useTasks } from './backgroundTasks'
import { Select } from './Select'
import { Checkbox } from './Checkbox'
import { useT } from './i18n'

/** Playwright CLI opcional: mostra o que existe e instala localmente num repositório, só com confirmação. */
export function PlaywrightSection({ projectId, enabled, toggle, latest }: { projectId: string; enabled: boolean; toggle(value: boolean): void; latest?: string | null }): React.JSX.Element {
  const t = useT(), tw = t.settings.playwright
  const [status, setStatus] = useState<PlaywrightStatus>(), [sources, setSources] = useState<Array<{ id: string; name: string; node: boolean }>>([]), [sourceId, setSourceId] = useState(''), [browser, setBrowser] = useState(true), [downloading, setDownloading] = useState(false), [skills, setSkills] = useState<Array<'claude' | 'agents'>>([]), [processId, setProcessId] = useState<string>(), [processOpen, setProcessOpen] = useState(false), [confirming, setConfirming] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    void window.agentboard.invoke('playwright:status', { projectId }).then(setStatus).catch((reason) => setError(plainError(reason)))
    void window.agentboard.invoke('playwright:sources', { projectId }).then((found) => { setSources(found); setSourceId((current) => current || (found.find((item) => item.node) ?? found[0])?.id || '') }).catch(() => undefined)
  }, [projectId])
  const downloadBrowser = async (): Promise<void> => { const local = status?.installs.find((item) => item.origin === 'local' && item.sourceId); if (!local?.sourceId) return; setDownloading(true); setError(''); try { setStatus(await window.agentboard.invoke('playwright:install-browser', { projectId, sourceId: local.sourceId })) } catch (reason) { setError(plainError(reason)) } finally { setDownloading(false) } }
  const chosenSource = sources.find((item) => item.id === sourceId)
  const busy = useTasks().some((item) => item.key === `playwright:${projectId}` && item.state === 'running')
  // O diálogo mostra o andamento ao vivo (o log do processo principal) e pode ser minimizado: a instalação continua em segundo plano.
  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => { void window.agentboard.invoke('playwright:status', { projectId }).then(setStatus).catch(() => undefined) }, 1500)
    return () => window.clearInterval(timer)
  }, [busy, projectId])
  /** Instala (ou atualiza) no repositório: o mesmo `playwright:install`, em segundo plano e com o log ao vivo. */
  const runInstall = (target: string, withBrowser: boolean, withSkills: Array<'claude' | 'agents'>): void => {
    setConfirming(false); setError('')
    const { id, promise } = tasks.track({ key: `playwright:${projectId}`, title: tw.taskTitle, detail: sources.find((item) => item.id === target)?.name ?? '' }, async () => {
      const result = await window.agentboard.invoke('playwright:install', { projectId, sourceId: target, browser: withBrowser, skills: withSkills })
      setStatus(result)
      if (result.error) throw new Error(result.error)
      return result
    })
    setProcessId(id); setProcessOpen(true)
    void promise.catch(() => undefined)
  }
  const install = (): void => runInstall(sourceId, browser, skills)
  const local = status?.installs.find((item) => item.origin === 'local' && item.sourceId), outdated = Boolean(local && latest && isOutdated(local.version, latest))
  const repo = sources.find((item) => item.id === sourceId)?.name ?? ''
  return <div className="cx-wfpanel">
    <section className="cx-wfcard">
    <h4>{tw.title}</h4>
    <p className="cx-muted">{tw.description}</p>
    <div className="pw-badges"><span>{tw.badgeLocal}</span><span>{tw.badgeNoGlobal}</span><span>{tw.badgeConfirm}</span></div>
    {status ? <>
      <div className="pw-chips">
        <span className={`pw-chip ${status.node ? '' : 'warn'}`} data-tip={tw.nodeTip}>{status.node ? `Node.js ${status.node}` : tw.nodeMissing}</span>
        {status.installs.length ? status.installs.map((item) => <span key={item.path} className="pw-chip ok" data-tip={item.path}><i aria-hidden="true" />{tw.installedChip(item.origin === 'global' ? tw.global : item.repo ?? '', item.version ?? '')}</span>) : <span className="pw-chip muted" data-tip={tw.notFoundTip}>{tw.notInstalledChip}</span>}
        {status.installs.some((item) => item.origin === 'local') && <span className={`pw-chip ${status.browserReady ? 'ok' : 'warn'}`}>{status.browserReady ? <><i aria-hidden="true" />{tw.browserDownloaded}</> : tw.browserPending}</span>}
      </div>
      {outdated && local?.sourceId && <div className="cx-note warn cx-browserrow"><span>{tw.updateAvailable(local.version ?? '', latest ?? '')}</span><button type="button" className="mini" disabled={busy} onClick={() => runInstall(local.sourceId!, true, [])}>{busy ? tw.updating : tw.update}</button></div>}
      {status.installs.some((item) => item.origin === 'local') && !status.browserReady && <div className="cx-note warn cx-browserrow"><span>{tw.browserMissing}</span><button type="button" className="mini" disabled={downloading} onClick={() => void downloadBrowser()}>{downloading ? tw.downloading : tw.downloadBrowser}</button></div>}
      <div className="cx-offerrow">
      <label className="ck-line"><Checkbox checked={enabled} disabled={!status.installs.some((item) => item.origin === 'local')} onChange={toggle} /> {tw.offer}</label>
        <button type="button" className="mini secondary" disabled={busy || !sourceId} onClick={() => setConfirming(true)}>{busy ? tw.installing : tw.installLocal}</button>
      </div>
      {status.error && <div className="cx-error">{status.error}</div>}
    </> : <p className="cx-muted">{tw.checking}</p>}
    </section>
    {error && <div className="cx-error">{error}</div>}
    {confirming && <ConfirmDialog eyebrow="Playwright CLI" title={tw.confirmTitle} text={tw.confirmText} extra={<div className="pw-install">
      <label className="f"><span>{tw.installInRepo}</span><Select label={tw.installInRepo} value={sourceId} options={sources.map((item) => ({ value: item.id, label: item.node ? item.name : tw.noPackageJson(item.name), disabled: false }))} onChange={setSourceId} /></label>
      {chosenSource && !chosenSource.node && <p className="pw-warn" role="alert">{tw.noPackageJsonWarn(chosenSource.name)}</p>}
      <div className="pw-plan"><span className="pw-planlabel">{tw.command}</span><code>npm install -D @playwright/cli@latest</code><small>{tw.changesFiles()[0]}<b>{repo}</b>{tw.changesFiles()[1]}</small></div>
      <label className="ck-line"><Checkbox checked={browser} onChange={setBrowser} /><span className="t">{tw.downloadBrowserOption}<small>{tw.downloadBrowserHint}</small></span></label>
      <label className="f"><span>{tw.agentSkill}</span><MultiSelect label={tw.agentSkill} empty={tw.noSkill} value={skills} options={[{ value: 'claude', label: tw.optionClaude }, { value: 'agents', label: tw.optionCodex }]} onChange={(value) => setSkills(value as Array<'claude' | 'agents'>)} /></label>
      {skills.length > 0 && <div className="pw-skillnote">{skills.length > 1 ? tw.skillCreatedPlural : tw.skillCreatedOne}{skills.map((item, index) => <React.Fragment key={item}>{index > 0 && tw.and}<code>{item === 'claude' ? '.claude/skills' : '.agents/skills'}</code></React.Fragment>)}{tw.noOverwrite}</div>}
    </div>} ok={tw.install} okDisabled={!chosenSource?.node} cancel={() => setConfirming(false)} confirm={install} />}
    {processOpen && processId && <ProcessDialog taskId={processId} title={tw.processTitle} log={status?.log} background={() => setProcessOpen(false)} close={() => setProcessOpen(false)} />}
  </div>
}
