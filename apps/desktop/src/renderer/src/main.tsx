import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { AgentProfile, AppSettings, Project, ProjectBoard } from '@agentboard/contracts'
import './prototype.css'
import { Board } from './Board'
import { ProjectAgentsDialog, ProjectConfigDialog, ProjectDialog } from './ProjectDialogs'
import { applySettings, SettingsDialog } from './SettingsDialog'
import { projectTheme, projectThemeEvent } from './projectTheme'
import { Sidebar } from './Sidebar'
import { FolderGlyph } from './icons'
import logo from './assets/logo.png'
import { ConfirmDialog } from './ConfirmDialog'
import { TooltipLayer } from './Tooltip'
import { pop } from './popout'
import { applyMessageSpacing } from './chatPrefs'
import { TerminalPanel } from './TerminalPanel'
import { terminal, useTerminal } from './terminalStore'
import { WorkspaceFiles } from './WorkspaceFiles'
import { gitChangedEvent } from './GitSetup'
import { TasksButton } from './TasksButton'
import { refreshGit } from './gitConfigCache'
import type { FileChange } from './changes'
import { hasAttachmentTarget, hasCommentTarget, queueContextFile, queueContextText } from './Attachments'

const defaultSettings: AppSettings = { tema: 'green', idioma: 'pt-BR', voz: 'small', notificacoes: true, retomarSozinho: true }

