import React, { useEffect, useState } from 'react'
import { agentColorPalette, defaultAgentColor, type AgentProbe, type AgentProfile, type AppLanguage, type AppSettings, type AppTheme, type VoiceModel } from '@agentboard/contracts'
import { AgentIcon, ProviderLogo } from './AgentIcon'
import { NoticeDialog, plainError } from './NoticeDialog'
import { SkillsPanel } from './SkillsPanel'

const themes: ReadonlyArray<{ value: AppTheme; label: string; swatches: [string, string, string] }> = [
  { value: 'green', label: 'Verde escuro', swatches: ['#8db99a', '#2f5a40', '#1b2b21'] },
  { value: 'purple', label: 'Roxo escuro', swatches: ['#a99bd9', '#4a3f6e', '#211d30'] },
  { value: 'blue', label: 'Azul escuro', swatches: ['#8fb3d9', '#345273', '#1a2430'] },
  { value: 'orange', label: 'Laranja escuro', swatches: ['#d9a477', '#6b4a33', '#2a2019'] }
]
const languages: ReadonlyArray<{ value: AppLanguage; label: string }> = [{ value: 'pt-BR', label: 'Português (Brasil)' }, { value: 'en', label: 'English' }]
const voices: ReadonlyArray<{ value: VoiceModel; label: string }> = [{ value: 'small', label: 'Small (466 MB, rápido)' }, { value: 'large-v3-turbo', label: 'Large v3 Turbo (1,6 GB, mais preciso)' }]

export function applySettings(settings: AppSettings): void {
  document.documentElement.dataset.accent = settings.tema
  document.documentElement.lang = settings.idioma
}

