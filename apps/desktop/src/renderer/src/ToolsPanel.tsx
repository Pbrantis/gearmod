import React, { useCallback, useEffect, useState } from 'react'
import type { ConstitutionState, ToolsStatus, WorkflowConfig } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { Select } from './Select'
import { PlaywrightSection } from './PlaywrightSection'
import { terminal } from './terminalStore'
import { checkedAgo, isOutdated, loadLatest, useLatestVersions } from './toolUpdates'

/** Há atualização pendente de Spec Kit, OpenSpec ou Playwright neste projeto? (ponto na aba Ferramentas) */
export function useToolsPending(projectId: string): boolean {
  const latest = useLatestVersions(), [pending, setPending] = useState(false)
  useEffect(() => {
    if (!latest) return
    let alive = true
    void Promise.all([window.agentboard.invoke('tools:status', { projectId }), window.agentboard.invoke('playwright:status', { projectId })]).then(([tools, playwright]) => {
      const local = playwright.installs.find((item) => item.origin === 'local')
      if (alive) setPending(isOutdated(tools.specify.version, latest.versions.specify) || isOutdated(tools.openspec.version, latest.versions.openspec) || Boolean(local && isOutdated(local.version, latest.versions.playwright)))
    }).catch(() => undefined)
    return () => { alive = false }
  }, [projectId, latest?.checkedAt])
  return pending
}

const windows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)
/** CLIs do Spec Kit mais antigas que isso não têm `specify self upgrade`: atualizam reinstalando com o uv. */
const selfUpgradeFrom = '0.4.0'
const safeName = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)

interface Step { label: string; command: string; next?: string | undefined; disabled?: string | undefined }

