import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAgentUpdatesPending } from './useAgentUpdates'
import { ProjectAvatar } from './ProjectIcon'
import { dismissVoiceInstall, useVoiceInstall } from './voiceStore'
import type { AgentProfile, AgentUsage, Project } from '@agentboard/contracts'
import { AgentIcon, ProviderLogo } from './AgentIcon'
import { ChevronLeftIcon, PlusIcon, TrashIcon } from './icons'

const level = (percent: number): string => (percent >= 90 ? 'hi' : percent >= 70 ? 'mid' : 'ok')
function left(iso: string | null): string {
  if (!iso) return '—'
  const minutes = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000)), days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60)
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes % 60}min` : `${minutes}min`
}
const at = (iso: string | null): string => (iso ? new Date(iso).toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '')
const Bar = ({ percent }: { percent: number }): React.JSX.Element => <div className="ubar"><i className={level(percent)} style={{ width: `${percent}%` }} /></div>

/** Uso das sessões: botão do rodapé com os provedores, lista por agente (5 h) e, ao clicar, o painel completo com a semana. */
/** Instalação do ditado por voz: barra de progresso acima dos agentes e um aviso quando termina; fica visível em qualquer tela. */
function VoiceInstallCard(): React.JSX.Element | null {
  const voice = useVoiceInstall()
  if (!voice.installing && !voice.done && !voice.error) return null
  return <div className={`voicecard ${voice.error ? 'err' : ''}`} role="status">
    {voice.installing && <><div className="vrow"><span>Instalando ditado por voz{voice.item ? ` · ${voice.item}` : ''}</span><b>{voice.percent === null ? `${voice.megabytes} MB` : `${voice.percent}%`}</b></div><div className="vbar"><i style={{ width: `${voice.percent ?? 8}%` }} /></div></>}
    {!voice.installing && voice.done && <div className="vrow"><span>Ditado por voz instalado</span><button type="button" aria-label="Fechar aviso" onClick={dismissVoiceInstall}>×</button></div>}
    {!voice.installing && voice.error && <div className="vrow"><span>Ditado por voz: {voice.error}</span><button type="button" aria-label="Fechar aviso" onClick={dismissVoiceInstall}>×</button></div>}
  </div>
}

function UsedAgents({ profiles }: { profiles: AgentProfile[] }): React.JSX.Element {
  const [open, setOpen] = useState(false), [usage, setUsage] = useState<AgentUsage[]>([]), [detail, setDetail] = useState<string>(), [refreshing, setRefreshing] = useState(false)
  const load = useCallback(async () => { try { setUsage(await window.agentboard.invoke('usage:list', undefined)) } catch { /* uso é informativo */ } }, [])
  // Mostra o que já se sabe na hora e atualiza por baixo dos panos (o Claude só informa o limite quando roda).
  useEffect(() => {
    if (!open && !detail) return
    let alive = true
    void load(); setRefreshing(true)
    void window.agentboard.invoke('usage:refresh', undefined).then((fresh) => { if (alive) setUsage(fresh) }).catch(() => undefined).finally(() => { if (alive) setRefreshing(false) })
    return () => { alive = false }
  }, [open, detail, load])
  useEffect(() => window.agentboard.onRunEvent((event) => { if ((open || detail) && event.eventType === 'agentboard/run-completed') void load() }), [open, detail, load])
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: Event): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key) }
  }, [open])
  const shown = profiles.slice(0, 4), extra = profiles.length - shown.length
  const session = (profileId: string) => usage.find((item) => item.profileId === profileId)?.windows.find((window) => window.id === 'five_hour')
  return <div className="used" ref={root}>
    <button type="button" className="usedbtn tip" data-tip="Agentes e uso da sessão" aria-expanded={open} aria-label="Agentes e uso da sessão" onClick={() => setOpen(!open)}><span className="avstack">{shown.map((profile) => <span key={profile.id} className={`av ptl ${profile.provider}`} style={{ color: profile.color, background: `color-mix(in srgb, ${profile.color} 22%, #1b1e1c)` }}><ProviderLogo provider={profile.provider} /></span>)}{extra > 0 && <span className="av ptl more">+{extra}</span>}</span><svg className={`uchev ${open ? 'open' : ''}`} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg></button>
    {open && <div className="upop"><div className="sectitle">Uso da sessão (5 h){refreshing && <span className="refreshing"> · atualizando…</span>}</div>{profiles.length === 0 && <p className="hint">Nenhum agente cadastrado.</p>}{profiles.map((profile) => { const window = session(profile.id); return <button type="button" className="urow" key={profile.id} onClick={() => { setDetail(profile.id); setOpen(false) }}><AgentIcon profile={profile} tip={false} /><span className="un"><b>{profile.label}</b><small className="rs">{window ? <>Reseta em<span>{left(window.resetsAt)}</span></> : 'Sem dados ainda'}</small>{window && <Bar percent={window.usedPercent} />}</span><span className="up">{window ? `${window.usedPercent}%` : ''}</span></button> })}</div>}
    {detail && <UsageModal profiles={profiles} usage={usage} current={detail} close={() => setDetail(undefined)} />}
  </div>
}

