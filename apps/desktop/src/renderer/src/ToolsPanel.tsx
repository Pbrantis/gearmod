import React, { useCallback, useEffect, useState } from 'react'
import type { ToolsStatus, WorkflowConfig } from '@gearmod/contracts'
import { plainError } from './NoticeDialog'
import { Select } from './Select'
import { PlaywrightSection } from './PlaywrightSection'
import { terminal } from './terminalStore'
import { checkedAgo, isOutdated, loadLatest, useLatestVersions } from './toolUpdates'
import { specKitInstallCommand, specKitUpdateCeiling, specKitUpdateState } from './specKitUpdates'
import { toast } from './toasts'
import { useT } from './i18n'

const pendingByProject = new Map<string, boolean>()
const pendingListeners = new Set<(projectId: string, pending: boolean) => void>()
const pendingChecks = new Map<string, Promise<void>>()
const statusKey = (projectId: string): string => `gearmod.tools-status.${projectId}`
const cachedStatus = (projectId: string): ToolsStatus | undefined => {
  try { const raw = localStorage.getItem(statusKey(projectId)); return raw ? JSON.parse(raw) as ToolsStatus : undefined } catch { return undefined }
}
const saveStatus = (projectId: string, status: ToolsStatus): void => { try { localStorage.setItem(statusKey(projectId), JSON.stringify(status)) } catch { /* cache is just a visual convenience */ } }

/** Is the Playwright version in use in this project older than the latest published or one already downloaded? (only if one is installed and selected) */
async function playwrightOutdated(projectId: string, latest: string | null | undefined): Promise<boolean> {
  try {
    const status = await window.gearmod.invoke('playwright:status', { projectId })
    if (!status.selected) return false
    // Newer than the one in use: the latest published or one already downloaded (e.g. by another project, since the versions are shared).
    return [latest ?? null, ...status.versions.map((item) => item.version)].some((candidate) => isOutdated(status.selected, candidate))
  } catch { return false }
}

/** The gear and the tab share the last result, without waiting for another check when the dialog opens. They light up for Spec Kit and Playwright CLI. */
export function useToolsPending(projectId: string): boolean {
  const latest = useLatestVersions(), [state, setState] = useState(() => ({ projectId, pending: pendingByProject.get(projectId) ?? false }))
  useEffect(() => {
    const listen = (id: string, pending: boolean): void => { if (id === projectId) setState({ projectId: id, pending }) }
    pendingListeners.add(listen); setState({ projectId, pending: pendingByProject.get(projectId) ?? false })
    const compute = (): Promise<void> => Promise.all([Promise.resolve(cachedStatus(projectId)), playwrightOutdated(projectId, latest?.versions.playwright)]).then(([tools, playwright]) => {
      const pending = Boolean((tools && isOutdated(tools.specify.version, latest?.versions.specify ?? null)) || playwright)
      pendingByProject.set(projectId, pending); pendingListeners.forEach((listener) => listener(projectId, pending))
    }).catch(() => undefined)
    const key = `${projectId}:${latest?.checkedAt}`
    if (latest && !pendingChecks.has(key)) pendingChecks.set(key, compute().finally(() => pendingChecks.delete(key)))
    // The Playwright section announces when something was installed, selected or removed: the dot is recalculated at once.
    const changed = (event: Event): void => { if (latest && (event as CustomEvent<string>).detail === projectId) void compute() }
    window.addEventListener('gearmod:playwright-changed', changed)
    return () => { pendingListeners.delete(listen); window.removeEventListener('gearmod:playwright-changed', changed) }
  }, [projectId, latest?.checkedAt])
  return state.projectId === projectId ? state.pending : pendingByProject.get(projectId) ?? false
}

const windows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)
const safeName = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)

interface Step { label: string; command: string; next?: string | undefined; disabled?: string | undefined }

