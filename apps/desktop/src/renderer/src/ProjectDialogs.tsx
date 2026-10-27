import React, { useEffect, useState } from 'react'
import type { AgentProbe, AgentProfile, AppTheme, Project, ProjectInspection } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { GitMenu } from './BranchMenu'
import { FolderGlyph } from './icons'
import { SkillsPanel } from './SkillsPanel'
import { ConstitutionPanel } from './ConstitutionPanel'
import { GitPolicyPanel } from './GitPolicyPanel'
import { WorkflowPanel } from './WorkflowPanel'
import { ProjectIconPicker } from './ProjectIcon'
import { themes } from './SettingsDialog'
import { projectTheme, setProjectTheme } from './projectTheme'
import { Checkbox } from './Checkbox'

const useEscape = (close: () => void): void => { useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close]) }

/** Novo projeto: escolher ou arrastar a pasta (protótipo: `.sourcePick`). */
export function ProjectDialog({ close, created }: { close(): void; created(project: Project): void }): React.JSX.Element {
  const [name, setName] = useState(''), [icon, setIcon] = useState<string | null>(null), [sources, setSources] = useState<ProjectInspection[]>([]), [error, setError] = useState(''), [choosing, setChoosing] = useState(false), [dragging, setDragging] = useState(false)
  useEscape(close)
  const addPath = async (path: string): Promise<void> => {
    const inspected = await window.agentboard.invoke('projects:inspect', { localPath: path })
    setSources((current) => current.some((source) => source.localPath.toLocaleLowerCase() === inspected.localPath.toLocaleLowerCase()) ? current : [...current, inspected])
    setName((current) => current.trim() ? current : inspected.name)
  }
  const choose = async (): Promise<void> => { try { setChoosing(true); setError(''); const path = await window.agentboard.invoke('projects:choose-directory', undefined); if (path) await addPath(path) } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } finally { setChoosing(false) } }
  const drop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault(); setDragging(false); setError('')
    try { for (const file of Array.from(event.dataTransfer.files)) { const path = window.agentboard.getDroppedFilePath(file); if (path) await addPath(path) } } catch (reason) { setError(String(reason).replace(/^Error: /, '')) }
  }
  const submit = async (): Promise<void> => { try { created(await window.agentboard.invoke('projects:create', { name: name.trim() || undefined, sourcePaths: sources.map((source) => source.localPath), profileIds: [], icon })) } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } }
  return <div className="overlay"><div className="modal">
    <header><div><div className="eyebrow">Novo projeto</div><h2>Criar projeto</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    <div className="stack">
      <label className="f">Nome do projeto<input className="in" placeholder="Nome do projeto" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <ProjectIconPicker name={name} icon={icon} onChange={setIcon} />
      {sources.map((source) => <div className="srcbox" key={source.localPath}>
        <div className="srchead"><span className="t"><b>{source.name}</b><small>{source.localPath}</small></span><button type="button" className="mini secondary" onClick={() => setSources((current) => current.filter((item) => item.localPath !== source.localPath))}>Remover</button></div>
        {source.repositories.length ? <><span className="sectitle">{source.repositories.length} {source.repositories.length === 1 ? 'repositório' : 'repositórios'}</span>
          <ul className="repolist">{source.repositories.map((repository) => <li key={repository.localPath}><FolderGlyph /><span className="rn">{repository.name}</span><span className="ctxchip" title={`Branch ${repository.currentBranch}`}>{repository.currentBranch}</span></li>)}</ul></>
          : <small className="hint">Pasta sem Git — disponível para planejamento</small>}
      </div>)}
      {!sources.length && <button className="sourcePick" type="button" disabled={choosing} style={dragging ? { borderColor: 'var(--accent)' } : undefined} onClick={() => void choose()} onDragEnter={(e) => { e.preventDefault(); setDragging(true) }} onDragOver={(e) => e.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(e) => void drop(e)}>📁 {choosing ? 'Abrindo pastas…' : 'Escolha ou arraste uma pasta'}<small>Clique em qualquer lugar desta área</small></button>}
    </div>
    {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
    <div className="actions"><button className="secondary" onClick={close}>Cancelar</button><button disabled={!sources.length} onClick={() => void submit()}>Criar projeto</button></div>
  </div></div>
}

/** Configurar projeto (protótipo `pcfg`): aba Geral (nome e agentes permitidos), Constituição e Skills do repositório. */

