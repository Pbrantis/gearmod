import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import type { AgentProbe, AgentProfile, AppSettings, Card, Project, ProjectBoard, ProjectInspection } from '@agentboard/contracts'
import './theme.css'
import './styles.css'
import './agents.css'
import './probe.css'
import './chat.css'
import { AgentManager } from './AgentManager'
import { AgentIcon, ProviderLogo } from './AgentIcon'
import { CardTile, priorityLabel } from './CardTile'
import { CardEditor, blankDraft, type Draft } from './CardEditor'
import { CardChat } from './CardChat'
import { NewCardDialog } from './NewCardDialog'
import { StartDialog } from './StartDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { FolderGlyph } from './icons'
import { applySettings } from './Appearance'

type AgentDraft = { provider: 'codex' | 'claude'; label: string; scope: string; useExistingSession: boolean }
const defaultSettings: AppSettings = { tema: 'green', idioma: 'pt-BR' }

function App(): React.JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]), [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [selected, setSelected] = useState<string>(), [board, setBoard] = useState<ProjectBoard>(), [newProject, setNewProject] = useState(false), [agentSettings, setAgentSettings] = useState(false), [settings, setSettings] = useState<AppSettings>(defaultSettings), [message, setMessage] = useState('Carregando…')
  const reloadProjects = async (): Promise<void> => { const [p, a] = await Promise.all([window.agentboard.invoke('projects:list', undefined), window.agentboard.invoke('profiles:list', undefined)]); setProjects(p); setProfiles(a); setMessage('Dados locais sincronizados') }
  const reloadBoard = async (id = selected): Promise<void> => { if (id) setBoard(await window.agentboard.invoke('board:get', { projectId: id })) }
  useEffect(() => { void window.agentboard.invoke('settings:get', undefined).then(setSettings).catch((e: unknown) => setMessage(String(e))) }, [])
  useEffect(() => { applySettings(settings) }, [settings])
  useEffect(() => window.agentboard.onRunEvent((event) => { if (['agentboard/run-started', 'agentboard/run-completed', 'agentboard/card-updated'].includes(event.eventType)) void reloadProjects() }), [])
  const projectAgents = profiles.filter((profile) => projects.find((p) => p.id === selected)?.allowedProfileIds.includes(profile.id))
  useEffect(() => { void reloadProjects().catch((e: unknown) => setMessage(String(e))) }, [])
  useEffect(() => { if (selected) void reloadBoard(selected).catch((e: unknown) => setMessage(String(e))); else setBoard(undefined) }, [selected])
  return <div className="shell"><aside><div className="brand"><b>AB</b> AgentBoard</div><button onClick={() => setNewProject(true)}>＋ Novo projeto</button><nav>{projects.map((p) => <button className={`${selected === p.id ? 'active' : ''} ${p.activity.finished ? 'fin' : ''}`} key={p.id} onClick={() => setSelected(p.id)}><i>{p.name[0]}</i><span>{p.name}<small className={p.activity.finished ? 'sfin' : p.activity.running ? 'srun' : ''}>{p.activity.finished ? `${p.activity.finished} terminou` : p.activity.running ? `${p.activity.running} em execução` : `${p.sources.filter((source) => source.isGitRepository).length} repositório(s)`}</small></span>{p.activity.running > 0 && <b className="pdot" aria-label="Em execução" />}</button>)}</nav><div className="sidebarFooter">{projectAgents.length ? <div className="footerAgents">{projectAgents.map((profile) => <AgentIcon key={profile.id} profile={profile} />)}</div> : <small>{message}</small>}<button title="Configurar agentes" aria-label="Configurar agentes" onClick={() => setAgentSettings(true)}>⚙</button></div></aside><main>{board ? <Board board={board} profiles={profiles} refresh={async () => { await reloadBoard(board.project.id); await reloadProjects() }} /> : <section className="welcome"><p className="eyebrow">TRABALHO LOCAL · ESTADO DURÁVEL</p><h1>{projects.length ? 'Escolha um projeto.' : 'Comece com uma pasta.'}</h1><p>Projetos, cards e transições persistem localmente entre reinícios.</p>{!projects.length && <button onClick={() => setNewProject(true)}>Adicionar primeiro projeto</button>}</section>}</main>{newProject && <ProjectDialog profiles={profiles} close={() => setNewProject(false)} created={async (p) => { setNewProject(false); await reloadProjects(); setSelected(p.id) }} />}{agentSettings && <AgentSettings profiles={profiles} settings={settings} settingsChanged={setSettings} close={() => setAgentSettings(false)} changed={reloadProjects} />}</div>
}

