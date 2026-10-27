import React, { useEffect, useState } from 'react'
import { complexityDimensions, dimensionLabels, type SddDetection, type SddMethod, type WorkflowConfig } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { MultiSelect } from './MultiSelect'
import { ProcessDialog } from './ProcessDialog'
import { tasks, useTasks } from './backgroundTasks'
import { Select } from './Select'
import { Checkbox } from './Checkbox'
import type { PlaywrightStatus } from '@agentboard/contracts'

const methodLabels: Record<SddMethod, string> = { native: 'SDD do AgentBoard', speckit: 'GitHub Spec Kit', openspec: 'OpenSpec', custom: 'Método personalizado (manifesto)' }

const FolderIcon = (): React.JSX.Element => <svg className="cx-foldico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>

/** Configuração do projeto: pesos e limites do Complexity Engine, método das tarefas complexas, SDD central e pasta dos artefatos. */
export function WorkflowPanel({ projectId }: { projectId: string }): React.JSX.Element {
  const [config, setConfig] = useState<WorkflowConfig>(), [detected, setDetected] = useState<SddDetection[]>([]), [defaultDir, setDefaultDir] = useState(''), [message, setMessage] = useState('')
  const [editSdd, setEditSdd] = useState(false), [editArt, setEditArt] = useState(false), [saveState, setSaveState] = useState<'' | 'saving' | 'saved'>(''), lastSaved = React.useRef('')
  const take = (state: { config: WorkflowConfig; detected: SddDetection[]; defaultArtifactsDir: string }): void => { lastSaved.current = JSON.stringify(state.config); setConfig(state.config); setDetected(state.detected); setDefaultDir(state.defaultArtifactsDir) }
  useEffect(() => { void window.agentboard.invoke('workflow:get', { projectId }).then(take).catch((reason) => setMessage(plainError(reason))) }, [projectId])
  // Salva sozinho ~0,7 s depois da última mudança; o que o servidor devolve só atualiza as detecções, para não mexer no que está sendo digitado.
  useEffect(() => {
    if (!config || JSON.stringify(config) === lastSaved.current) return
    const snapshot = JSON.stringify(config)
    const timer = window.setTimeout(() => {
      setSaveState('saving'); setMessage('')
      void window.agentboard.invoke('workflow:set', { projectId, config }).then((state) => { lastSaved.current = snapshot; setDetected(state.detected); setDefaultDir(state.defaultArtifactsDir); setSaveState('saved') }).catch((reason) => { setSaveState(''); setMessage(plainError(reason)) })
    }, 700)
    return () => window.clearTimeout(timer)
  }, [config, projectId])
  if (!config) return <p className="cx-muted">{message || 'Carregando…'}</p>
  const set = (patch: Partial<WorkflowConfig>): void => setConfig({ ...config, ...patch })
  const choose = async (key: 'sddPath' | 'artifactsDir'): Promise<void> => { const path = await window.agentboard.invoke('projects:choose-directory', undefined); if (path) set({ [key]: path }) }
  const openFolder = (which: 'artifacts' | 'sdd'): void => { void window.agentboard.invoke('workflow:open-path', { projectId, which }).catch((reason) => setMessage(plainError(reason))) }
  const harness = config.harness, setHarness = (patch: Partial<WorkflowConfig['harness']>): void => set({ harness: { ...harness, ...patch } })
  const optional = (value: string): number | null => value.trim() === '' ? null : Number(value)
  const max = complexityDimensions.reduce((sum, dimension) => sum + 3 * config.weights[dimension], 0)
  return <div className="cx-wfpanel">
    <p className="cx-note">O agente avalia cada card em seis dimensões (0 a 3) e o AgentBoard recomenda o fluxo: curto, spec leve ou SDD. Pesos e limites são heurísticas iniciais; ajuste conforme o projeto. A escolha final é sempre sua e fica registrada no card.</p>
    <section className="cx-wfcard">
    <h4>Pesos das dimensões</h4>
    <div className="cx-weights">{complexityDimensions.map((dimension) => <label key={dimension}>{dimensionLabels[dimension]}<input type="number" min={0} max={5} value={config.weights[dimension]} onChange={(event) => set({ weights: { ...config.weights, [dimension]: Math.max(0, Math.min(5, Number(event.target.value) || 0)) } })} /></label>)}</div>
    </section>
    <section className="cx-wfcard">
    <h4>Limites (pontuação máxima: {max})</h4>
    <LimitsBar max={max} simpleMax={config.limits.simpleMax} mediumMax={config.limits.mediumMax} change={(simpleMax, mediumMax) => set({ limits: { ...config.limits, simpleMax, mediumMax } })} />
    </section>
    <section className="cx-wfcard">
    <h4>Método das tarefas complexas (fluxo SDD)</h4>
    <Select label="Método das tarefas complexas" value={config.complexMethod} options={(Object.keys(methodLabels) as SddMethod[]).map((method) => ({ value: method, label: methodLabels[method] }))} onChange={(value) => set({ complexMethod: value as SddMethod })} />
    {config.complexMethod === 'custom' && <label className="cx-reason">Manifesto do método (JSON com name, version e steps)<input value={config.customManifest ?? ''} onChange={(event) => set({ customManifest: event.target.value.trim() || null })} placeholder="C:\\projeto\\docs\\metodo.json" /></label>}
    </section>
    <section className="cx-wfcard">
    <h4>SDD central do projeto</h4>
    <p className="cx-note">Um só SDD por projeto, mesmo com vários repositórios. O AgentBoard não instala nada: grava os arquivos do plano no formato do método nesta pasta quando o planejamento termina.</p>
    {config.sddPath && !editSdd ? <div className="cx-pathrow"><button type="button" className="cx-pathchip big link" title={`Abrir a pasta: ${config.sddPath}`} onClick={() => openFolder('sdd')}><b>{detected.find((item) => item.path === config.sddPath) ? methodLabels[detected.find((item) => item.path === config.sddPath)!.method] : 'Pasta escolhida'}</b><code>{config.sddPath}</code><FolderIcon /></button><button type="button" className="mini secondary" onClick={() => setEditSdd(true)}>Editar</button></div> : <>
      {detected.length ? <div className="cx-detected">{detected.map((item) => <div className="cx-detrow" key={`${item.method}-${item.path}`}><span className="cx-pathchip big" title={item.path}><b>{methodLabels[item.method]}</b><code>{item.path}</code>{item.repository && <em>{item.repository}</em>}{item.commands.length > 0 && <em>{item.commands.length} comando(s)</em>}</span><button type="button" className="mini" onClick={() => { set({ sddPath: item.path, complexMethod: item.method }); setEditSdd(false) }}>Usar</button></div>)}</div> : <p className="cx-note warn">Nenhuma instalação de Spec Kit (.specify/) ou OpenSpec (openspec/) encontrada na pasta do projeto nem nos repositórios.</p>}
      <div className="cx-add"><input value={config.sddPath ?? ''} onChange={(event) => set({ sddPath: event.target.value.trim() || null })} placeholder="Pasta do SDD (vazio = a detectada, se houver)" /><button type="button" className="mini secondary" onClick={() => void choose('sddPath')}>Escolher…</button>{editSdd && <button type="button" className="mini" onClick={() => setEditSdd(false)}>Concluir</button>}</div>
    </>}
    </section>
    <section className="cx-wfcard">
    <h4>Pasta dos artefatos dos cards</h4>
    <p className="cx-note">discovery.md, history.jsonl, implementation.md, verification.md e o plano de cada card. Aponte para uma pasta versionada (por exemplo, o repositório de documentação) para ter o histórico no Git.</p>
    {!editArt ? <div className="cx-pathrow"><button type="button" className="cx-pathchip big link" title={`Abrir a pasta: ${config.artifactsDir ?? defaultDir}`} onClick={() => openFolder('artifacts')}><b>{config.artifactsDir ? 'Pasta escolhida' : 'Padrão do app'}</b><code>{config.artifactsDir ?? defaultDir}</code><FolderIcon /></button><button type="button" className="mini secondary" onClick={() => setEditArt(true)}>Editar</button></div> : <div className="cx-add"><input value={config.artifactsDir ?? ''} onChange={(event) => set({ artifactsDir: event.target.value.trim() || null })} placeholder={defaultDir} /><button type="button" className="mini secondary" onClick={() => void choose('artifactsDir')}>Escolher…</button><button type="button" className="mini" onClick={() => setEditArt(false)}>Concluir</button></div>}
    </section>
    <section className="cx-wfcard">
    <h4>Limites da execução</h4>
    <p className="cx-note">Valem para cada card. Vazio = sem limite. As retomadas automáticas param depois de falhas seguidas com o mesmo erro; você sempre pode mandar outra mensagem.</p>
    <div className="cx-weights">
      <label>Tempo máximo por execução (min)<input type="number" min={1} value={harness.timeoutMinutes ?? ''} onChange={(event) => setHarness({ timeoutMinutes: optional(event.target.value) })} placeholder="sem limite" /></label>
      <label>Tokens por card (entrada + saída)<input type="number" min={1000} step={1000} value={harness.maxTokens ?? ''} onChange={(event) => setHarness({ maxTokens: optional(event.target.value) })} placeholder="sem limite" /></label>
      <label>Custo por card (US$, só o informado)<input type="number" min={0.01} step={0.5} value={harness.maxCostUsd ?? ''} onChange={(event) => setHarness({ maxCostUsd: optional(event.target.value) })} placeholder="sem limite" /></label>
      <label>Falhas seguidas iguais<input type="number" min={1} max={20} value={harness.maxAttempts} onChange={(event) => setHarness({ maxAttempts: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} /></label>
    </div>
    <label className="ck-line"><Checkbox checked={harness.scopeCheck} onChange={(scopeCheck) => setHarness({ scopeCheck })} /> Avisar quando a implementação alterar arquivos fora das áreas citadas no Plano</label>
    </section>
    <div className="cx-autosave" role="status" aria-live="polite">{saveState === 'saving' ? 'Salvando…' : saveState === 'saved' ? '✓ Salvo automaticamente' : message ? <span className="cx-warn">{message}</span> : 'As alterações são salvas automaticamente.'}</div>
    <PlaywrightSection projectId={projectId} enabled={config.playwrightCli} toggle={(value) => { const next = { ...config, playwrightCli: value }; setConfig(next); void window.agentboard.invoke('workflow:set', { projectId, config: next }).then(take).catch((reason) => setMessage(plainError(reason))) }} />
  </div>
}


/** Barra de 0 até a pontuação máxima em três faixas (simples, média, complexa); as alças arrastam os limites, e os campos continuam valendo. */
function LimitsBar({ max, simpleMax, mediumMax, change }: { max: number; simpleMax: number; mediumMax: number; change(simpleMax: number, mediumMax: number): void }): React.JSX.Element {
  const track = React.useRef<HTMLDivElement>(null)
  const total = Math.max(1, max), pct = (value: number): number => Math.max(0, Math.min(100, (value / total) * 100))
  const move = (which: 'simple' | 'medium', value: number): void => {
    const next = Math.round(value)
    if (which === 'simple') change(Math.max(0, Math.min(next, mediumMax - 1)), mediumMax)
    else change(simpleMax, Math.max(simpleMax + 1, Math.min(next, total)))
  }
  const drag = (which: 'simple' | 'medium') => (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    const rect = track.current?.getBoundingClientRect(); if (!rect) return
    const onMove = (e: PointerEvent): void => move(which, ((e.clientX - rect.left) / rect.width) * total)
    const up = (): void => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', up) }
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', up)
  }
  const key = (which: 'simple' | 'medium') => (event: React.KeyboardEvent): void => {
    const current = which === 'simple' ? simpleMax : mediumMax
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); move(which, current - 1) }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); move(which, current + 1) }
  }
  return <div className="cx-limits">
    <div className="cx-lbar" ref={track}>
      <span className="seg simple" style={{ width: `${pct(simpleMax)}%` }}><b>Simples</b></span>
      <span className="seg medium" style={{ width: `${pct(mediumMax) - pct(simpleMax)}%` }}><b>Média</b></span>
      <span className="seg complex" style={{ width: `${100 - pct(mediumMax)}%` }}><b>Complexa</b></span>
      <button type="button" className="knob" role="slider" aria-label="Limite de simples" aria-valuemin={0} aria-valuemax={total} aria-valuenow={simpleMax} style={{ left: `${pct(simpleMax)}%` }} onPointerDown={drag('simple')} onKeyDown={key('simple')}><i>{simpleMax}</i></button>
      <button type="button" className="knob" role="slider" aria-label="Limite de média" aria-valuemin={0} aria-valuemax={total} aria-valuenow={mediumMax} style={{ left: `${pct(mediumMax)}%` }} onPointerDown={drag('medium')} onKeyDown={key('medium')}><i>{mediumMax}</i></button>
    </div>
    <div className="cx-lscale"><span>0</span><span>{total}</span></div>
    <div className="cx-weights">
      <label>Simples até<input type="number" min={0} max={total} value={simpleMax} onChange={(event) => change(Math.max(0, Math.min(Number(event.target.value) || 0, mediumMax - 1)), mediumMax)} /></label>
      <label>Média até<input type="number" min={0} max={total} value={mediumMax} onChange={(event) => change(simpleMax, Math.max(simpleMax + 1, Math.min(Number(event.target.value) || 0, total)))} /></label>
      <label>Complexa<input disabled value={`acima de ${mediumMax}`} /></label>
    </div>
  </div>
}

/** Playwright CLI opcional: mostra o que existe e instala localmente num repositório, só com confirmação. */
function PlaywrightSection({ projectId, enabled, toggle }: { projectId: string; enabled: boolean; toggle(value: boolean): void }): React.JSX.Element {
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
  const install = (): void => {
    setConfirming(false); setError('')
    const { id, promise } = tasks.track({ key: `playwright:${projectId}`, title: 'Instalar Playwright CLI', detail: sources.find((item) => item.id === sourceId)?.name ?? '' }, async () => {
      const result = await window.agentboard.invoke('playwright:install', { projectId, sourceId, browser, skills })
      setStatus(result)
      if (result.error) throw new Error(result.error)
      return result
    })
    setProcessId(id); setProcessOpen(true)
    void promise.catch(() => undefined)
  }
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