/** Tema do projeto: mostra só o escolhido; ao clicar abre a lista com as cores de cada tema. Vale na hora, só para este projeto. */
function ThemePicker({ value, onChange }: { value: AppTheme | null; onChange(value: AppTheme | null): void }): React.JSX.Element {
  const [open, setOpen] = useState(false), root = React.useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key, true) }
  }, [open])
  const current = themes.find((theme) => theme.value === value)
  const face = (label: string, swatches?: readonly string[]): React.JSX.Element => <><span className="sw3">{swatches ? swatches.map((color) => <i key={color} style={{ background: color }} />) : <i className="auto" />}</span><span className="tn">{label}</span></>
  return <div className="f themepick" ref={root}><span>Tema</span>
    <button type="button" className="themetrigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>{face(current?.label ?? 'Padrão do app', current?.swatches)}<span className="chev">▾</span></button>
    {open && <div className="themelist" role="listbox" aria-label="Tema do projeto">
      <button type="button" role="option" aria-selected={value === null} className={value === null ? 'on' : ''} onClick={() => { onChange(null); setOpen(false) }}>{face('Padrão do app')}</button>
      {themes.map((theme) => <button type="button" role="option" aria-selected={value === theme.value} key={theme.value} className={value === theme.value ? 'on' : ''} onClick={() => { onChange(theme.value); setOpen(false) }}>{face(theme.label, theme.swatches)}</button>)}
    </div>}
    <small className="hint">Vale só para este projeto e é aplicado na hora.</small>
  </div>
}

/** Time de agentes do projeto: só os liberados, com o ícone, o nome embaixo e uma bolinha de conexão; o "+" no fim adiciona outro. */
function AgentTeam({ profiles, allowed, setAllowed, probes }: { profiles: AgentProfile[]; allowed: string[]; setAllowed(value: string[]): void; probes: Record<string, AgentProbe> }): React.JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const team = profiles.filter((profile) => allowed.includes(profile.id)), rest = profiles.filter((profile) => !allowed.includes(profile.id))
  const state = (id: string): { tone: 'on' | 'off' | 'wait'; text: string } => { const probe = probes[id]; return !probe ? { tone: 'wait', text: 'verificando…' } : !probe.installed ? { tone: 'off', text: 'não instalado' } : !probe.authenticated ? { tone: 'off', text: 'login necessário' } : { tone: 'on', text: 'conectado' } }
  return <div className="stack" style={{ gap: 8 }}><span className="sectitle">Time de agentes</span>
    {profiles.length === 0 && <div className="emptyBox">Cadastre um agente em Configurações para liberar aqui.</div>}
    <div className="team">
      {team.map((profile) => { const info = state(profile.id); return <div className="teamcard" key={profile.id}>
        <span className="teamav"><AgentIcon profile={profile} size="lg" tip={false} /><i className={`teamdot ${info.tone} tip`} data-tip={info.text} aria-label={info.text} /></span>
        <b title={profile.label}>{profile.label}</b><small>{profile.provider === 'codex' ? 'Codex' : 'Claude'}</small>
        <button type="button" className="teamx tip" data-tip="Tirar do time" aria-label={`Tirar ${profile.label} do time`} onClick={() => setAllowed(allowed.filter((id) => id !== profile.id))}>×</button></div> })}
      {profiles.length > 0 && <button type="button" className="teamadd tip" data-tip={rest.length ? 'Adicionar ao time' : 'Todos os agentes já estão no time'} aria-label="Adicionar agente ao time" disabled={!rest.length} onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: box.left, y: box.bottom + 6 }) }}><span>+</span></button>}
    </div>
    {team.length === 0 && profiles.length > 0 && <small className="hint">Nenhum agente no time ainda: sem agentes, o projeto não consegue rodar nada.</small>}
    {menu && <GitMenu x={menu.x} y={menu.y} title="Adicionar ao time" label="Adicionar agente ao time" items={rest.map((profile) => ({ key: profile.id, label: `${profile.label} · ${state(profile.id).text}` }))} run={(id) => { setMenu(null); setAllowed([...allowed, id]) }} close={() => setMenu(null)} />}
  </div>
}