function ProjectDialog({ profiles, close, created }: { profiles: AgentProfile[]; close(): void; created(p: Project): void }): React.JSX.Element {
  void profiles
  const [name, setName] = useState(''), [sources, setSources] = useState<ProjectInspection[]>([]), [error, setError] = useState(''), [choosing, setChoosing] = useState(false), [dragging, setDragging] = useState(false)
  const addPath = async (path: string): Promise<void> => {
    const inspected = await window.agentboard.invoke('projects:inspect', { localPath: path })
    setSources((current) => current.some((source) => source.localPath.toLocaleLowerCase() === inspected.localPath.toLocaleLowerCase()) ? current : [...current, inspected])
    setName((current) => current.trim() ? current : inspected.name)
  }
  const choose = async (): Promise<void> => {
    try {
      setChoosing(true); setError('')
      const path = await window.agentboard.invoke('projects:choose-directory', undefined)
      if (!path) return
      await addPath(path)
    } catch (reason) { setError(String(reason)) } finally { setChoosing(false) }
  }
  const drop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault(); setDragging(false); setError('')
    try { for (const file of Array.from(event.dataTransfer.files)) { const path = window.agentboard.getDroppedFilePath(file); if (path) await addPath(path) } } catch (reason) { setError(String(reason)) }
  }
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!sources.length) return
    try { created(await window.agentboard.invoke('projects:create', { name: name.trim() || undefined, sourcePaths: sources.map((source) => source.localPath), profileIds: [] })) } catch (reason) { setError(String(reason)) }
  }
  return <Modal close={close} title="Criar projeto" compactHeader><form className="projectForm" onSubmit={(e) => void submit(e)}><label className="projectName"><FolderIcon /><input aria-label="Nome do projeto" placeholder="Nome do projeto" value={name} onChange={(e) => setName(e.target.value)} /></label><section className="sourceSection"><h3>Pasta do projeto</h3>{sources.map((source) => <div className="repositoryChoice sourceChoice" key={source.localPath}><div className="repoGlyph"><FolderIcon /></div><div><b>{source.name}</b><span>{source.localPath}</span><small>{source.repositories.length ? `${source.repositories.length} repositório(s): ${source.repositories.map((repository) => `${repository.name} (${repository.currentBranch})`).join(', ')}` : 'Pasta sem Git — disponível para planejamento'}</small></div><button type="button" className="secondary" onClick={() => setSources((current) => current.filter((item) => item.localPath !== source.localPath))}>Remover</button></div>)}{!sources.length && <button type="button" className={`sourcePicker ${dragging ? 'dragging' : ''}`} disabled={choosing} onClick={() => void choose()} onDragEnter={(e) => { e.preventDefault(); setDragging(true) }} onDragOver={(e) => e.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(e) => void drop(e)}><FolderIcon /><b>{choosing ? 'Abrindo pastas…' : 'Escolha ou arraste uma pasta'}</b><span>Clique em qualquer lugar desta área</span></button>}</section>{error && <p className="error">{error}</p>}<div className="actions projectActions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button disabled={!sources.length}>Criar projeto</button></div></form></Modal>
}

function FolderIcon(): React.JSX.Element { return <svg className="folderSvg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.8c0-1 .8-1.8 1.8-1.8h4l2 2h7.4c1 0 1.8.8 1.8 1.8v8.4c0 1-.8 1.8-1.8 1.8H5.3c-1 0-1.8-.8-1.8-1.8V6.8Z" /></svg> }

function AgentSettings(props: React.ComponentProps<typeof AgentManager>): React.JSX.Element { return <AgentManager {...props} /> }

function chatMode(board: ProjectBoard, card: Card): 'planning' | 'execution' {
  const fresh = board.cards.find((item) => item.id === card.id) ?? card, state = board.columns.find((column) => column.id === fresh.columnId)?.semanticState
  if (fresh.run.state === 'planning') return 'planning'
  return fresh.run.state !== 'idle' || state === 'doing' || state === 'test' || state === 'done' ? 'execution' : 'planning'
}