/** Aba Ferramentas do projeto: Spec Kit e OpenSpec rodam no terminal do app (comandos fixos); o Playwright instala em segundo plano com log. */
export function ToolsPanel({ projectId, openedTerminal }: { projectId: string; openedTerminal(): void }): React.JSX.Element {
  const [status, setStatus] = useState<ToolsStatus>(), [error, setError] = useState(''), [checking, setChecking] = useState(false), [config, setConfig] = useState<WorkflowConfig>(), [constitution, setConstitution] = useState<ConstitutionState>()
  const [specRepo, setSpecRepo] = useState(''), [openRepo, setOpenRepo] = useState(''), [copied, setCopied] = useState(''), latest = useLatestVersions()
  const refresh = useCallback(async (): Promise<void> => {
    try { const next = await window.agentboard.invoke('tools:status', { projectId }); setStatus(next); setError(''); setSpecRepo((current) => next.repos.some((repo) => repo.sourceId === current) ? current : next.repos.find((repo) => repo.specKit)?.sourceId ?? next.repos[0]?.sourceId ?? ''); setOpenRepo((current) => next.repos.some((repo) => repo.sourceId === current) ? current : next.repos.find((repo) => repo.openSpec)?.sourceId ?? next.repos[0]?.sourceId ?? '') } catch (reason) { setError(plainError(reason)) }
  }, [projectId])
  useEffect(() => { void refresh(); void window.agentboard.invoke('workflow:get', { projectId }).then((state) => setConfig(state.config)).catch(() => undefined); void window.agentboard.invoke('constitution:get', { projectId }).then(setConstitution).catch(() => undefined) }, [projectId, refresh])
  // Quem instala é o terminal: ao voltar para a janela, confere de novo o que mudou.
  useEffect(() => { const again = (): void => { void refresh() }; window.addEventListener('focus', again); return () => window.removeEventListener('focus', again) }, [refresh])
  const verify = async (): Promise<void> => { setChecking(true); await Promise.all([refresh(), loadLatest(true).catch(() => undefined)]); setChecking(false) }
  const togglePlaywright = (value: boolean): void => { if (!config) return; const next = { ...config, playwrightCli: value }; setConfig(next); void window.agentboard.invoke('workflow:set', { projectId, config: next }).then((state) => setConfig(state.config)).catch((reason) => setError(plainError(reason))) }
  const folder = (id: string): string => status?.repos.find((repo) => repo.sourceId === id)?.path ?? ''
  const run = async (command: string, id: string): Promise<void> => { const path = folder(id); if (!path) return; setError(''); if (await terminal.runIn({ projectId, cardId: null, path }, command)) openedTerminal(); else setError('Não foi possível abrir o terminal nessa pasta.') }
  const copy = (command: string): void => { void navigator.clipboard.writeText(command).then(() => { setCopied(command); window.setTimeout(() => setCopied(''), 1400) }).catch(() => undefined) }
  const upToDate = (installed: string | null, key: 'specify' | 'openspec'): { from: string; to: string } | null => installed && latest?.versions[key] && isOutdated(installed, latest.versions[key]) ? { from: installed, to: latest.versions[key]! } : null

  const buttons = (steps: Step[], repoId: string): React.JSX.Element => <div className="tl-steps">{steps.map((step) => <div key={step.label + step.command} className="tl-step">
    <button type="button" className="mini" disabled={Boolean(step.disabled) || !folder(repoId)} title={step.disabled ?? `Roda no terminal, em ${folder(repoId) || 'um repositório do projeto'}: ${step.command}`} onClick={() => void run(step.command, repoId)}>{step.label}</button>
    {step.next && <small className="tl-next">Próximo passo: <code>{step.next}</code><button type="button" className="tl-copy" aria-label="Copiar o comando" title="Copiar o comando" onClick={() => copy(step.next!)}>{copied === step.next ? 'copiado' : 'copiar'}</button></small>}</div>)}</div>
  const repoPicker = (value: string, set: (id: string) => void, label: string): React.JSX.Element | null => status && status.repos.length > 1 ? <label className="f tl-repo"><span>{label}</span><Select label={label} value={value} options={status.repos.map((repo) => ({ value: repo.sourceId, label: repo.name }))} onChange={set} /></label> : null

  const spec = status?.repos.find((repo) => repo.sourceId === specRepo), open = status?.repos.find((repo) => repo.sourceId === openRepo)
  const specOld = status ? upToDate(status.specify.version, 'specify') : null, openOld = status ? upToDate(status.openspec.version, 'openspec') : null
  const specSteps: Step[] = !status ? [] : [
    ...(!status.uv ? [{ label: 'Instalar uv', command: windows ? 'winget install --id=astral-sh.uv -e' : 'curl -LsSf https://astral.sh/uv/install.sh | sh', next: 'uv tool install specify-cli' }] : []),
    ...(status.uv && !status.specify.installed ? [{ label: 'Instalar CLI', command: 'uv tool install specify-cli', next: 'specify init --here' }] : []),
    ...(status.specify.installed && spec && !spec.specKit ? [{ label: 'Iniciar no repositório', command: 'specify init --here' }] : []),
    ...(specOld ? [{ label: 'Atualizar CLI', command: isOutdated(status.specify.version, selfUpgradeFrom) ? 'uv tool install specify-cli --force' : 'specify self upgrade', next: spec?.specKit ? `specify integration upgrade ${spec.specKitIntegrations.find(safeName) ?? '<integração>'}` : undefined }] : []),
    ...(status.specify.installed && spec?.specKit ? (spec.specKitIntegrations.filter(safeName).length ? spec.specKitIntegrations.filter(safeName).map((name) => ({ label: `Atualizar arquivos do projeto${spec.specKitIntegrations.length > 1 ? ` (${name})` : ''}`, command: `specify integration upgrade ${name}` })) : [{ label: 'Atualizar arquivos do projeto', command: 'specify integration upgrade', disabled: 'A integração usada neste repositório não foi detectada; rode no terminal: specify integration upgrade <integração>' }]) : [])
  ]
  const nodeOk = Boolean(status?.node) && !isOutdated(status!.node, '20.19.0')
  const openSteps: Step[] = !status ? [] : [
    ...(!status.openspec.installed ? [{ label: 'Instalar CLI', command: 'npm install -g @fission-ai/openspec@latest', next: 'openspec init', disabled: nodeOk ? undefined : 'O OpenSpec precisa do Node.js 20.19.0 ou mais novo.' }] : []),
    ...(status.openspec.installed && open && !open.openSpec ? [{ label: 'Iniciar no repositório', command: 'openspec init' }] : []),
    ...(openOld ? [{ label: 'Atualizar CLI', command: 'npm install -g @fission-ai/openspec@latest', next: open?.openSpec ? 'openspec update' : undefined, disabled: nodeOk ? undefined : 'O OpenSpec precisa do Node.js 20.19.0 ou mais novo.' }] : []),
    ...(status.openspec.installed && open?.openSpec ? [{ label: 'Atualizar arquivos do projeto', command: 'openspec update' }] : [])
  ]
  const notice = (old: { from: string; to: string } | null): React.JSX.Element | null => old ? <p className="pw-warn" role="status">Atualização disponível: {old.from} → {old.to}</p> : null
  const importable = constitution?.importable && !constitution.constitution.contentMd.trim() && spec?.specKit
  return <div className="cx-wfpanel">
    {error && <div className="cx-error">{error}</div>}
    <section className="cx-wfcard">
      <h4>Spec Kit (GitHub)</h4>
      <p className="cx-muted">Fluxo de especificação do GitHub: constituição, spec, plano e tasks por comandos do agente.</p>
      <div className="pw-badges"><span>roda no terminal do app</span><span>CLI no computador (uv)</span></div>
      {status ? <>
        <div className="pw-chips">
          <span className={`pw-chip ${status.uv ? '' : 'warn'}`}>{status.uv ? `uv ${status.uv}` : 'uv não encontrado'}</span>
          <span className={`pw-chip ${status.python ? '' : 'muted'}`} title="O Spec Kit precisa do Python 3.11 ou mais novo">{status.python ? `Python ${status.python}` : 'Python não encontrado'}</span>
          <span className={`pw-chip ${status.specify.installed ? 'ok' : 'muted'}`}>{status.specify.installed ? <><i aria-hidden="true" />specify{status.specify.version ? ` · v${status.specify.version}` : ''}</> : 'specify · não instalado'}</span>
          {status.repos.map((repo) => <span key={repo.sourceId} className={`pw-chip ${repo.specKit ? 'ok' : 'muted'}`} title={repo.path}>{repo.name} · {repo.specKit ? `iniciado${repo.specKitIntegrations.length ? ` · ${repo.specKitIntegrations.join(', ')}` : ''}` : 'não iniciado'}</span>)}
        </div>
        {repoPicker(specRepo, setSpecRepo, 'Repositório do Spec Kit')}
        {notice(specOld)}
        {buttons(specSteps, specRepo)}
        {importable && <div className="cx-offerrow"><span className="cx-muted">Este repositório tem uma Constituição do Spec Kit e o projeto ainda não tem uma.</span><button type="button" className="mini secondary" onClick={() => void window.agentboard.invoke('constitution:import', { projectId }).then(setConstitution).catch((reason) => setError(plainError(reason)))}>Importar a Constituição do Spec Kit</button></div>}
      </> : <p className="cx-muted">Verificando…</p>}
    </section>
    <section className="cx-wfcard">
      <h4>OpenSpec</h4>
      <p className="cx-muted">Especificações por mudança (propostas, specs e tasks) mantidas na pasta <code>openspec/</code> do repositório.</p>
      <div className="pw-badges"><span>roda no terminal do app</span><span>CLI global (npm)</span></div>
      {status ? <>
        <div className="pw-chips">
          <span className={`pw-chip ${nodeOk ? '' : 'warn'}`} title="O OpenSpec precisa do Node.js 20.19.0 ou mais novo">{status.node ? `Node.js ${status.node}${nodeOk ? '' : ' (precisa de 20.19+)'}` : 'Node.js não encontrado no PATH'}</span>
          <span className={`pw-chip ${status.openspec.installed ? 'ok' : 'muted'}`}>{status.openspec.installed ? <><i aria-hidden="true" />openspec{status.openspec.version ? ` · v${status.openspec.version}` : ''}</> : 'openspec · não instalado'}</span>
          {status.repos.map((repo) => <span key={repo.sourceId} className={`pw-chip ${repo.openSpec ? 'ok' : 'muted'}`} title={repo.path}>{repo.name} · {repo.openSpec ? 'iniciado' : 'não iniciado'}</span>)}
        </div>
        {repoPicker(openRepo, setOpenRepo, 'Repositório do OpenSpec')}
        {notice(openOld)}
        {buttons(openSteps, openRepo)}
      </> : <p className="cx-muted">Verificando…</p>}
    </section>
    <PlaywrightSection projectId={projectId} enabled={config?.playwrightCli ?? false} toggle={togglePlaywright} latest={latest?.versions.playwright ?? null} />
    <div className="cx-autosave" role="status">{latest?.error ? <span className="cx-warn">{latest.error}</span> : latest?.checkedAt ? `Verificado ${checkedAgo(latest.checkedAt)}` : 'Ainda não verificado'} · <button type="button" className="linklike" disabled={checking} onClick={() => void verify()}>{checking ? 'Verificando…' : 'Verificar agora'}</button></div>
  </div>
}
