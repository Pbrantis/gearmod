import React, { useEffect, useState } from 'react'
import { complexityDimensions, dimensionLabels, type SddDetection, type SddMethod, type WorkflowConfig } from '@agentboard/contracts'
import { plainError } from './NoticeDialog'
import { Select } from './Select'
import { Checkbox } from './Checkbox'

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