function Board({ board, profiles, refresh }: { board: ProjectBoard; profiles: AgentProfile[]; refresh(): Promise<void> }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(), [settings, setSettings] = useState(false), [chatCard, setChatCard] = useState<Card>(), [choosing, setChoosing] = useState<string>(), [starting, setStarting] = useState<Card>(), [stopping, setStopping] = useState<Card>(), [dragId, setDragId] = useState<string>(), [dropOn, setDropOn] = useState<string>(), [overColumn, setOverColumn] = useState<string>(), [toast, setToast] = useState('')
  const active = board.cards.filter((c) => !c.archivedAt), archived = board.cards.filter((c) => c.archivedAt)
  useEffect(() => window.agentboard.onRunEvent((event) => { if (!['agentboard/card-updated', 'agentboard/run-started', 'agentboard/run-completed'].includes(event.eventType)) return; if (event.payload.type === 'moved') say(`O agente moveu o card para ${String(event.payload.column)}`); void refresh() }), [refresh])
  const say = (text: string): void => { setToast(text); window.setTimeout(() => setToast(''), 2600) }
  const move = async (cardId: string, columnId: string, beforeCardId: string | null): Promise<void> => {
    const before = board.cards.find((c) => c.id === cardId)
    const moved = await window.agentboard.invoke('cards:move', { cardId, columnId, beforeCardId })
    if (before && before.priority !== moved.priority) say(`Prioridade alterada para ${priorityLabel[moved.priority]}`)
    await refresh()
  }
  const dropLabel = (target: Card): string | undefined => { const dragged = board.cards.find((c) => c.id === dragId); if (!dragged || dragged.id === target.id) return undefined; return dragged.priority === target.priority ? 'Mesma prioridade' : `Vira prioridade ${priorityLabel[target.priority]}` }
  const edit = (card: Card): Draft => ({ id: card.id, columnId: card.columnId, sourceId: card.sourceId, title: card.title, type: card.type, priority: card.priority })
  const clearDrag = (): void => { setDragId(undefined); setDropOn(undefined); setOverColumn(undefined) }
  return <><header className="boardHead"><div><span className="pathChip tip" data-tip="Pasta do projeto"><FolderGlyph /><span>{board.project.localPath}</span></span><h1>{board.project.name}</h1><p>{board.project.sources.filter((source) => source.isGitRepository).length} repositório(s) · {active.length} cards ativos</p></div><button className="secondary" onClick={() => setSettings(true)}>Configurar</button></header><div className="kanban">{board.columns.map((col) => <section className={`column ${overColumn === col.id ? 'over' : ''}`} key={col.id} onDragOver={(e) => { e.preventDefault(); setOverColumn(col.id) }} onDragLeave={() => setOverColumn(undefined)} onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('card'); clearDrag(); if (id) void move(id, col.id, null) }}><header>{col.label}<b>{active.filter((c) => c.columnId === col.id).length}</b></header>{active.filter((c) => c.columnId === col.id).map((card) => <CardTile key={card.id} card={card} state={col.semanticState} dropLabel={dropOn === card.id ? dropLabel(card) : undefined} onOpen={() => setDraft(edit(card))} onChat={() => setChatCard(card)} onPlan={() => setChatCard(card)} onArchive={() => void window.agentboard.invoke('cards:archive', { cardId: card.id }).then(refresh)} agent={profiles.find((p) => p.id === card.run.profileId)} onStart={() => setStarting(card)} onStop={() => setStopping(card)} onResume={() => void window.agentboard.invoke('cards:resume', { cardId: card.id }).then(refresh).catch((reason: unknown) => say(String(reason)))} dragProps={{ draggable: true, onDragStart: (e) => { e.dataTransfer.setData('card', card.id); setDragId(card.id) }, onDragEnd: clearDrag, onDragOver: (e) => { e.preventDefault(); e.stopPropagation(); setDropOn(card.id) }, onDrop: (e) => { e.stopPropagation(); const id = e.dataTransfer.getData('card'); clearDrag(); if (id && id !== card.id) void move(id, col.id, card.id) } }} />)}<button className="add" onClick={() => setChoosing(col.id)}>＋ Adicionar card</button></section>)}</div>{archived.length > 0 && <details><summary>Arquivados ({archived.length})</summary>{archived.map((c) => <div className="archived" key={c.id}>{c.title}<button onClick={() => void window.agentboard.invoke('cards:restore', { cardId: c.id }).then(refresh)}>Restaurar</button></div>)}</details>}{draft && <CardEditor projectId={board.project.id} sources={board.project.sources} profiles={profiles.filter((p) => board.project.allowedProfileIds.includes(p.id))} draft={draft} openChat={draft.id ? () => { const card = board.cards.find((c) => c.id === draft.id); setDraft(undefined); if (card) setChatCard(card) } : undefined} close={() => setDraft(undefined)} saved={async () => { setDraft(undefined); await refresh() }} />}{settings && <Settings project={board.project} profiles={profiles} close={() => setSettings(false)} saved={async () => { setSettings(false); await refresh() }} />}{choosing && <NewCardDialog close={() => setChoosing(undefined)} manual={() => { setDraft(blankDraft(choosing)); setChoosing(undefined) }} plan={() => void window.agentboard.invoke('cards:create', { projectId: board.project.id, columnId: choosing, title: '', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] }).then(async (created) => { setChoosing(undefined); await refresh(); setChatCard(created) }).catch((reason: unknown) => say(String(reason)))} />}{chatCard && (board.project.allowedProfileIds.length ? <CardChat key={chatCard.id} project={board.project} card={chatCard} profiles={profiles} columnLabel={board.columns.find((c) => c.id === (board.cards.find((x) => x.id === chatCard.id) ?? chatCard).columnId)?.label ?? ''} mode={chatMode(board, chatCard)} close={() => setChatCard(undefined)} openCard={() => { const fresh = board.cards.find((x) => x.id === chatCard.id) ?? chatCard; setDraft(edit(fresh)) }} /> : <AgentOnboarding project={board.project} profiles={profiles} close={() => setChatCard(undefined)} ready={() => void refresh()} />)}{starting && <StartDialog card={starting} profiles={profiles.filter((p) => board.project.allowedProfileIds.includes(p.id))} close={() => setStarting(undefined)} start={async (config) => { await window.agentboard.invoke('cards:start', { cardId: starting.id, config }); setStarting(undefined); await refresh(); setChatCard(starting) }} />}{stopping && <ConfirmDialog eyebrow="Pausar execução" title={stopping.title || 'Novo card'} text="O agente para agora e o card fica Pausado. Você continua pelo card ou escrevendo no chat." ok="Pausar" cancel={() => setStopping(undefined)} confirm={() => { const card = stopping; setStopping(undefined); if (card.run.runId) void window.agentboard.invoke('agents:cancel', { runId: card.run.runId }).then(refresh).catch((reason: unknown) => say(String(reason))) }} />}{toast && <div className="toast" role="status">{toast}</div>}</>
}