function UsageModal({ profiles: all, usage, current, close, only }: { profiles: AgentProfile[]; usage: AgentUsage[]; current: string; close(): void; only?: boolean }): React.JSX.Element {
  const profiles = only ? all.filter((profile) => profile.id === current) : all
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close])
  return <div className="overlay top"><div className="modal usage" style={{ width: 'min(420px,100%)' }}><header><div><div className="eyebrow">Uso do plano</div><h2>Sessões e semana</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    <div className="ugrid">{profiles.map((profile) => { const item = usage.find((entry) => entry.profileId === profile.id); return <section className={`ucard ${profile.id === current ? 'here' : ''}`} key={profile.id}>
      <div className="uhead"><AgentIcon profile={profile} size="lg" tip={false} /><span><b>{profile.label}</b><small>{profile.provider === 'codex' ? 'Codex' : 'Claude'}</small></span></div>
      {item?.windows.length ? item.windows.map((window) => <div className="ublk" key={window.id}><div className="uh"><span>{window.label}</span>{window.resetsAt && <small>Reseta em {left(window.resetsAt)} · {at(window.resetsAt)}</small>}<b>{window.usedPercent}%</b></div><Bar percent={window.usedPercent} /></div>) : <div className="ublk"><small>{profile.provider === 'claude' ? 'O Claude informa o uso a cada execução; rode algo para ver aqui.' : 'Sem sessões do Codex com limites ainda.'}</small></div>}
      
    </section> })}</div>
    </div></div>
}

