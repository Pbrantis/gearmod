import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { AgentProfile, AppSettings, Project, ProjectBoard } from '@agentboard/contracts'
import './prototype.css'
import { Board } from './Board'
import { ProjectAgentsDialog, ProjectConfigDialog, ProjectDialog } from './ProjectDialogs'
import { applySettings, SettingsDialog } from './SettingsDialog'
import { Sidebar } from './Sidebar'

const defaultSettings: AppSettings = { tema: 'green', idioma: 'pt-BR', voz: 'small' }

function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]), [profiles, setProfiles] = useState<AgentProfile[]>([]), [selected, setSelected] = useState<string>(), [board, setBoard] = useState<ProjectBoard>()
  const [removed, setRemoved] = useState<AgentProfile[]>([]), [freeRequest, setFreeRequest] = useState<{ projectId: string; at: number }>(), [newProject, setNewProject] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [projectConfig, setProjectConfig] = useState(false), [settings, setSettings] = useState<AppSettings>(defaultSettings), [collapsed, setCollapsed] = useState(false), [agentsPrompt, setAgentsPrompt] = useState<string>(), [error, setError] = useState('')
  const reloadProjects = async (): Promise<void> => { const [p, a, gone] = await Promise.all([window.agentboard.invoke('projects:list', undefined), window.agentboard.invoke('profiles:list', undefined), window.agentboard.invoke('profiles:removed', undefined)]); setProjects(p); setProfiles(a); setRemoved(gone.map((item) => ({ ...item, label: `${item.label} (desativado)` }))) }
  const reloadBoard = async (id = selected): Promise<void> => { if (id) setBoard(await window.agentboard.invoke('board:get', { projectId: id })) }
  const refresh = async (): Promise<void> => { await Promise.all([reloadBoard(), reloadProjects()]) }
  useEffect(() => { void window.agentboard.invoke('settings:get', undefined).then(setSettings).catch((e: unknown) => setError(String(e))) }, [])
  useEffect(() => { applySettings(settings) }, [settings])
  useEffect(() => { void reloadProjects().catch((e: unknown) => setError(String(e))) }, [])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (['agentboard/run-started', 'agentboard/run-completed', 'agentboard/card-updated'].includes(event.eventType)) void reloadProjects() }), [])
  useEffect(() => { if (selected) void reloadBoard(selected).catch((e: unknown) => setError(String(e))); else setBoard(undefined) }, [selected])
  return <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
    <Sidebar projects={projects} profiles={profiles} selected={selected} collapsed={collapsed} onSelect={setSelected} onNew={() => setNewProject(true)} onSettings={() => setSettingsOpen(true)} onNewChat={(id) => { setSelected(id); setFreeRequest({ projectId: id, at: Date.now() }) }} onToggle={() => setCollapsed(!collapsed)} />
    {board ? <Board board={board} profiles={profiles} history={[...profiles, ...removed]} refresh={refresh} onProjectConfig={() => setProjectConfig(true)} openSettings={() => setSettingsOpen(true)} freeRequest={freeRequest} freeHandled={() => setFreeRequest(undefined)} />
      : <div className="content"><main><div className="head"><div className="lead"><div><div className="eyebrow">Trabalho local · estado durável</div><h1>{projects.length ? 'Escolha um projeto.' : 'Comece com uma pasta.'}</h1><p>Projetos, cards e transições persistem localmente entre reinícios.</p></div></div></div>{!projects.length && <button style={{ marginTop: 18 }} onClick={() => setNewProject(true)}>Adicionar primeiro projeto</button>}{error && <p className="error" style={{ marginTop: 14 }}>{error}</p>}</main></div>}
    {newProject && <ProjectDialog close={() => setNewProject(false)} created={async (project) => { setNewProject(false); await reloadProjects(); setSelected(project.id); setAgentsPrompt(project.id) }} />}
    {settingsOpen && <SettingsDialog profiles={profiles} settings={settings} close={() => setSettingsOpen(false)} changed={refresh} settingsChanged={setSettings} />}
    {agentsPrompt && !settingsOpen && !newProject && projects.find((item) => item.id === agentsPrompt) && <ProjectAgentsDialog project={projects.find((item) => item.id === agentsPrompt)!} profiles={profiles} close={() => setAgentsPrompt(undefined)} saved={async () => { setAgentsPrompt(undefined); await refresh() }} openSettings={() => setSettingsOpen(true)} />}
    {projectConfig && board && <ProjectConfigDialog project={board.project} profiles={profiles} close={() => setProjectConfig(false)} saved={async () => { setProjectConfig(false); await refresh() }} />}
  </div>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