/** Criar e editar agente: instalar, conectar a conta, nome, uso e cor de personalidade. */
function AgentDialog({ profile, close, changed }: { profile?: AgentProfile; close(): void; changed(): Promise<void> }): React.JSX.Element {
  const [provider, setProvider] = useState<'codex' | 'claude'>(profile?.provider ?? 'claude'), [label, setLabel] = useState(profile?.label ?? ''), [scope, setScope] = useState(profile?.scope ?? 'Pessoal'), [existing, setExisting] = useState(true), [color, setColor] = useState(profile?.color ?? defaultAgentColor('claude'))
  const [installed, setInstalled] = useState(Boolean(profile)), [pending, setPending] = useState<AgentProfile | undefined>(undefined), [status, setStatus] = useState<AgentProbe>(), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [createdHere, setCreatedHere] = useState(false), [removing, setRemoving] = useState(false)
  const run = async (action: () => Promise<void>): Promise<void> => { setBusy(true); setMessage(''); try { await action() } catch (error) { setMessage(String(error).replace(/^Error: /, '')) } finally { setBusy(false) } }
  const checkInstall = async (which = provider): Promise<void> => {
    const result = await window.agentboard.invoke('profiles:detect-provider', { provider: which })
    setInstalled(result.installed)
    setMessage(result.installed ? `Instalação encontrada: ${result.version || which}. Continue para conectar sua conta.` : `Programa não encontrado. Clique em Instalar e, ao terminar, em Verificar instalação.${result.error ? ` Detalhe: ${result.error}` : ''}`)
  }
  useEffect(() => { if (!profile) void run(() => checkInstall(provider)) }, [provider])
  useEffect(() => { if (!profile) setColor(defaultAgentColor(provider)) }, [provider, profile])
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') void cancel() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) })
  const cancel = async (): Promise<void> => { if (pending && createdHere) await window.agentboard.invoke('profiles:delete', { profileId: pending.id }).catch(() => undefined); close() }
  const checkAccount = async (item: AgentProfile): Promise<void> => {
    const result = await window.agentboard.invoke('profiles:probe', { profileId: item.id })
    setStatus(result)
    if (result.authenticated && result.installed) { await changed(); setMessage(`${item.label} conectado e pronto para selecionar nos projetos.`); if (!profile) close() }
    else setMessage(result.installed ? 'Instalação encontrada. Clique em Entrar, conclua o login e depois em Verificar conta.' : `Não foi possível executar o agente: ${result.error || 'programa não encontrado'}`)
  }
  const save = async (): Promise<void> => {
    if (profile) { await window.agentboard.invoke('profiles:update', { profileId: profile.id, label, scope, color }); await changed(); close(); return }
    const created = await window.agentboard.invoke('profiles:create', { provider, label: label.trim() || (provider === 'codex' ? 'Meu Codex' : 'Meu Claude'), scope: scope.trim() || 'Pessoal', useExistingSession: existing, color })
    setCreatedHere(true); setPending(created); await checkAccount(created)
  }
  const [notice, setNotice] = useState<{ title: string; text: string; after?: boolean }>()
  const remove = async (): Promise<void> => {
    if (!profile) return
    try {
      const result = await window.agentboard.invoke('profiles:delete', { profileId: profile.id }); await changed()
      if (result.archived) setNotice({ title: 'Agente removido', text: `${profile.label} saiu da sua lista e não pode mais ser usado. Como ele já trabalhou em cards e chats, o histórico foi mantido: nesses lugares ele aparece como desativado, só para consulta.`, after: true })
      else close()
    } catch (reason) { setNotice({ title: 'Não foi possível remover o agente', text: plainError(reason) }) }
  }
  const preview = { provider, label: label || 'Novo agente', color }
  return <div className="overlay top"><div className="modal" style={{ width: 'min(460px,100%)' }}>
    <header><div><div className="eyebrow">Agente</div><h2>{profile ? 'Editar agente' : 'Novo agente'}</h2></div><button className="x" onClick={() => void cancel()} aria-label="Fechar">×</button></header>
    <div className="stack">
      {!profile && !pending && <div className="f"><span>Tipo</span><div className="provcards">{(['claude', 'codex'] as const).map((item) => <button type="button" key={item} disabled={busy} className={provider === item ? 'sel' : ''} onClick={() => setProvider(item)}><i className={`av lg ${item}`} style={{ color: provider === item ? color : undefined }}><ProviderLogo provider={item} /></i><span><b>{item === 'claude' ? 'Claude' : 'Codex'}</b><small>{item === 'claude' ? 'Anthropic' : 'OpenAI'}</small></span></button>)}</div></div>}
      {!profile && !pending && !installed && <div className="convbox"><p>{item(provider)} ainda não está instalado neste computador.</p><div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" disabled={busy} onClick={() => void run(() => checkInstall())}>Verificar instalação</button><button type="button" disabled={busy} onClick={() => void run(async () => { await window.agentboard.invoke('profiles:install-provider', { provider }); setMessage('Instalação aberta no terminal. Quando terminar, clique em Verificar instalação aqui.') })}>Instalar {item(provider)}</button></div></div>}
      {(profile || installed) && !pending && <>
        <label className="f">Nome<input className="in" value={label} placeholder={provider === 'claude' ? 'Ex.: Claude Pessoal' : 'Ex.: Codex Trabalho'} onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="f">Uso<input className="in" value={scope} onChange={(e) => setScope(e.target.value)} /></label>
        {!profile && <label className="ck-line"><input type="checkbox" checked={existing} onChange={(e) => setExisting(e.target.checked)} /><span className="t">Usar sessão atual<small>Desmarque para conectar outra conta em uma sessão separada.</small></span></label>}
        <div className="f"><span>Personalidade</span><div className="swatches">{agentColorPalette.map((value) => <button type="button" key={value} className={`sw ${color.toLowerCase() === value.toLowerCase() ? 'sel' : ''}`} style={{ '--c': value } as React.CSSProperties} aria-label={`Cor ${value}`} aria-pressed={color.toLowerCase() === value.toLowerCase()} onClick={() => setColor(value)} />)}</div><div className="aeprev"><AgentIcon profile={preview} size="lg" tip={false} /><span>{preview.label}</span></div></div>
      </>}
      {pending && <div className="convbox"><p>{pending.label}: conclua o login para disponibilizar o agente.</p><div className="actions" style={{ margin: 0 }}><button type="button" disabled={busy} onClick={() => void run(async () => { await window.agentboard.invoke('profiles:login', { profileId: pending.id }); setMessage('Conclua o login na janela aberta. Depois clique em Verificar conta.') })}>Entrar</button><button type="button" className="secondary" disabled={busy} onClick={() => void run(() => checkAccount(pending))}>Verificar conta</button></div></div>}
      {profile && <div className="convbox"><p>{status ? (status.authenticated ? 'Conta conectada.' : status.installed ? 'Instalado, mas a conta não está conectada.' : `Não instalado: ${status.error ?? 'programa não encontrado'}`) : 'Verifique a instalação e a conta deste agente.'}</p><div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" disabled={busy} onClick={() => void run(async () => { await window.agentboard.invoke('profiles:login', { profileId: profile.id }); setMessage('Conclua o login na janela aberta e depois clique em Verificar conta.') })}>Entrar</button><button type="button" className="secondary" disabled={busy} onClick={() => void run(() => checkAccount(profile))}>Verificar conta</button></div></div>}
      {message && <p role="status" className="hint" style={{ overflowWrap: 'anywhere' }}>{message}</p>}
    </div>
    <div className="actions">{profile && <button type="button" className="danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => setRemoving(true)}>Remover</button>}<button type="button" className="secondary" onClick={() => void cancel()}>{pending ? 'Cancelar cadastro' : 'Cancelar'}</button>{!pending && (profile || installed) && <button type="button" disabled={busy} onClick={() => void run(save)}>{profile ? 'Salvar' : 'Continuar para conta'}</button>}</div>
    {removing && profile && <div className="overlay top"><div className="modal" style={{ width: 'min(430px,100%)' }}><header><div><div className="eyebrow">Agente</div><h2>Remover {profile.label}?</h2></div></header><p style={{ fontSize: 13, lineHeight: 1.5, color: '#cbd3cd' }}>O agente sai da lista. Agentes com conversas, planos ou execuções salvos não podem ser removidos.</p><div className="actions"><button className="secondary" onClick={() => setRemoving(false)}>Cancelar</button><button className="danger solid" onClick={() => { setRemoving(false); void run(remove) }}>Remover</button></div></div></div>}
    {notice && <NoticeDialog eyebrow="Agente" title={notice.title} text={notice.text} close={() => { const after = notice.after; setNotice(undefined); if (after) close() }} />}
  </div></div>
}
const item = (provider: 'codex' | 'claude'): string => (provider === 'codex' ? 'Codex' : 'Claude')

export function SettingsDialog({ profiles, settings, close, changed, settingsChanged }: { profiles: AgentProfile[]; settings: AppSettings; close(): void; changed(): Promise<void>; settingsChanged(settings: AppSettings): void }): React.JSX.Element {
  const [tab, setTab] = useState<'agents' | 'skills' | 'look'>('agents'), [editing, setEditing] = useState<AgentProfile | 'new'>(), [items, setItems] = useState(profiles), [statuses, setStatuses] = useState<Record<string, AgentProbe>>({}), [error, setError] = useState('')
  useEffect(() => setItems(profiles), [profiles])
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !editing) close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close, editing])
  useEffect(() => { void window.agentboard.invoke('profiles:probe-all', undefined).then((all) => setStatuses(Object.fromEntries(all.map((probe) => [probe.profileId, probe])))).catch(() => undefined) }, [profiles])
  const save = async (patch: Partial<AppSettings>): Promise<void> => { try { setError(''); settingsChanged(await window.agentboard.invoke('settings:update', patch)) } catch (reason) { setError(String(reason)) } }
  const refresh = async (): Promise<void> => { await changed() }
  return <div className="overlay"><div className="modal" style={{ width: 'min(680px,100%)' }}>
    <header><div><div className="eyebrow">Configurações</div><h2>Agentes e skills</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>{([['agents', 'Agentes'], ['skills', 'Skills'], ['look', 'Aparência']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={`tab ${tab === value ? 'on' : ''}`} onClick={() => setTab(value)}>{label}</button>)}</div>
    {tab === 'agents' && <><p style={{ marginBottom: 12 }}>Cadastre aqui. Dentro de cada projeto, escolha quais podem trabalhar nele.</p>
      <div className="stack" style={{ gap: 8 }}>{items.length === 0 && <div className="emptyBox">Nenhum agente cadastrado.</div>}{items.map((profile) => <div className="ck-line" key={profile.id}><AgentIcon profile={profile} tip={false} /><span className="t">{profile.label}<small>{item(profile.provider)} · {profile.scope} · {statuses[profile.id] ? (statuses[profile.id]!.authenticated ? 'conectado' : statuses[profile.id]!.installed ? 'precisa de login' : 'não instalado') : 'verificando…'}</small></span><button className="mini secondary" onClick={() => setEditing(profile)}>Editar</button></div>)}</div>
      <button className="bigadd" onClick={() => setEditing('new')}>＋ Adicionar agente</button></>}
    {tab === 'skills' && <SkillsPanel scope="global" profiles={items} />}
    {tab === 'look' && <><p style={{ fontSize: 12, marginBottom: 12 }}>Escolha a cor de destaque do sistema. Só muda a tonalidade; o tema continua escuro.</p>
      <div className="themes">{themes.map((theme) => <button type="button" key={theme.value} className={`themeopt ${settings.tema === theme.value ? 'on' : ''}`} style={{ '--c': theme.swatches[0] } as React.CSSProperties} aria-pressed={settings.tema === theme.value} onClick={() => void save({ tema: theme.value })}><span className="sw3">{theme.swatches.map((color) => <i key={color} style={{ background: color }} />)}</span>{theme.label}</button>)}</div>
      <div className="stack" style={{ marginTop: 16 }}>
        <label className="f">Idioma dos agentes<select className="in" value={settings.idioma} onChange={(e) => void save({ idioma: e.target.value as AppLanguage })}>{languages.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}</select></label>
        <p className="hint">Tudo o que o agente escreve segue este idioma. A interface continua em português por enquanto.</p>
        <label className="f">Ditado por voz (Whisper local)<select className="in" value={settings.voz} onChange={(e) => void save({ voz: e.target.value as VoiceModel })}>{voices.map((voice) => <option key={voice.value} value={voice.value}>{voice.label}</option>)}</select></label>
        <p className="hint">O modelo é baixado só quando você usa o microfone do chat pela primeira vez e fica na pasta de dados do AgentBoard.</p>
      </div>{error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}</>}
    <div className="actions"><button className="secondary" onClick={close}>Fechar</button></div>
    {editing && <AgentDialog profile={editing === 'new' ? undefined : editing} close={() => setEditing(undefined)} changed={refresh} />}
  </div></div>
}