function AgentOnboarding({ project, profiles, close, ready }: { project: Project; profiles: AgentProfile[]; close(): void; ready(profile: AgentProfile): void }): React.JSX.Element {
  const [draft, setDraft] = useState<AgentDraft>({ provider: 'codex', label: '', scope: 'Pessoal', useExistingSession: true }), [probe, setProbe] = useState<AgentProbe>(), [pending, setPending] = useState<AgentProfile>(), [error, setError] = useState('')
  const connect = async (profile: AgentProfile): Promise<void> => {
    try { setError(''); setPending(profile); const result = await window.agentboard.invoke('profiles:probe', { profileId: profile.id }); setProbe(result); if (result.installed && result.authenticated) { await window.agentboard.invoke('projects:set-profiles', { projectId: project.id, profileIds: [...new Set([...project.allowedProfileIds, profile.id])] }); ready(profile) } } catch (reason) { setError(String(reason)) }
  }
  const add = async (): Promise<void> => {
    try {
      setError('')
      const detected = await window.agentboard.invoke('profiles:detect-provider', { provider: draft.provider })
      if (!detected.installed) {
        await window.agentboard.invoke('profiles:install-provider', { provider: draft.provider })
        setError(`A instalação do ${draft.provider === 'codex' ? 'Codex' : 'Claude'} foi aberta. Termine no terminal e clique novamente em Adicionar e continuar.`)
        return
      }
      const profile = await window.agentboard.invoke('profiles:create', { ...draft, label: draft.label.trim() || (draft.provider === 'codex' ? 'Meu Codex' : 'Meu Claude'), scope: draft.scope.trim() || 'Pessoal' })
      await connect(profile)
    } catch (reason) { setError(String(reason)) }
  }
  return <Modal close={close} title="Adicionar agente"><div className="agentIntro"><h3>Escolha quem vai trabalhar neste projeto</h3><p>O projeto já está salvo. Para iniciar o chat, conecte um agente.</p></div>{profiles.length > 0 && <div className="savedAgents"><span>Agentes cadastrados</span>{profiles.map((profile) => <button type="button" key={profile.id} onClick={() => void connect(profile)}><AgentIcon profile={profile} /><span><b>{profile.label}</b><small>{profile.provider === 'codex' ? 'Codex' : 'Claude'} · {profile.scope}</small></span><strong>Usar</strong></button>)}</div>}<div className="agentSetup onboarding"><span className="fieldTitle">Novo agente</span><div className="providerCards"><button type="button" className={draft.provider === 'codex' ? 'selected' : ''} onClick={() => setDraft({ ...draft, provider: 'codex' })}><i className="logo"><ProviderLogo provider="codex" /></i><span><b>Codex</b><small>OpenAI</small></span></button><button type="button" className={draft.provider === 'claude' ? 'selected' : ''} onClick={() => setDraft({ ...draft, provider: 'claude' })}><i className="logo"><ProviderLogo provider="claude" /></i><span><b>Claude</b><small>Anthropic</small></span></button></div><label>Nome<input placeholder={draft.provider === 'codex' ? 'Meu Codex' : 'Meu Claude'} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label><label>Uso<input placeholder="Pessoal, Trabalho, Cliente X…" value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })} /></label><label className="sessionOption"><input type="checkbox" checked={draft.useExistingSession} onChange={(e) => setDraft({ ...draft, useExistingSession: e.target.checked })} /><span><b>Usar login atual</b><small>Desmarque para manter uma sessão separada.</small></span></label><div className="inlineActions"><button type="button" className="secondary" onClick={close}>Agora não</button><button type="button" onClick={() => void add()}>Adicionar e continuar</button></div></div>{pending && probe && !probe.authenticated && <div className="loginNotice"><span>{probe.installed ? `${pending.label} está instalado e precisa de login.` : `${pending.label} ainda não está instalado neste computador.`}</span>{!probe.installed && <button type="button" onClick={async () => { await window.agentboard.invoke('profiles:install', { profileId: pending.id }); setError('A instalação foi aberta no terminal. Quando terminar, clique em Verificar.') }}>Instalar</button>}{probe.installed && <button type="button" onClick={async () => { await window.agentboard.invoke('profiles:login', { profileId: pending.id }); setError('Conclua o login na janela aberta e depois clique em Verificar.') }}>Entrar</button>}<button type="button" className="secondary" onClick={() => void connect(pending)}>Verificar</button></div>}{error && <p className="error">{error}</p>}</Modal>
}

