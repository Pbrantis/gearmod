import React, { useEffect, useState } from 'react'
import { isOutdated, type PlaywrightStatus } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { MultiSelect } from './MultiSelect'
import { ProcessDialog } from './ProcessDialog'
import { tasks, useTasks } from './backgroundTasks'
import { Select } from './Select'
import { Checkbox } from './Checkbox'

/** Playwright CLI opcional: mostra o que existe e instala localmente num repositório, só com confirmação. */
export function PlaywrightSection({ projectId, enabled, toggle, latest }: { projectId: string; enabled: boolean; toggle(value: boolean): void; latest?: string | null }): React.JSX.Element {
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
    const { id, promise } = tasks.track({ key: `playwright:${projectId}`, title: 'Instalar Playwright CLI', detail: sources.find((item) => item.id === target)?.name ?? '' }, async () => {
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
    <h4>Testes no navegador: Playwright CLI (opcional)</h4>
    <p className="cx-muted">Permite que o testador explore a interface, tire screenshots como evidência e valide os critérios visuais. A instalação é local ao repositório e sempre pede sua confirmação.</p>
    <div className="pw-badges"><span>local ao projeto</span><span>sem instalação global</span><span>sob confirmação</span></div>
    {status ? <>
      <div className="pw-chips">
        <span className={`pw-chip ${status.node ? '' : 'warn'}`} title="Versão do Node.js encontrada no PATH">{status.node ? `Node.js ${status.node}` : 'Node.js não encontrado no PATH'}</span>
        {status.installs.length ? status.installs.map((item) => <span key={item.path} className="pw-chip ok" title={item.path}><i aria-hidden="true" />{item.origin === 'global' ? 'Global' : item.repo} · instalado{item.version ? ` · v${item.version}` : ''}</span>) : <span className="pw-chip muted" title="Não encontrado nos repositórios do projeto nem no PATH">Playwright CLI · não instalado</span>}
        {status.installs.some((item) => item.origin === 'local') && <span className={`pw-chip ${status.browserReady ? 'ok' : 'warn'}`}>{status.browserReady ? <><i aria-hidden="true" />Navegador de teste · baixado</> : 'Navegador de teste · pendente'}</span>}
      </div>
      {outdated && local?.sourceId && <div className="cx-note warn cx-browserrow"><span>Atualização disponível: {local.version} → {latest}</span><button type="button" className="mini" disabled={busy} onClick={() => runInstall(local.sourceId!, true, [])}>{busy ? 'Atualizando…' : 'Atualizar'}</button></div>}
      {status.installs.some((item) => item.origin === 'local') && !status.browserReady && <div className="cx-note warn cx-browserrow"><span>O navegador de teste ainda não foi baixado: o Playwright CLI não consegue abrir páginas sem ele.</span><button type="button" className="mini" disabled={downloading} onClick={() => void downloadBrowser()}>{downloading ? 'Baixando…' : 'Baixar navegador'}</button></div>}
      <div className="cx-offerrow">
      <label className="ck-line"><Checkbox checked={enabled} disabled={!status.installs.some((item) => item.origin === 'local')} onChange={toggle} /> Oferecer o Playwright CLI ao agente de testes deste projeto</label>
        <button type="button" className="mini secondary" disabled={busy || !sourceId} onClick={() => setConfirming(true)}>{busy ? 'Instalando…' : 'Instalar localmente'}</button>
      </div>
      {status.error && <div className="cx-error">{status.error}</div>}
    </> : <p className="cx-muted">Verificando…</p>}
    </section>
    {error && <div className="cx-error">{error}</div>}
    {confirming && <ConfirmDialog eyebrow="Playwright CLI" title="Instalar Playwright CLI?" text="Revise o que será instalado neste projeto. Você pode mudar as opções antes de confirmar." extra={<div className="pw-install">
      <label className="f"><span>Instalar no repositório</span><Select label="Instalar no repositório" value={sourceId} options={sources.map((item) => ({ value: item.id, label: item.node ? item.name : `${item.name} · sem package.json`, disabled: false }))} onChange={setSourceId} /></label>
      {chosenSource && !chosenSource.node && <p className="pw-warn" role="alert">{chosenSource.name} não tem package.json; a instalação local precisa de um projeto Node. Escolha outro repositório.</p>}
      <div className="pw-plan"><span className="pw-planlabel">Comando</span><code>npm install -D @playwright/cli@latest</code><small>Altera o package.json e o arquivo de lock de <b>{repo}</b>.</small></div>
      <label className="ck-line"><Checkbox checked={browser} onChange={setBrowser} /><span className="t">Baixar o navegador de teste<small>Chromium · cerca de 150 MB. Sem ele, o CLI não consegue abrir páginas.</small></span></label>
      <label className="f"><span>Skill do agente</span><MultiSelect label="Skill do agente" empty="Não instalar skill" value={skills} options={[{ value: 'claude', label: 'Claude · .claude/skills' }, { value: 'agents', label: 'Codex e outros · .agents/skills' }]} onChange={(value) => setSkills(value as Array<'claude' | 'agents'>)} /></label>
      {skills.length > 0 && <div className="pw-skillnote">{skills.length > 1 ? 'As skills serão criadas em ' : 'A skill será criada em '}{skills.map((item, index) => <React.Fragment key={item}>{index > 0 && ' e '}<code>{item === 'claude' ? '.claude/skills' : '.agents/skills'}</code></React.Fragment>)} sem substituir uma que já exista.</div>}
    </div>} ok="Instalar" okDisabled={!chosenSource?.node} cancel={() => setConfirming(false)} confirm={install} />}
    {processOpen && processId && <ProcessDialog taskId={processId} title="Instalando o Playwright CLI" log={status?.log} background={() => setProcessOpen(false)} close={() => setProcessOpen(false)} />}
  </div>
}
