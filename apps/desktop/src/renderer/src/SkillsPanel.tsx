import React, { useCallback, useEffect, useState } from 'react'
import type { AgentProfile, SkillEntry, SkillScope } from '@agentboard/contracts'
import { ProviderLogo } from './AgentIcon'

const providerName = { claude: 'Claude', codex: 'Codex' } as const
const slug = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)

/** Skills globais (pasta de cada agente) ou do projeto (detectadas no repositório): importar e converter para o outro agente. */
export function SkillsPanel({ scope, projectId, profiles, globalCount }: { scope: SkillScope; projectId?: string; profiles: AgentProfile[]; globalCount?: number }): React.JSX.Element {
  const [skills, setSkills] = useState<SkillEntry[]>([]), [error, setError] = useState(''), [importing, setImporting] = useState(false), [converting, setConverting] = useState<{ name: string; to: 'claude' | 'codex' }>()
  const [source, setSource] = useState(''), [name, setName] = useState(''), [origin, setOrigin] = useState<'claude' | 'codex'>('claude'), [reviewer, setReviewer] = useState(''), [busy, setBusy] = useState(false)
  const load = useCallback(async () => { try { setSkills(await window.agentboard.invoke('skills:list', { scope, projectId })) } catch (reason) { setError(String(reason)) } }, [scope, projectId])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (event.eventType.startsWith('skills/review-')) void load() }), [load])
  const guard = async (action: () => Promise<void>): Promise<void> => { setBusy(true); setError(''); try { await action() } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } finally { setBusy(false) } }
  const choose = async (): Promise<void> => { const picked = await window.agentboard.invoke('skills:choose-source', undefined); if (!picked) return; setSource(picked); if (!name) setName(slug(picked.replace(/[\\/]SKILL\.md$/i, '').split(/[\\/]/).pop() ?? '')) }
  const running = skills.find((skill) => skill.providers.claude === 'converting' || skill.providers.codex === 'converting')
  return <>
    <div className="skhead"><p>{scope === 'project' ? 'Skills deste repositório. Elas são detectadas e carregadas sempre que o projeto abre.' : 'Skills globais ficam disponíveis em todos os projetos.'}</p>{!importing && <button type="button" className="mini" onClick={() => { setImporting(true); setSource(''); setName('') }}>＋ Importar skill</button>}</div>
    {importing && <div className="impbox"><button type="button" className="filepick" onClick={() => void choose()}>📄 {source || 'Escolher pasta ou SKILL.md'}<small>{source ? 'selecionado' : 'clique para escolher'}</small></button>
      <label className="f">Nome<input className="in" value={name} placeholder="nome-da-skill" onChange={(e) => setName(slug(e.target.value))} /></label>
      <div className="f"><span>Esta skill é de qual agente?</span><div className="provcards">{(['claude', 'codex'] as const).map((provider) => <button type="button" key={provider} className={origin === provider ? 'sel' : ''} onClick={() => setOrigin(provider)}><i className={`av lg ${provider}`}><ProviderLogo provider={provider} /></i><span><b>{providerName[provider]}</b><small>{provider === 'claude' ? 'Anthropic' : 'OpenAI'}</small></span></button>)}</div></div>
      <div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setImporting(false)}>Cancelar</button><button type="button" disabled={busy || !source || !name} onClick={() => void guard(async () => { setSkills(await window.agentboard.invoke('skills:import', { scope, projectId, sourcePath: source, name, provider: origin })); setImporting(false) })}>Importar</button></div></div>}
    <div className="stack" style={{ gap: 8 }}>{skills.length === 0 && !importing ? <div className="emptyBox">{scope === 'project' ? 'Nenhuma skill encontrada em .claude/skills nem em .agents/skills deste projeto.' : 'Nenhuma skill ainda.'}</div> : skills.map((skill) => {
      const from = skill.providers.claude === 'ready' ? 'claude' : 'codex'
      const path = (skill.paths.claude ?? skill.paths.codex ?? '').replace(/\\/g, '/').split('/').slice(-3).join('/')
      return <div className="skill-row" key={skill.id}>
        <div className="skill-top"><div><b>{skill.name}</b><small>{skill.description || 'Sem descrição'}</small>{scope === 'project' && <small className="path">{path}{skill.detected ? ' · detectada no repositório' : ''}</small>}</div>
          <div className="provs">{(['claude', 'codex'] as const).map((provider) => {
            const state = skill.providers[provider]
            if (state === 'ready') return <span key={provider} className={`ptile on ${provider} tip`} data-tip={providerName[provider]}><ProviderLogo provider={provider} /></span>
            if (state === 'converting') return <span key={provider} className="ptile busy tip" data-tip={`Convertendo para ${providerName[provider]}…`}><span className="spin" /></span>
            return <button type="button" key={provider} className={`ptile off ${provider} tip`} data-tip={`Adicionar ao ${providerName[provider]}`} aria-label={`Adicionar ao ${providerName[provider]}`} onClick={() => { setConverting({ name: skill.name, to: provider }); setReviewer(profiles.find((item) => item.provider === provider)?.id ?? profiles[0]?.id ?? '') }}><ProviderLogo provider={provider} /></button>
          })}</div></div>
        {running?.name === skill.name && <div className="running"><div className="row"><span className="spin" /><b>Convertendo e revisando…</b></div><div className="bar"><i /></div><span style={{ fontSize: 11, color: 'var(--accent)' }}>Um agente confere se a skill ficou completa.</span></div>}
        {converting?.name === skill.name && <div className="convbox"><p>Vou converter <b>{skill.name}</b> para uma skill <b>{providerName[converting.to]}</b> e usar um agente para revisar se ficou faltando algo. Escolha o agente revisor.</p>
          <div className="agentbar col2"><div className="sel"><select className="in" aria-label="Agente revisor" value={reviewer} onChange={(e) => setReviewer(e.target.value)}><option value="">Sem revisão por agente</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.label} · {providerName[item.provider]}</option>)}</select></div></div>
          <div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setConverting(undefined)}>Cancelar</button><button type="button" disabled={busy} onClick={() => void guard(async () => { await window.agentboard.invoke('skills:convert', { scope, projectId, name: skill.name, from, to: converting.to, reviewProfileId: reviewer || undefined }); setConverting(undefined); await load() })}>Converter e revisar</button></div></div>}
      </div>
    })}</div>
    {scope === 'project' && globalCount !== undefined && <p className="foot">Também valem neste projeto as skills globais.</p>}
    {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
  </>
}