function Settings({ project, profiles, close, saved }: { project: Project; profiles: AgentProfile[]; close(): void; saved(): void }): React.JSX.Element {
  const [name, setName] = useState(project.name), [allowed, setAllowed] = useState(project.allowedProfileIds), [error, setError] = useState('')
  const [probes, setProbes] = useState<Record<string, AgentProbe>>({})
  const probe = async (profileId: string): Promise<void> => { const result = await window.agentboard.invoke('profiles:probe', { profileId }); setProbes((current) => ({ ...current, [profileId]: result })) }
  const submit = async (e: React.FormEvent): Promise<void> => { e.preventDefault(); try { await window.agentboard.invoke('projects:update', { projectId: project.id, name }); await window.agentboard.invoke('projects:set-profiles', { projectId: project.id, profileIds: allowed }); saved() } catch (reason) { setError(String(reason)) } }
  return <Modal close={close} title="Configurar projeto"><form onSubmit={(e) => void submit(e)}><label>Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label><fieldset><legend>Agentes permitidos</legend>{profiles.map((p) => <div className="profile" key={p.id}><label className="check"><input type="checkbox" checked={allowed.includes(p.id)} onChange={() => setAllowed(allowed.includes(p.id) ? allowed.filter((id) => id !== p.id) : [...allowed, p.id])} /><span>{p.label}<small>{p.provider} · {p.scope}{probes[p.id] ? ` · ${probes[p.id]!.installed ? probes[p.id]!.authenticated ? 'conectado' : 'login necessário' : 'não instalado'}` : ''}</small></span></label><button type="button" className="secondary probe" onClick={() => void probe(p.id)}>Verificar</button></div>)}</fieldset>{error && <p className="error">{error}</p>}<Actions close={close} /></form></Modal>
}

function Modal({ close, title, children, compactHeader = false }: React.PropsWithChildren<{ close(): void; title: string; compactHeader?: boolean }>): React.JSX.Element { return <div className="overlay"><div className="modal"><header><div>{!compactHeader && <p className="eyebrow">AGENTBOARD</p>}<h2>{title}</h2></div><button onClick={close}>×</button></header>{children}</div></div> }
function Actions({ close }: { close(): void }): React.JSX.Element { return <div className="actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button>Salvar</button></div> }
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