/** O mesmo painel de uso das configurações, aberto de fora do rodapé (anéis do composer): carrega agentes e uso sozinho. */
export function UsageDialog({ current, close }: { current?: string; close(): void }): React.JSX.Element | null {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]), [usage, setUsage] = useState<AgentUsage[]>([])
  useEffect(() => {
    let alive = true
    void window.agentboard.invoke('profiles:list', undefined).then((list) => { if (alive) setProfiles(list) }).catch(() => undefined)
    void window.agentboard.invoke('usage:list', undefined).then((list) => { if (alive) setUsage(list) }).catch(() => undefined)
    void window.agentboard.invoke('usage:refresh', undefined).then((fresh) => { if (alive) setUsage(fresh) }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  return <UsageModal profiles={profiles} usage={usage} current={current ?? ''} close={close} only={Boolean(current)} />
}

export function Sidebar({ projects, profiles, selected, collapsed, onSelect, onNew, onSettings, onProjectSettings, onNewChat, onToggle, onReorder, onDelete }: { projects: Project[]; profiles: AgentProfile[]; selected?: string; collapsed: boolean; onSelect(id: string): void; onNew(): void; onSettings(): void; onProjectSettings(projectId: string): void; onNewChat(projectId: string): void; onToggle(): void; onReorder(projectIds: string[]): void; onDelete(project: Project): void }): React.JSX.Element {
  const agentUpdates = useAgentUpdatesPending(profiles)
  // Arrastar: enquanto arrasta, a lista mostra o projeto já na posição nova; ao soltar, grava a ordem.
  const [drag, setDrag] = useState<{ id: string; over: number }>(), [menu, setMenu] = useState<{ project: Project; x: number; y: number }>()
  const projectMenu = useRef<HTMLDivElement>(null)
  const ordered = drag ? (() => { const rest = projects.filter((item) => item.id !== drag.id), moving = projects.find((item) => item.id === drag.id)!; rest.splice(drag.over, 0, moving); return rest })() : projects
  const drop = (): void => { if (drag && ordered.some((item, index) => item.id !== projects[index]?.id)) onReorder(ordered.map((item) => item.id)); setDrag(undefined) }
  useEffect(() => {
    if (!menu) return
    projectMenu.current?.focus()
    const close = (): void => setMenu(undefined), key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { close(); return }
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable="true"]'))) return
      const pressed = event.key.toLowerCase()
      if (pressed !== 'n' && pressed !== 'c' && pressed !== 'delete') return
      event.preventDefault(); event.stopPropagation(); close()
      if (pressed === 'n') onNewChat(menu.project.id); else if (pressed === 'c') onProjectSettings(menu.project.id); else onDelete(menu.project)
    }
    window.addEventListener('click', close); window.addEventListener('blur', close); document.addEventListener('keydown', key)
    return () => { window.removeEventListener('click', close); window.removeEventListener('blur', close); document.removeEventListener('keydown', key) }
  }, [menu, onNewChat, onProjectSettings, onDelete])
  return <>
    <button type="button" className="side-toggle tip" data-tip={collapsed ? 'Mostrar barra lateral' : 'Ocultar barra lateral'} aria-label={collapsed ? 'Mostrar barra lateral' : 'Ocultar barra lateral'} onClick={onToggle}><ChevronLeftIcon /></button>
    <aside>
      <button className="secondary newproj" onClick={onNew}>＋ Novo projeto</button>
      <nav className="projs" onDragOver={(e) => { if (drag) e.preventDefault() }} onDrop={(e) => { e.preventDefault(); drop() }}>{ordered.map((project, index) => {
        const { running, finished } = project.activity, git = project.sources.filter((source) => source.isGitRepository).length
        const sub = running ? <small className="srun">{running} executando</small> : finished ? <small className="sfin">Terminou · clique para ver</small> : <small>{git ? `${git} ${git === 1 ? 'repositório' : 'repositórios'}` : 'Pasta sem Git'}</small>
        return <div className={`projrow ${drag?.id === project.id ? 'dragging' : ''}`} key={project.id} draggable
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setMenu(undefined); setDrag({ id: project.id, over: index }) }}
          onDragOver={(e) => {
            if (!drag) return
            e.preventDefault()
            if (drag.id === project.id) return
            // Posição na lista sem o projeto arrastado; metade de baixo da linha = entra depois dela.
            const box = e.currentTarget.getBoundingClientRect(), after = e.clientY > box.top + box.height / 2
            const over = (index > drag.over ? index - 1 : index) + (after ? 1 : 0)
            if (over !== drag.over) setDrag({ ...drag, over })
          }}
          onDragEnd={() => setDrag(undefined)}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ project, x: e.clientX, y: e.clientY }) }}>
          <button type="button" className={`proj ${selected === project.id ? 'on' : ''} ${finished ? 'fin' : ''} ${running ? 'busy' : ''}`} onClick={() => onSelect(project.id)}><ProjectAvatar name={project.name} icon={project.icon} /><span>{project.name}{sub}</span>{running > 0 && <span className="spin sm" title="Executando" />}{finished > 0 && <b className="pdot" title="Terminou" />}</button>
          <button type="button" className="projnew tip" data-tip="Novo chat livre neste projeto" aria-label={`Novo chat livre em ${project.name}`} onClick={() => onNewChat(project.id)}><PlusIcon /></button></div>
      })}</nav>
      <VoiceInstallCard />
      <div className="side-foot"><button className="iconbtn gearwrap" title={agentUpdates ? 'Configurações · há atualização de agente disponível' : 'Configurações'} aria-label={agentUpdates ? 'Configurações, há atualização de agente disponível' : 'Configurações'} onClick={onSettings}>⚙{agentUpdates && <i className="gear-dot" aria-hidden="true" />}</button><UsedAgents profiles={profiles} /></div>
    </aside>
    {menu && <div ref={projectMenu} className="projmenu" role="menu" aria-label={`Ações do projeto ${menu.project.name}`} tabIndex={-1} style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
      <div className="ctxtitle">{menu.project.name}</div>
      <button type="button" role="menuitem" onClick={() => { setMenu(undefined); onNewChat(menu.project.id) }}><PlusIcon /><span>Novo chat livre</span><kbd>N</kbd></button>
      <button type="button" role="menuitem" onClick={() => { setMenu(undefined); onProjectSettings(menu.project.id) }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /><circle cx="12" cy="12" r="4" /></svg><span>Configurar projeto</span><kbd>C</kbd></button>
      <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(undefined); onDelete(menu.project) }}><TrashIcon /><span>Excluir projeto</span><kbd>Del</kbd></button>
    </div>}
  </>
}