function App(): React.JSX.Element {
  const terminalState = useTerminal()
  const [filesOpen, setFilesOpen] = useState(pop?.kind === 'file'), [fileContext, setFileContext] = useState<{ projectId: string; cardId: string | null; path?: string } | null>(pop?.kind === 'file' ? { projectId: pop.projectId, cardId: pop.cardId, path: pop.path ?? undefined } : null)
  const [changesView, setChangesView] = useState<{ projectId: string; cardId: string; files: FileChange[]; at: number } | null>(null)
  const [fileSessions, setFileSessions] = useState<Array<{ projectId: string; cardId: string | null; path?: string }>>(fileContext ? [fileContext] : [])
  const showFiles = (target: { projectId: string; cardId: string | null; path?: string }): void => {
    setFileSessions((all) => all.some((item) => item.projectId === target.projectId && item.cardId === target.cardId) ? all.map((item) => item.projectId === target.projectId && item.cardId === target.cardId ? { ...item, ...target } : item) : [...all, target]); setFileContext(target); setFilesOpen(true)
  }
  const [projects, setProjects] = useState<Project[]>([]), [profiles, setProfiles] = useState<AgentProfile[]>([]), [selected, setSelected] = useState<string | undefined>(pop?.projectId), [board, setBoard] = useState<ProjectBoard>()
  const [removed, setRemoved] = useState<AgentProfile[]>([]), [freeRequest, setFreeRequest] = useState<{ projectId: string; at: number }>(), [constitutionRequest, setConstitutionRequest] = useState<{ projectId: string; prompt?: string; at: number }>(), [openTarget, setOpenTarget] = useState<{ projectId: string; cardId: string | null; chatId: string | null; purpose: string | null } | undefined>(pop?.kind === 'chat' && (pop.cardId || pop.chatId) ? { projectId: pop.projectId, cardId: pop.cardId, chatId: pop.chatId, purpose: pop.purpose } : undefined), [newProject, setNewProject] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [projectConfig, setProjectConfig] = useState(false), [settings, setSettings] = useState<AppSettings>(defaultSettings), [collapsed, setCollapsed] = useState(false), [agentsPrompt, setAgentsPrompt] = useState<string>(), [error, setError] = useState(''), [deleting, setDeleting] = useState<Project>()
  const [configTab, setConfigTab] = useState<'general' | 'git'>('general')
  const reloadProjects = async (): Promise<void> => { const [p, a, gone] = await Promise.all([window.agentboard.invoke('projects:list', undefined), window.agentboard.invoke('profiles:list', undefined), window.agentboard.invoke('profiles:removed', undefined)]); setProjects(p); setProfiles(a); setRemoved(gone.map((item) => ({ ...item, label: `${item.label} (desativado)` }))) }
  const reloadBoard = async (id = selected): Promise<void> => { if (id) setBoard(await window.agentboard.invoke('board:get', { projectId: id })) }
  const refresh = async (): Promise<void> => { await Promise.all([reloadBoard(), reloadProjects()]) }
  const toggleFiles = (): void => {
    if (filesOpen && fileContext?.projectId === selected) { setFilesOpen(false); return }
    if (!selected) return
    const context = terminal.snapshot().context
    showFiles({ projectId: selected, cardId: context?.projectId === selected ? context.cardId : null })
  }
  const toggleTerminal = (): void => { const current = terminal.snapshot(); if (current.open) terminal.setOpen(false); else if (!current.tabs.length) void terminal.newTab(); else terminal.setOpen(true) }
  useEffect(() => { if (selected && terminal.snapshot().context?.projectId !== selected) terminal.setContext({ projectId: selected, cardId: null }) }, [selected])
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyF') { event.preventDefault(); toggleFiles() }
      else if (event.ctrlKey && (event.key === '^' || event.key === '`' || event.key === 'Dead' || event.code === 'Backquote')) { event.preventDefault(); toggleTerminal() }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [selected, filesOpen, fileContext])
  useEffect(() => window.agentboard.onRunEvent((event) => {
    if (event.eventType === 'agentboard/attach-file' && !pop) {
      const target = event.payload as { projectId: string; cardId: string | null; path: string }
      const attached = hasAttachmentTarget(target); queueContextFile(target); setSelected(target.projectId)
      if (!attached) { if (target.cardId) setOpenTarget({ projectId: target.projectId, cardId: target.cardId, chatId: null, purpose: 'execution' }); else setFreeRequest({ projectId: target.projectId, at: Date.now() }) }
      setFilesOpen(false); return
    }
    if (event.eventType === 'agentboard/comment-file' && !pop) {
      const target = event.payload as { projectId: string; cardId: string | null; text: string }
      const attached = hasCommentTarget(target); queueContextText(target); setSelected(target.projectId)
      if (!attached) { if (target.cardId) setOpenTarget({ projectId: target.projectId, cardId: target.cardId, chatId: null, purpose: 'execution' }); else setFreeRequest({ projectId: target.projectId, at: Date.now() }) }
      setFilesOpen(false); return
    }
    if (event.eventType !== 'agentboard/open-file' || pop) return
    const target = event.payload as { projectId: string; cardId: string | null; path: string }
    setSelected(target.projectId); showFiles(target)
  }), [])
  useEffect(() => {
    const open = (event: Event): void => { const target = (event as CustomEvent<{ projectId: string; cardId: string | null; path: string }>).detail; setSelected(target.projectId); showFiles(target) }
    const changes = (event: Event): void => { const detail = (event as CustomEvent<{ projectId: string; cardId: string; files: FileChange[] }>).detail; setSelected(detail.projectId); setChangesView({ ...detail, at: Date.now() }) }
    window.addEventListener('agentboard:open-file', open); window.addEventListener('agentboard:open-changes', changes)
    return () => { window.removeEventListener('agentboard:open-file', open); window.removeEventListener('agentboard:open-changes', changes) }
  }, [])
  useEffect(() => { void window.agentboard.invoke('settings:get', undefined).then(setSettings).catch((e: unknown) => setError(String(e))) }, [])
  const [themeTick, setThemeTick] = useState(0)
  useEffect(() => { const again = (): void => setThemeTick((value) => value + 1); window.addEventListener(projectThemeEvent, again); return () => window.removeEventListener(projectThemeEvent, again) }, [])
  // Tema global nas configurações; cada projeto pode ter o seu (Configurar projeto > Geral) e vale enquanto ele está aberto.
  useEffect(() => { applySettings(settings); const own = projectTheme(selected); if (own) document.documentElement.dataset.accent = own }, [settings, selected, themeTick])
  useEffect(() => { void reloadProjects().catch((e: unknown) => setError(String(e))) }, [])
  // Clique numa notificação do sistema: vai para o projeto e abre o chat do card (ou o chat livre).
  useEffect(() => window.agentboard.onRunEvent((event) => { if (event.eventType === 'agentboard/open-target') { const target = event.payload as { projectId: string; cardId: string | null; chatId: string | null; purpose: string | null }; setSelected(target.projectId); setOpenTarget(target) } }), [])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (['agentboard/run-started', 'agentboard/run-completed', 'agentboard/card-updated'].includes(event.eventType)) void reloadProjects() }), [])
  // Ao abrir o projeto, procura repositórios criados ou configurados por fora e, se o cadastro mudou, recarrega o quadro.
  useEffect(() => {
    if (!selected) { setBoard(undefined); return }
    let alive = true
    void reloadBoard(selected).then(() => refreshGit(selected)).then((changed) => { if (alive && changed) return reloadBoard(selected) }).catch((e: unknown) => { if (alive) setError(String(e)) })
    return () => { alive = false }
  }, [selected])
  useEffect(() => { const again = (): void => { void refresh().catch(() => undefined) }; window.addEventListener(gitChangedEvent, again); return () => window.removeEventListener(gitChangedEvent, again) }, [selected])
  return <>
    {/* Faixa de cima: arrasta a janela; os botões do Windows ficam à direita, por cima dela. */}
    <div className={`titlebar ${collapsed ? 'collapsed' : ''}`}>{!pop && <span className="tb-side" />}<span className="tb-brand"><img src={logo} alt="" draggable={false} />AgentBoard</span>{board && <span className="pathchip tb-path tip" data-tip="Pasta do projeto"><FolderGlyph />{board.project.localPath}</span>}{pop?.kind !== 'file' && <div className="tb-actions"><TasksButton /><button type="button" className={`ibtn tip ${terminalState.open ? 'on' : ''}`} disabled={!selected} data-tip="Terminal (Ctrl+^)" aria-label="Alternar terminal" aria-pressed={terminalState.open} onClick={toggleTerminal}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 5 5 5-5 5M11 15h5" /></svg></button><button type="button" className={`ibtn tip ${filesOpen ? 'on' : ''}`} disabled={!selected} data-tip="Arquivos (Ctrl+Shift+F)" aria-label="Alternar arquivos" aria-pressed={filesOpen} onClick={toggleFiles}><FolderGlyph /></button></div>}</div>
    <div className={`shell ${collapsed ? 'collapsed' : ''} ${pop ? 'popout' : ''}`}>
    {!pop && <Sidebar projects={projects} profiles={profiles} selected={selected} collapsed={collapsed} onSelect={setSelected} onNew={() => setNewProject(true)} onSettings={() => setSettingsOpen(true)} onNewChat={(id) => { setSelected(id); setFreeRequest({ projectId: id, at: Date.now() }) }} onToggle={() => setCollapsed(!collapsed)}
      onReorder={(ids) => { setProjects((current) => ids.map((id) => current.find((item) => item.id === id)!).filter(Boolean)); void window.agentboard.invoke('projects:reorder', { projectIds: ids }).then(setProjects).catch((e: unknown) => setError(String(e))) }}
      onDelete={setDeleting} />}
    {pop?.kind === 'file' || pop?.kind === 'terminal' ? <div /> : board ? <Board key={board.project.id} board={board} profiles={profiles} history={[...profiles, ...removed]} refresh={refresh} onProjectConfig={(tab) => { setConfigTab(tab ?? 'general'); setProjectConfig(true) }} openSettings={() => setSettingsOpen(true)} freeRequest={freeRequest} freeHandled={() => setFreeRequest(undefined)} constitutionRequest={constitutionRequest} constitutionHandled={() => setConstitutionRequest(undefined)} openTarget={openTarget} targetHandled={() => setOpenTarget(undefined)} />
      : <div className="content"><main><div className="head"><div className="lead"><div><div className="eyebrow">Trabalho local · estado durável</div><h1>{projects.length ? 'Escolha um projeto.' : 'Comece com uma pasta.'}</h1><p>Projetos, cards e transições persistem localmente entre reinícios.</p></div></div></div>{!projects.length && <button style={{ marginTop: 18 }} onClick={() => setNewProject(true)}>Adicionar primeiro projeto</button>}{error && <p className="error" style={{ marginTop: 14 }}>{error}</p>}</main></div>}
    {newProject && <ProjectDialog close={() => setNewProject(false)} created={async (project) => { setNewProject(false); await reloadProjects(); setSelected(project.id); setAgentsPrompt(project.id) }} />}
    {settingsOpen && <SettingsDialog profiles={profiles} settings={settings} close={() => setSettingsOpen(false)} changed={refresh} settingsChanged={setSettings} />}
    {agentsPrompt && !settingsOpen && !newProject && projects.find((item) => item.id === agentsPrompt) && <ProjectAgentsDialog project={projects.find((item) => item.id === agentsPrompt)!} profiles={profiles} close={() => setAgentsPrompt(undefined)} saved={async () => { setAgentsPrompt(undefined); await refresh() }} openSettings={() => setSettingsOpen(true)} />}
    {projectConfig && board && <ProjectConfigDialog initialTab={configTab} project={board.project} profiles={profiles} close={() => setProjectConfig(false)} saved={async () => { setProjectConfig(false); await refresh() }} openConstitutionChat={(prompt) => { setProjectConfig(false); setConstitutionRequest({ projectId: board.project.id, prompt, at: Date.now() }) }} />}
    {deleting && <ConfirmDialog eyebrow="Excluir projeto" title={deleting.name} text="O projeto sai do AgentBoard com os cards, chats, documentos e histórico dele. As pastas e os repositórios no disco não são apagados. Isso não pode ser desfeito." ok="Excluir projeto" danger cancel={() => setDeleting(undefined)} confirm={() => { const gone = deleting; setDeleting(undefined); void window.agentboard.invoke('projects:delete', { projectId: gone.id }).then(async () => { if (selected === gone.id) setSelected(undefined); await reloadProjects() }).catch((e: unknown) => setError(String(e).replace(/^Error invoking remote method '[^']+': /, '').replace(/^Error: /, ''))) }} />}
  </div>
    {changesView && <div className="wf-host"><WorkspaceFiles key={changesView.at} projectId={changesView.projectId} cardId={changesView.cardId} changes={changesView.files} startExpanded close={() => setChangesView(null)} /></div>}
    {fileSessions.map((session) => <div key={`${session.projectId}:${session.cardId}`} className="wf-host" style={{ display: filesOpen && session.projectId === selected && session.projectId === fileContext?.projectId && session.cardId === fileContext.cardId ? undefined : 'none' }}><WorkspaceFiles projectId={session.projectId} cardId={session.cardId} initialPath={session.path} standalone={pop?.kind === 'file'} close={() => { if (pop?.kind === 'file') window.close(); else setFilesOpen(false) }} /></div>)}
    <TerminalPanel standalone={pop?.kind === 'terminal'} />
    <TooltipLayer />
  </>
}

applyMessageSpacing()
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
