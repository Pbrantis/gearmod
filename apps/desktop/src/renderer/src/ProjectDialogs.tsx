import React, { useEffect, useState } from 'react'
import type { AgentProbe, AgentProfile, Project, ProjectInspection } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { FolderGlyph } from './icons'
import { SkillsPanel } from './SkillsPanel'

const useEscape = (close: () => void): void => { useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close]) }

/** Novo projeto: escolher ou arrastar a pasta (protótipo: `.sourcePick`). */
export function ProjectDialog({ close, created }: { close(): void; created(project: Project): void }): React.JSX.Element {
  const [name, setName] = useState(''), [sources, setSources] = useState<ProjectInspection[]>([]), [error, setError] = useState(''), [choosing, setChoosing] = useState(false), [dragging, setDragging] = useState(false)
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
  const submit = async (): Promise<void> => { try { created(await window.agentboard.invoke('projects:create', { name: name.trim() || undefined, sourcePaths: sources.map((source) => source.localPath), profileIds: [] })) } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } }
  return <div className="overlay"><div className="modal">
    <header><div><div className="eyebrow">Novo projeto</div><h2>Criar projeto</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    <div className="stack">
      <label className="f">Nome do projeto<input className="in" placeholder="Nome do projeto" value={name} onChange={(e) => setName(e.target.value)} /></label>
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

/** Configurar projeto (protótipo `pcfg`): aba Geral (nome e agentes permitidos) e aba Skills do repositório. */
export function ProjectConfigDialog({ project, profiles, close, saved }: { project: Project; profiles: AgentProfile[]; close(): void; saved(): void }): React.JSX.Element {
  const [tab, setTab] = useState<'general' | 'skills'>('general'), [name, setName] = useState(project.name), [allowed, setAllowed] = useState(project.allowedProfileIds), [error, setError] = useState(''), [probes, setProbes] = useState<Record<string, AgentProbe>>({})
  useEscape(close)
  useEffect(() => { void window.agentboard.invoke('profiles:probe-all', undefined).then((all) => setProbes(Object.fromEntries(all.map((probe) => [probe.profileId, probe])))).catch(() => undefined) }, [])
  const submit = async (): Promise<void> => { try { await window.agentboard.invoke('projects:update', { projectId: project.id, name }); await window.agentboard.invoke('projects:set-profiles', { projectId: project.id, profileIds: allowed }); saved() } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } }
  const status = (id: string): string => { const probe = probes[id]; return probe ? (probe.installed ? (probe.authenticated ? 'conectado' : 'login necessário') : 'não instalado') : 'verificando…' }
  return <div className="overlay"><div className="modal" style={{ width: 'min(680px,100%)' }}>
    <header><div><div className="eyebrow">Configurar projeto</div><h2>{project.name}</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>{([['general', 'Geral'], ['skills', 'Skills']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={`tab ${tab === value ? 'on' : ''}`} onClick={() => setTab(value)}>{label}</button>)}</div>
    {tab === 'general' ? <>
      <div className="stack"><label className="f">Nome<input className="in" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="stack" style={{ gap: 8 }}><span className="sectitle">Agentes permitidos</span>{profiles.length === 0 && <div className="emptyBox">Cadastre um agente em Configurações para liberar aqui.</div>}{profiles.map((profile) => <label className="ck-line" key={profile.id}>
          <span className="ckwrap"><input type="checkbox" checked={allowed.includes(profile.id)} onChange={() => setAllowed(allowed.includes(profile.id) ? allowed.filter((id) => id !== profile.id) : [...allowed, profile.id])} /><span className="ck"><svg viewBox="0 0 12 12"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg></span></span>
          <AgentIcon profile={profile} tip={false} /><span className="t">{profile.label}<small>{profile.provider === 'codex' ? 'Codex' : 'Claude'} · {status(profile.id)}</small></span></label>)}</div></div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="actions"><button className="secondary" onClick={close}>Cancelar</button><button onClick={() => void submit()}>Salvar</button></div></>
      : <><SkillsPanel scope="project" projectId={project.id} profiles={profiles.filter((profile) => allowed.includes(profile.id))} globalCount={0} /><div className="actions"><button className="secondary" onClick={close}>Fechar</button></div></>}
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
        <span className="ckwrap"><input type="checkbox" checked={allowed.includes(profile.id)} onChange={() => setAllowed(allowed.includes(profile.id) ? allowed.filter((id) => id !== profile.id) : [...allowed, profile.id])} /><span className="ck"><svg viewBox="0 0 12 12"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg></span></span>
        <AgentIcon profile={profile} tip={false} /><span className="t">{profile.label}<small>{profile.provider === 'codex' ? 'Codex' : 'Claude'} · {profile.scope}</small></span></label>)}</div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="actions"><button className="secondary" onClick={openSettings}>Cadastrar outro agente</button><button className="secondary" onClick={close}>Agora não</button><button disabled={busy || allowed.length === 0} onClick={() => void submit()}>Liberar agentes</button></div></>}
  </div></div>
}
