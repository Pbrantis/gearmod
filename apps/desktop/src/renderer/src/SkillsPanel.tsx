import React, { useCallback, useEffect, useState } from 'react'
import type { AgentProfile, SkillEntry, SkillScope } from '@agentboard/contracts'
import { ProviderLogo } from './AgentIcon'
import { ConfirmDialog } from './ConfirmDialog'
import { tasks } from './backgroundTasks'
import { plainError } from './NoticeDialog'
import { Select } from './Select'

const providerName = { claude: 'Claude', codex: 'Codex' } as const
const slug = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)

/** Skills globais (pasta de cada agente) ou do projeto (detectadas no repositório): importar e converter para o outro agente. */
export function SkillsPanel({ scope, projectId, profiles, globalCount }: { scope: SkillScope; projectId?: string; profiles: AgentProfile[]; globalCount?: number }): React.JSX.Element {
  const [skills, setSkills] = useState<SkillEntry[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [importing, setImporting] = useState(false), [converting, setConverting] = useState<{ name: string; to: 'claude' | 'codex' }>()
  const [source, setSource] = useState(''), [name, setName] = useState(''), [origin, setOrigin] = useState<'claude' | 'codex'>('claude'), [reviewer, setReviewer] = useState(''), [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'one' | 'folder'>('one'), [menu, setMenu] = useState(false), [open, setOpen] = useState<string>(), [deleting, setDeleting] = useState<SkillEntry>(), [notice, setNotice] = useState('')
  const load = useCallback(async () => { try { setSkills(await window.agentboard.invoke('skills:list', { scope, projectId })); setLoaded(true); setError('') } catch (reason) { setError(String(reason)) } }, [scope, projectId])
  useEffect(() => { void load() }, [load])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (event.eventType.startsWith('skills/review-')) void load() }), [load])
  const guard = async (action: () => Promise<void>, process?: { title: string; detail: string }): Promise<void> => {
    setBusy(true); setError('')
    try { if (process) await tasks.track(process, action).promise; else await action() } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } finally { setBusy(false) }
  }
  const choose = async (): Promise<void> => { const picked = await window.agentboard.invoke(mode === 'folder' ? 'skills:choose-folder' : 'skills:choose-source', undefined); if (!picked) return; setSource(picked); if (mode === 'one' && !name) setName(slug(picked.replace(/[\\/]SKILL\.md$/i, '').split(/[\\/]/).pop() ?? '')) }
  const running = skills.find((skill) => skill.providers.claude === 'converting' || skill.providers.codex === 'converting')
  return <>
    <div className="skhead"><span className="sk-count" title={scope === 'project' ? 'Skills do projeto detectadas e carregadas quando o projeto abre.' : 'Skills globais disponíveis em todos os projetos.'}>{loaded ? `${skills.length} ${skills.length === 1 ? 'skill encontrada' : 'skills encontradas'}` : error ? 'Não foi possível carregar' : 'Carregando skills…'}<span> · {scope === 'project' ? 'Projeto' : 'Globais'}</span></span>{!importing && <span className="impmenu"><button type="button" className="mini" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>＋ Importar skill ▾</button>{menu && <div className="modemenu impdrop" role="menu"><button type="button" role="menuitem" className="modeopt" onClick={() => { setMenu(false); setMode('one'); setImporting(true); setSource(''); setName('') }}><span className="mo-t"><b>Uma skill</b><small>Escolha a pasta da skill ou o SKILL.md</small></span></button><button type="button" role="menuitem" className="modeopt" onClick={() => { setMenu(false); setMode('folder'); setImporting(true); setSource(''); setName('') }}><span className="mo-t"><b>Uma pasta com várias skills</b><small>Detecta todas as skills dentro dela de uma vez</small></span></button></div>}</span>}</div>
    {importing && <div className="impbox"><button type="button" className="filepick" onClick={() => void choose()}>📄 {source || (mode === 'folder' ? 'Escolher a pasta com as skills' : 'Escolher pasta ou SKILL.md')}<small>{source ? 'selecionado' : 'clique para escolher'}</small></button>
      {mode === 'one' && <label className="f">Nome<input className="in" value={name} placeholder="nome-da-skill" onChange={(e) => setName(slug(e.target.value))} /></label>}
      <div className="f"><span>{mode === 'folder' ? 'Estas skills são de qual agente?' : 'Esta skill é de qual agente?'}</span><div className="provcards">{(['claude', 'codex'] as const).map((provider) => <button type="button" key={provider} className={origin === provider ? 'sel' : ''} onClick={() => setOrigin(provider)}><i className={`av lg ${provider}`}><ProviderLogo provider={provider} /></i><span><b>{providerName[provider]}</b><small>{provider === 'claude' ? 'Anthropic' : 'OpenAI'}</small></span></button>)}</div></div>
      <div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setImporting(false)}>Cancelar</button><button type="button" disabled={busy || !source || (mode === 'one' && !name)} onClick={() => void guard(async () => {
        if (mode === 'folder') { const result = await window.agentboard.invoke('skills:import-folder', { scope, projectId, folderPath: source, provider: origin }); setSkills(result.skills); setNotice(`${result.imported.length} ${result.imported.length === 1 ? 'skill importada' : 'skills importadas'}${result.skipped.length ? `; ${result.skipped.length} já existiam ou tinham nome inválido` : ''}.`) }
        else setSkills(await window.agentboard.invoke('skills:import', { scope, projectId, sourcePath: source, name, provider: origin }))
        setImporting(false) }, { title: mode === 'folder' ? 'Importar skills da pasta' : `Importar a skill ${name}`, detail: source })}>Importar</button></div></div>}
    <div className="stack sklist" style={{ gap: 8 }}>{loaded && skills.length === 0 && !importing ? <div className="emptyBox">{scope === 'project' ? 'Nenhuma skill encontrada neste projeto (procurei em todas as pastas). Use “Importar skill” para trazer uma ou uma pasta com várias.' : 'Nenhuma skill ainda.'}</div> : skills.map((skill) => {
      const from = skill.providers.claude === 'ready' ? 'claude' : 'codex'
      const expanded = open === skill.id
      return <div className={`skill-row compact ${expanded ? 'open' : ''}`} key={skill.id}>
        <div className="skill-top" role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setOpen(expanded ? undefined : skill.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(expanded ? undefined : skill.id) } }}>
          <span className="chev" aria-hidden="true">›</span>
          <div className="skname"><b>{skill.name}</b>{skill.origin && <small className="path">{skill.origin}{skill.detected ? ' · detectada no repositório' : ''}</small>}</div>
          <div className="provs" onClick={(e) => e.stopPropagation()}>{(['claude', 'codex'] as const).map((provider) => {
            const state = skill.providers[provider]
            if (state === 'ready') return <span key={provider} className={`ptile on ${provider} tip`} data-tip={providerName[provider]}><ProviderLogo provider={provider} /></span>
            if (state === 'converting') return <span key={provider} className="ptile busy tip" data-tip={`Convertendo para ${providerName[provider]}…`}><span className="spin" /></span>
            return <button type="button" key={provider} className={`ptile off ${provider} tip`} data-tip={`Adicionar ao ${providerName[provider]}`} aria-label={`Adicionar ao ${providerName[provider]}`} onClick={() => { setConverting({ name: skill.name, to: provider }); setReviewer(profiles.find((item) => item.provider === provider)?.id ?? profiles[0]?.id ?? '') }}><ProviderLogo provider={provider} /></button>
          })}</div></div>
        {expanded && <div className="skdetail"><p>{skill.description || 'Sem descrição.'}</p><div className="skactions"><button type="button" className="mini danger" onClick={() => setDeleting(skill)}>Excluir skill</button></div></div>}
        {running?.name === skill.name && <div className="running"><div className="row"><span className="spin" /><b>Convertendo e revisando…</b></div><div className="bar"><i /></div><span style={{ fontSize: 11, color: 'var(--accent)' }}>Um agente confere se a skill ficou completa.</span></div>}
        {converting?.name === skill.name && <div className="convbox"><p>Vou converter <b>{skill.name}</b> para uma skill <b>{providerName[converting.to]}</b> e usar um agente para revisar se ficou faltando algo. Escolha o agente revisor.</p>
          <div className="agentbar col2"><Select label="Agente revisor" value={reviewer} onChange={setReviewer} options={[{ value: '', label: 'Sem revisão por agente' }, ...profiles.map((item) => ({ value: item.id, label: `${item.label} · ${providerName[item.provider]}` }))]} /></div>
          <div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setConverting(undefined)}>Cancelar</button><button type="button" disabled={busy} onClick={() => void guard(async () => { await window.agentboard.invoke('skills:convert', { scope, projectId, name: skill.name, from, to: converting.to, reviewProfileId: reviewer || undefined }); setConverting(undefined); await load() }, { title: `Converter a skill ${skill.name}`, detail: `de ${providerName[from]} para ${providerName[converting.to]}` })}>Converter e revisar</button></div></div>}
      </div>
    })}</div>
    {scope === 'project' && globalCount !== undefined && <p className="foot">Também valem neste projeto as skills globais.</p>}
    {notice && <p className="hint" role="status" style={{ marginTop: 10 }}>{notice}</p>}
    {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
    {deleting && <ConfirmDialog eyebrow="Excluir skill" title={deleting.name} text={`A pasta da skill será apagada do disco${deleting.providers.claude === 'ready' && deleting.providers.codex === 'ready' ? ' nos dois agentes' : ''}${deleting.origin ? ` (${deleting.origin})` : ''}. Isso não pode ser desfeito.`} ok="Excluir" danger cancel={() => setDeleting(undefined)} confirm={() => { const target = deleting; setDeleting(undefined); void guard(async () => { try { setSkills(await window.agentboard.invoke('skills:delete', { scope, projectId, name: target.name })); setOpen(undefined) } catch (reason) { throw new Error(plainError(reason)) } }) }} />}
  </>
}