/** Project Tools tab: Spec Kit runs in the app terminal; probing only happens when the user asks. */
export function ToolsPanel({ projectId, openedTerminal }: { projectId: string; openedTerminal(): void }): React.JSX.Element {
  const t = useT(), tt = t.settings.tools
  const [status, setStatus] = useState<ToolsStatus | undefined>(() => cachedStatus(projectId)), [error, setError] = useState(''), [checking, setChecking] = useState(false), [config, setConfig] = useState<WorkflowConfig>()
  const [specRepo, setSpecRepo] = useState(''), [copied, setCopied] = useState(''), latest = useLatestVersions()
  const refresh = useCallback(async (): Promise<void> => {
    try { const next = await window.gearmod.invoke('tools:status', { projectId }); saveStatus(projectId, next); setStatus(next); setError(''); setSpecRepo((current) => next.repos.some((repo) => repo.sourceId === current) ? current : next.repos.find((repo) => repo.specKit)?.sourceId ?? next.repos[0]?.sourceId ?? '') } catch (reason) { setError(plainError(reason)) }
  }, [projectId])
  useEffect(() => { const saved = cachedStatus(projectId); setStatus(saved); if (saved) setSpecRepo((current) => saved.repos.some((repo) => repo.sourceId === current) ? current : saved.repos.find((repo) => repo.specKit)?.sourceId ?? saved.repos[0]?.sourceId ?? ''); void window.gearmod.invoke('workflow:get', { projectId }).then((state) => setConfig(state.config)).catch(() => undefined) }, [projectId])
  const verify = async (): Promise<void> => { setChecking(true); await Promise.all([refresh(), loadLatest(true).catch(() => undefined)]); setChecking(false) }
  const togglePlaywright = (value: boolean): void => { if (!config) return; const next = { ...config, playwrightCli: value }; setConfig(next); void window.gearmod.invoke('workflow:set', { projectId, config: next }).then((state) => setConfig(state.config)).catch((reason) => setError(plainError(reason))) }
  const folder = (id: string): string => status?.repos.find((repo) => repo.sourceId === id)?.path ?? ''
  const run = async (command: string, id: string): Promise<void> => { const path = folder(id); if (!path) return; setError(''); if (await terminal.runIn({ projectId, cardId: null, path }, command)) openedTerminal(); else setError(tt.cannotOpenTerminal) }
  const copy = (command: string): void => { void navigator.clipboard.writeText(command).then(() => { setCopied(command); window.setTimeout(() => setCopied(''), 1400) }).catch((reason: unknown) => toast.error(tt.cannotCopy, plainError(reason))) }
  const upToDate = (installed: string | null): { from: string; to: string } | null => installed && latest?.versions.specify && isOutdated(installed, latest.versions.specify) ? { from: installed, to: latest.versions.specify } : null

  // The buttons sit side by side; each one's "Next step" goes on its own line below (otherwise it widens the first button's column and pushes the others away).
  const buttons = (steps: Step[], repoId: string): React.JSX.Element => <div className="tl-steps"><div className="tl-btns">{steps.map((step) => <button key={step.label + step.command} type="button" className="mini" disabled={Boolean(step.disabled) || !folder(repoId)} data-tip={step.disabled ?? tt.runTip(folder(repoId), step.command)} onClick={() => void run(step.command, repoId)}>{step.label}</button>)}</div>
    {steps.filter((step) => step.next).map((step) => <small key={step.label + step.command} className="tl-next">{tt.nextStep}<code>{step.next}</code><button type="button" className="tl-copy" aria-label={tt.copyCommand} data-tip={tt.copyCommand} onClick={() => copy(step.next!)}>{copied === step.next ? tt.copiedShort : tt.copyShort}</button></small>)}</div>
  // Only repositories that have the tool become a chip; the rest are summarized in one sentence (names appear on hover).
  type RepoInfo = NonNullable<typeof status>['repos'][number]
  const startedChips = (started: (repo: RepoInfo) => boolean, detail: (repo: RepoInfo) => string): React.JSX.Element => {
    const all = status?.repos ?? [], on = all.filter(started), off = all.filter((repo) => !started(repo))
    return <>{on.map((repo) => <span key={repo.sourceId} className="pw-chip ok" data-tip={repo.path}>{tt.started(repo.name, detail(repo))}</span>)}{off.length > 0 && <span className="pw-chip muted" data-tip={off.map((repo) => repo.name).join(', ')}>{on.length ? tt.notStartedSome(off.length) : tt.notStartedAny}</span>}</>
  }
  const repoPicker = (value: string, set: (id: string) => void, label: string): React.JSX.Element | null => status && status.repos.length > 1 ? <label className="f tl-repo"><span>{label}</span><Select label={label} value={value} options={status.repos.map((repo) => ({ value: repo.sourceId, label: repo.name }))} onChange={set} /></label> : null

  const spec = status?.repos.find((repo) => repo.sourceId === specRepo)
  const specOld = status ? upToDate(status.specify.version) : null
  const specUpdate = specKitUpdateState(status?.specify.version ?? null, latest?.versions.specify ?? null)
  const specSteps: Step[] = !status ? [] : [
    ...(!status.uv ? [{ label: tt.installUv, command: windows ? 'winget install --id=astral-sh.uv -e' : 'curl -LsSf https://astral.sh/uv/install.sh | sh', next: specKitInstallCommand }] : []),
    ...(status.uv && !status.specify.installed ? [{ label: tt.installCli, command: specKitInstallCommand, next: 'specify init --here' }] : []),
    ...(status.specify.installed && spec && !spec.specKit ? [{ label: tt.startInRepo, command: 'specify init --here' }] : []),
    ...(specUpdate.canUpdate ? [{ label: tt.updateCli(specKitUpdateCeiling), command: `${specKitInstallCommand} --force` }] : []),
    ...(status.specify.installed && spec?.specKit ? (spec.specKitIntegrations.filter(safeName).length ? spec.specKitIntegrations.filter(safeName).map((name) => ({ label: tt.updateFiles(spec.specKitIntegrations.length > 1 ? name : ''), command: `specify integration upgrade ${name}`, disabled: tt.updateFilesDisabled })) : [{ label: tt.updateFiles(''), command: 'specify integration upgrade', disabled: tt.integrationNotDetected }]) : [])
  ]
  const notice = (old: { from: string; to: string } | null): React.JSX.Element | null => old ? <p className="pw-warn" role="status">{tt.updateAvailable(old.from, old.to)}</p> : null
  return <div className="cx-wfpanel">
    <div className="cx-autosave" role="status">{latest?.error ? <span className="cx-warn">{latest.error}</span> : latest?.checkedAt ? tt.checked(checkedAgo(latest.checkedAt)) : tt.notChecked} · <button type="button" className="linklike" disabled={checking} onClick={() => void verify()}>{checking ? tt.checking : tt.searchUpdates}</button></div>
    {error && <div className="cx-error">{error}</div>}
    <section className="cx-wfcard">
      <h4>Spec Kit (GitHub)</h4>
      <p className="cx-muted">{tt.specKitDescription}</p>
      <div className="pw-badges"><span>{tt.badgeTerminal}</span><span>{tt.badgeCli}</span></div>
      {status ? <>
        <div className="pw-chips">
          <span className={`pw-chip ${status.uv ? '' : 'warn'}`}>{status.uv ? `uv ${status.uv}` : tt.uvMissing}</span>
          <span className={`pw-chip ${status.python ? '' : 'muted'}`} data-tip={tt.pythonTip}>{status.python ? `Python ${status.python}` : tt.pythonMissing}</span>
          <span className={`pw-chip ${status.specify.installed ? 'ok' : 'muted'}`}>{status.specify.installed ? <><i aria-hidden="true" />specify{status.specify.version ? ` · v${status.specify.version}` : ''}</> : tt.specifyNotInstalled}</span>
          {startedChips((repo) => repo.specKit, (repo) => repo.specKitIntegrations.length ? ` · ${repo.specKitIntegrations.join(', ')}` : '')}
        </div>
        {repoPicker(specRepo, setSpecRepo, tt.specKitRepo)}
        {notice(specOld)}
        {specUpdate.newerAvailable && <p className="pw-warn" role="status">{tt.newerThanCeiling(specKitUpdateCeiling)}</p>}
        {buttons(specSteps, specRepo)}
      </> : <p className="cx-muted">{tt.noSavedCheck}</p>}
    </section>
    <PlaywrightSection projectId={projectId} enabled={config?.playwrightCli ?? false} toggle={togglePlaywright} latest={latest?.versions.playwright ?? null} />
  </div>
}