export function ProjectConfigDialog({ project, profiles, saved, openConstitutionChat, initialTab }: { project: Project; profiles: AgentProfile[]; saved(): void | Promise<void>; openConstitutionChat(prompt?: string): void; initialTab?: 'general' | 'git' }): React.JSX.Element {
  const [tab, setTab] = useState<'general' | 'git' | 'workflow' | 'theme' | 'constitution' | 'skills'>(initialTab ?? 'general'), [name, setName] = useState(project.name), [icon, setIcon] = useState(project.icon), [allowed, setAllowed] = useState(project.allowedProfileIds), [editingName, setEditingName] = useState(false), [saveState, setSaveState] = useState<'idle' | 'waiting' | 'saving' | 'saved'>('idle'), [error, setError] = useState(''), [ownTheme, setOwnTheme] = useState<AppTheme | null>(() => projectTheme(project.id)), [probes, setProbes] = useState<Record<string, AgentProbe>>({})
  const savedIdentity = React.useRef({ name: project.name, icon: project.icon }), identity = React.useRef({ name, icon }), saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null), saveQueue = React.useRef<Promise<void>>(Promise.resolve()), profileQueue = React.useRef<Promise<boolean>>(Promise.resolve(true)), saveVersion = React.useRef(0), profileVersion = React.useRef(0), closing = React.useRef(false)
  identity.current = { name, icon }
  useEffect(() => { void window.agentboard.invoke('profiles:probe-all', undefined).then((all) => setProbes(Object.fromEntries(all.map((probe) => [probe.profileId, probe])))).catch(() => undefined) }, [])
  const persistIdentity = React.useCallback(async (nextName: string, nextIcon: string | null): Promise<boolean> => {
    const cleanName = nextName.trim()
    if (!cleanName) { setError('O projeto precisa ter um nome.'); return false }
    if (savedIdentity.current.name === cleanName && savedIdentity.current.icon === nextIcon) return true
    const version = ++saveVersion.current
    setSaveState('saving'); setError('')
    const operation = saveQueue.current.catch(() => undefined).then(async () => {
      if (savedIdentity.current.name === cleanName && savedIdentity.current.icon === nextIcon) return
      await window.agentboard.invoke('projects:update', { projectId: project.id, name: cleanName, icon: nextIcon })
      savedIdentity.current = { name: cleanName, icon: nextIcon }
    })
    saveQueue.current = operation
    try { await operation; if (version === saveVersion.current) setSaveState('saved'); return true } catch (reason) { if (version === saveVersion.current) { setSaveState('idle'); setError(String(reason).replace(/^Error: /, '')) } return false }
  }, [project.id])
  useEffect(() => {
    if (!name.trim() || (savedIdentity.current.name === name.trim() && savedIdentity.current.icon === icon)) return
    setSaveState('waiting')
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void persistIdentity(name, icon) }, 650)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = null }
  }, [icon, name, persistIdentity])
  const finish = React.useCallback(async (): Promise<void> => {
    if (closing.current) return
    closing.current = true
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    const current = identity.current
    const validName = current.name.trim() ? current.name : savedIdentity.current.name
    if (!current.name.trim()) setName(validName)
    if (!await persistIdentity(validName, current.icon)) { closing.current = false; return }
    await saveQueue.current.catch(() => undefined)
    if (!await profileQueue.current) { closing.current = false; return }
    await saved()
  }, [persistIdentity, saved])
  useEscape(() => { void finish() })
  const changeAllowed = (next: string[]): void => {
    const previous = allowed, version = ++profileVersion.current
    setAllowed(next); setSaveState('saving'); setError('')
    const operation = profileQueue.current.catch(() => false).then(async () => { await window.agentboard.invoke('projects:set-profiles', { projectId: project.id, profileIds: next }); return true })
    profileQueue.current = operation.catch(() => false)
    void operation.then(() => { if (version === profileVersion.current) setSaveState('saved') }).catch((reason: unknown) => { if (version === profileVersion.current) { setAllowed(previous); setSaveState('idle'); setError(String(reason).replace(/^Error: /, '')) } })
  }
  const stopEditingName = (): void => { if (!name.trim()) setName(savedIdentity.current.name); setEditingName(false) }
  const saveLabel = saveState === 'waiting' ? 'Salvamento automático pendente' : saveState === 'saving' ? 'Salvando…' : saveState === 'saved' ? 'Salvo automaticamente' : 'As alterações são salvas automaticamente'
  return <div className="overlay"><div className="modal pcfg" style={{ width: 'min(920px,100%)' }}>
    <header><div className="pcfg-heading"><div className="eyebrow">Configurar projeto</div><div className="pcfg-identity"><ProjectIconPicker compact name={name} icon={icon} onChange={setIcon} /><div className="pcfg-name"><h2>{editingName
      ? <input className="pcfg-name-input" value={name} autoFocus aria-label="Nome do projeto" onFocus={(event) => event.currentTarget.select()} onChange={(event) => { setName(event.target.value); setError('') }} onBlur={stopEditingName} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.stopPropagation(); setName(savedIdentity.current.name); setEditingName(false) } }} />
      : <button type="button" className="pcfg-name-edit" onClick={() => setEditingName(true)} title="Editar nome do projeto"><span>{name.trim() || project.name}</span><span className="pcfg-name-pencil" aria-hidden="true">✎</span></button>}</h2><small className={`pcfg-save-state ${saveState}`}>{saveLabel}</small></div></div></div><button className="x" onClick={() => void finish()} aria-label="Fechar">×</button></header>
    <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>{([['general', 'Geral'], ['git', 'Git'], ['workflow', 'Workflow'], ['skills', 'Skills']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={`tab ${tab === value ? 'on' : ''}`} onClick={() => setTab(value)}>{label}</button>)}</div>
    <div className={`pcfg-body ${tab === 'skills' ? 'fill' : ''}`}>{tab === 'general' ? <>
      <div className="stack"><ThemePicker value={ownTheme} onChange={(value) => { setOwnTheme(value); setProjectTheme(project.id, value) }} />
        <AgentTeam profiles={profiles} allowed={allowed} setAllowed={changeAllowed} probes={probes} />
        <div className="stack" style={{ gap: 8 }}><span className="sectitle">Constituição</span><ConstitutionPanel projectId={project.id} openChat={openConstitutionChat} /></div></div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}</>
      : tab === 'git' ? <GitPolicyPanel projectId={project.id} />
      : tab === 'workflow' ? <WorkflowPanel projectId={project.id} />
      : <div className="skwrap"><SkillsPanel scope="project" projectId={project.id} profiles={profiles.filter((profile) => allowed.includes(profile.id))} globalCount={0} /></div>}</div>
  </div></div>
}

/** Card sem agente liberado no projeto: libera um já cadastrado ou leva ao cadastro. */
export function NoAgentDialog({ project, profiles, close, allowed, openSettings }: { project: Project; profiles: AgentProfile[]; close(): void; allowed(): void; openSettings(): void }): React.JSX.Element {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEscape(close)
  const use = async (profile: AgentProfile): Promise<void> => {
    setBusy(true); setError('')
    try { await window.agentboard.invoke('projects:set-profiles', { projectId: project.id, profileIds: [...new Set([...project.allowedProfileIds, profile.id])] }); allowed() } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } finally { setBusy(false) }
  }
  return <div className="overlay"><div className="modal" style={{ width: 'min(480px,100%)' }}>
    <header><div><div className="eyebrow">Agente</div><h2>Escolha quem vai trabalhar neste projeto</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    <p style={{ marginBottom: 12 }}>O projeto ainda não tem um agente liberado. Escolha um já cadastrado ou cadastre um novo.</p>
    <div className="stack" style={{ gap: 8 }}>{profiles.map((profile) => <div className="ck-line" key={profile.id}><AgentIcon profile={profile} tip={false} /><span className="t">{profile.label}<small>{profile.provider === 'codex' ? 'Codex' : 'Claude'} · {profile.scope}</small></span><button className="mini" disabled={busy} onClick={() => void use(profile)}>Usar</button></div>)}</div>
    {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
    <button className="bigadd" onClick={openSettings}>＋ Cadastrar agente</button>
  </div></div>
}

/** Logo depois de criar o projeto: quais agentes vão trabalhar nele. Sem agente cadastrado, manda cadastrar no sistema primeiro. */
export function ProjectAgentsDialog({ project, profiles, close, saved, openSettings }: { project: Project; profiles: AgentProfile[]; close(): void; saved(): void; openSettings(): void }): React.JSX.Element {
  const [allowed, setAllowed] = useState<string[]>(project.allowedProfileIds), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEscape(close)
  const submit = async (): Promise<void> => {
    setBusy(true); setError('')
    try { await window.agentboard.invoke('projects:set-profiles', { projectId: project.id, profileIds: allowed }); saved() } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } finally { setBusy(false) }
  }
  return <div className="overlay"><div className="modal" style={{ width: 'min(520px,100%)' }}>
    <header><div><div className="eyebrow">Projeto criado</div><h2>Quais agentes vão trabalhar em {project.name}?</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    {profiles.length === 0 ? <>
      <div className="emptyBox">Você ainda não tem nenhum agente cadastrado. Adicione um agente no sistema primeiro; depois volte aqui para liberá-lo neste projeto.</div>
      <button className="bigadd" onClick={openSettings}>＋ Cadastrar agente no sistema</button>
      <div className="actions"><button className="secondary" onClick={close}>Agora não</button></div></>
    : <>
      <p style={{ marginBottom: 12 }}>Escolha quais dos agentes cadastrados podem trabalhar neste projeto. Você pode mudar isso depois em Configurar projeto.</p>
      <div className="stack" style={{ gap: 8 }}>{profiles.map((profile) => <label className="ck-line" key={profile.id}>
        <Checkbox checked={allowed.includes(profile.id)} onChange={() => setAllowed(allowed.includes(profile.id) ? allowed.filter((id) => id !== profile.id) : [...allowed, profile.id])} />
        <AgentIcon profile={profile} tip={false} /><span className="t">{profile.label}<small>{profile.provider === 'codex' ? 'Codex' : 'Claude'} · {profile.scope}</small></span></label>)}</div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="actions"><button className="secondary" onClick={openSettings}>Cadastrar outro agente</button><button className="secondary" onClick={close}>Agora não</button><button disabled={busy || allowed.length === 0} onClick={() => void submit()}>Liberar agentes</button></div></>}
  </div></div>
}
