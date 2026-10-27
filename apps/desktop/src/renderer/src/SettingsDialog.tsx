import React, { useEffect, useState } from 'react'
import { agentColorPalette, defaultAgentColor, type AgentProbe, type AgentProfile, type AppLanguage, type AppSettings, type AppTheme, type VoiceModel } from '@agentboard/contracts'
import { AgentIcon, ProviderLogo } from './AgentIcon'
import { NoticeDialog, plainError } from './NoticeDialog'
import { SkillsPanel } from './SkillsPanel'
import { messageSpacings, readMessageSpacing, saveMessageSpacing, type MessageSpacing } from './chatPrefs'
import { dismissVoiceInstall, notifyVoiceChanged } from './voiceStore'
import { Checkbox } from './Checkbox'
import { Select } from './Select'

export const themes: ReadonlyArray<{ value: AppTheme; label: string; mode: 'dark' | 'light'; swatches: [string, string, string] }> = [
  { value: 'green', label: 'Floresta', mode: 'dark', swatches: ['#8db99a', '#2f5a40', '#101713'] },
  { value: 'purple', label: 'Ametista', mode: 'dark', swatches: ['#a99bd9', '#4a3f6e', '#15121d'] },
  { value: 'blue', label: 'Oceano', mode: 'dark', swatches: ['#8fb3d9', '#345273', '#101720'] },
  { value: 'orange', label: 'Âmbar', mode: 'dark', swatches: ['#d9a477', '#6b4a33', '#1c1510'] },
  { value: 'graphite', label: 'Grafite', mode: 'dark', swatches: ['#b8c0cc', '#4b5563', '#101216'] },
  { value: 'teal', label: 'Aurora', mode: 'dark', swatches: ['#65c9c2', '#246b68', '#0c1818'] },
  { value: 'rose', label: 'Rosa noturno', mode: 'dark', swatches: ['#dda0b6', '#704052', '#1d1116'] },
  { value: 'light-mint', label: 'Menta', mode: 'light', swatches: ['#237a4b', '#a8d8ba', '#f4faf6'] },
  { value: 'light-sky', label: 'Céu', mode: 'light', swatches: ['#2468a2', '#aacde9', '#f4f8fc'] },
  { value: 'light-lavender', label: 'Lavanda', mode: 'light', swatches: ['#6848a0', '#cabce4', '#f8f6fc'] },
  { value: 'light-sand', label: 'Areia', mode: 'light', swatches: ['#95601f', '#dfc49b', '#fbf8f1'] },
  { value: 'light-rose', label: 'Rosa claro', mode: 'light', swatches: ['#a74468', '#e5b7c8', '#fcf6f8'] },
  { value: 'light-slate', label: 'Ardósia clara', mode: 'light', swatches: ['#40566f', '#bcc8d5', '#f5f7fa'] }
]
const languages: ReadonlyArray<{ value: AppLanguage; label: string }> = [{ value: 'pt-BR', label: 'Português (Brasil)' }, { value: 'en', label: 'English' }]
const voices: ReadonlyArray<{ value: VoiceModel; label: string }> = [{ value: 'small', label: 'Small (466 MB, rápido)' }, { value: 'large-v3-turbo', label: 'Large v3 Turbo (1,6 GB, mais preciso)' }, { value: 'groq', label: 'Groq na nuvem (rápido, não usa o computador)' }]

export function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.accent = theme
  document.documentElement.dataset.theme = theme.startsWith('light-') ? 'light' : 'dark'
}

export function applySettings(settings: AppSettings): void {
  applyTheme(settings.tema)
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
        {!profile && <label className="ck-line"><Checkbox checked={existing} onChange={setExisting} /><span className="t">Usar sessão atual<small>Desmarque para conectar outra conta em uma sessão separada.</small></span></label>}
        <div className="f"><span>Personalidade</span><div className="swatches">{agentColorPalette.map((value) => <button type="button" key={value} className={`sw ${color.toLowerCase() === value.toLowerCase() ? 'sel' : ''}`} style={{ '--c': value } as React.CSSProperties} aria-label={`Cor ${value}`} aria-pressed={color.toLowerCase() === value.toLowerCase()} onClick={() => setColor(value)} />)}</div><div className="aeprev"><AgentIcon profile={preview} size="lg" tip={false} /><span>{preview.label}</span></div></div>
      </>}
      {pending && <div className="convbox"><p>{pending.label}: conclua o login para disponibilizar o agente.</p><div className="actions" style={{ margin: 0 }}><button type="button" disabled={busy} onClick={() => void run(async () => { await window.agentboard.invoke('profiles:login', { profileId: pending.id }); setMessage('Conclua o login na janela aberta. Depois clique em Verificar conta.') })}>Entrar</button><button type="button" className="secondary" disabled={busy} onClick={() => void run(() => checkAccount(pending))}>Verificar conta</button></div></div>}
      {profile && <div className="convbox"><p>{status ? (status.authenticated ? `Conta conectada${status.account ? `: ${status.account}` : ''}.` : status.installed ? 'Instalado, mas a conta não está conectada.' : `Não instalado: ${status.error ?? 'programa não encontrado'}`) : 'Verifique a instalação e a conta deste agente.'}</p><div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" disabled={busy} onClick={() => void run(async () => { await window.agentboard.invoke('profiles:login', { profileId: profile.id }); setMessage('Conclua o login na janela aberta e depois clique em Verificar conta.') })}>Entrar</button><button type="button" className="secondary" disabled={busy} onClick={() => void run(() => checkAccount(profile))}>Verificar conta</button></div></div>}
      {message && <p role="status" className="hint" style={{ overflowWrap: 'anywhere' }}>{message}</p>}
    </div>
    <div className="actions">{profile && <button type="button" className="danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={() => setRemoving(true)}>Remover</button>}<button type="button" className="secondary" onClick={() => void cancel()}>{pending ? 'Cancelar cadastro' : 'Cancelar'}</button>{!pending && (profile || installed) && <button type="button" disabled={busy} onClick={() => void run(save)}>{profile ? 'Salvar' : 'Continuar para conta'}</button>}</div>
    {removing && profile && <div className="overlay top"><div className="modal" style={{ width: 'min(430px,100%)' }}><header><div><div className="eyebrow">Agente</div><h2>Remover {profile.label}?</h2></div></header><p style={{ fontSize: 13, lineHeight: 1.5, color: '#cbd3cd' }}>O agente sai da lista. Agentes com conversas, planos ou execuções salvos não podem ser removidos.</p><div className="actions"><button className="secondary" onClick={() => setRemoving(false)}>Cancelar</button><button className="danger solid" onClick={() => { setRemoving(false); void run(remove) }}>Remover</button></div></div></div>}
    {notice && <NoticeDialog eyebrow="Agente" title={notice.title} text={notice.text} close={() => { const after = notice.after; setNotice(undefined); if (after) close() }} />}
  </div></div>
}
/** Chave do Groq: fica cifrada no computador; a tela só sabe se existe, nunca mostra o valor. */
function GroqKeyField(): React.JSX.Element {
  const [saved, setSaved] = useState<boolean>(), [editing, setEditing] = useState(false), [key, setKey] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => { void window.agentboard.invoke('voice:status', undefined).then((status) => setSaved(status.modelInstalled)).catch(() => undefined) }, [])
  const store = async (value: string): Promise<void> => {
    setBusy(true); setError('')
    try { setSaved((await window.agentboard.invoke('voice:set-key', { key: value })).modelInstalled); setKey(''); setEditing(false); dismissVoiceInstall(); notifyVoiceChanged() } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) }
  }
  return <div className="stack" style={{ gap: 6 }}>
    <div className="f">Chave da API do Groq
      {saved && !editing
        ? <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input className="in" type="password" readOnly value="••••••••••••••••" aria-label="Chave salva" style={{ flex: 1 }} /><span className="hint" style={{ margin: 0 }}>✓ Chave salva</span><button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(true); setError('') }}>Trocar</button><button type="button" className="secondary" disabled={busy} onClick={() => void store('')}>Remover</button></div>
        : <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (key.trim()) void store(key) }}><input className="in" type="password" autoComplete="off" spellCheck={false} autoFocus={editing} placeholder="gsk_…" aria-label="Chave da API do Groq" value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1 }} /><button type="submit" disabled={busy || !key.trim()}>{busy ? 'Conferindo…' : 'Salvar'}</button>{editing && <button type="button" className="secondary" disabled={busy} onClick={() => { setEditing(false); setKey(''); setError('') }}>Cancelar</button>}</form>}
    </div>
    <p className="hint">Crie uma chave grátis em console.groq.com/keys. O áudio vai para o Groq (whisper-large-v3-turbo); o plano gratuito cobre o uso normal e, acima dele, custa cerca de US$ 0,04 por hora de áudio.</p>
    {error && <p className="error">{error}</p>}
  </div>
}

const item = (provider: 'codex' | 'claude'): string => (provider === 'codex' ? 'Codex' : 'Claude')

export function SettingsDialog({ profiles, settings, close, changed, settingsChanged }: { profiles: AgentProfile[]; settings: AppSettings; close(): void; changed(): Promise<void>; settingsChanged(settings: AppSettings): void }): React.JSX.Element {
  const [tab, setTab] = useState<'agents' | 'skills' | 'general' | 'look'>('agents'), [editing, setEditing] = useState<AgentProfile | 'new'>(), [items, setItems] = useState(profiles), [statuses, setStatuses] = useState<Record<string, AgentProbe>>({}), [error, setError] = useState('')
  const [messageSpacing, setMessageSpacing] = useState<MessageSpacing>(() => readMessageSpacing())
  useEffect(() => setItems(profiles), [profiles])
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !editing) close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close, editing])
  useEffect(() => { void window.agentboard.invoke('profiles:probe-all', undefined).then((all) => setStatuses(Object.fromEntries(all.map((probe) => [probe.profileId, probe])))).catch(() => undefined) }, [profiles])
  const save = async (patch: Partial<AppSettings>): Promise<void> => { try { setError(''); settingsChanged(await window.agentboard.invoke('settings:update', patch)) } catch (reason) { setError(String(reason)) } }
  const refresh = async (): Promise<void> => { await changed() }
  return <div className="overlay"><div className="modal" style={{ width: 'min(680px,100%)' }}>
    <header><div><div className="eyebrow">Configurações</div><h2>AgentBoard</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    <div className="tabs" role="tablist" style={{ marginBottom: 14 }}>{([['agents', 'Agentes'], ['skills', 'Skills'], ['general', 'Geral'], ['look', 'Aparência']] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} className={`tab ${tab === value ? 'on' : ''}`} onClick={() => setTab(value)}>{label}</button>)}</div>
    {tab === 'agents' && <><p style={{ marginBottom: 12 }}>Cadastre aqui. Dentro de cada projeto, escolha quais podem trabalhar nele.</p>
      <div className="stack" style={{ gap: 8 }}>{items.length === 0 && <div className="emptyBox">Nenhum agente cadastrado.</div>}{items.map((profile) => { const probe = statuses[profile.id], state = !probe ? 'checking' : probe.authenticated ? 'on' : 'off'; return <div className="ck-line" key={profile.id}><AgentIcon profile={profile} tip={false} /><span className="t">{profile.label}<small>{item(profile.provider)}</small>{probe?.account && <small className="acct" title="Conta em que este agente está logado">{probe.account}</small>}</span><span className="agtype" title="Tipo de uso da conta">{profile.scope}</span><span className={`agstatus ${state}`} title={!probe ? 'Verificando a conexão' : probe.authenticated ? 'Conectado' : probe.installed ? 'Instalado, mas sem login' : 'Programa não instalado'}><i aria-hidden="true" />{!probe ? 'Verificando…' : probe.authenticated ? 'Conectado' : 'Desconectado'}</span><button className="mini secondary" onClick={() => setEditing(profile)}>Editar</button></div> })}</div>
      <button className="bigadd" onClick={() => setEditing('new')}>＋ Adicionar agente</button></>}
    {tab === 'skills' && <SkillsPanel scope="global" profiles={items} />}
    {tab === 'look' && <><p style={{ fontSize: 12, marginBottom: 12 }}>Escolha uma aparência completa para o sistema. O tema também pode ser definido separadamente em cada projeto.</p>
      {(['dark', 'light'] as const).map((mode) => <section className="themegroup" key={mode}><h3>{mode === 'dark' ? 'Temas escuros' : 'Temas claros'}</h3><div className="themes">{themes.filter((theme) => theme.mode === mode).map((theme) => <button type="button" key={theme.value} className={`themeopt ${settings.tema === theme.value ? 'on' : ''}`} style={{ '--c': theme.swatches[0] } as React.CSSProperties} aria-pressed={settings.tema === theme.value} onClick={() => void save({ tema: theme.value })}><span className="sw3">{theme.swatches.map((color) => <i key={color} style={{ background: color }} />)}</span>{theme.label}</button>)}</div></section>)}{error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}</>}
    {tab === 'general' && <><div className="stack">
        <div className="f"><span>Idioma dos agentes</span><Select label="Idioma dos agentes" options={[...languages]} value={settings.idioma} onChange={(value) => void save({ idioma: value as AppLanguage })} /></div>
        <p className="hint">Tudo o que o agente escreve segue este idioma. A interface continua em português por enquanto.</p>
        <div className="f"><span>Espaço entre as mensagens do chat</span><Select label="Espaço entre as mensagens do chat" options={messageSpacings} value={messageSpacing} onChange={(value) => { const spacing = value as MessageSpacing; setMessageSpacing(spacing); saveMessageSpacing(spacing) }} /></div>
        <p className="hint">Quanto de respiro fica entre a sua mensagem e a do agente. Vale na hora, em todos os chats.</p>
        <label className="autosave" style={{ marginRight: 0 }}><input type="checkbox" role="switch" checked={settings.notificacoes} onChange={(e) => void save({ notificacoes: e.target.checked })} /><span className="sw" aria-hidden="true" />Notificações do sistema</label>
        <p className="hint">Avisa quando um card termina, o plano fica pronto ou algo precisa de você, com o AgentBoard em segundo plano. Tocar na notificação abre o chat do card.</p>
        <label className="autosave" style={{ marginRight: 0 }}><input type="checkbox" role="switch" checked={settings.retomarSozinho} onChange={(e) => void save({ retomarSozinho: e.target.checked })} /><span className="sw" aria-hidden="true" />Retomar sozinho quando o limite de uso voltar</label>
        <p className="hint">Se o limite da sessão (ou da semana) acabar no meio de uma execução, o AgentBoard agenda a retomada para quando ele voltar (um minuto depois), confere se voltou mesmo e continua de onde parou. O chat avisa o horário.</p>
        <div className="f"><span>Ditado por voz</span><Select label="Ditado por voz" options={[...voices]} value={settings.voz} onChange={(value) => void save({ voz: value as VoiceModel }).then(() => { dismissVoiceInstall(); notifyVoiceChanged() })} /></div>
        {settings.voz === 'groq' ? <GroqKeyField /> : <p className="hint">O modelo é baixado só quando você usa o microfone do chat pela primeira vez e fica na pasta de dados do AgentBoard.</p>}
      </div>{error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}</>}
    <div className="actions"><button className="secondary" onClick={close}>Fechar</button></div>
    {editing && <AgentDialog profile={editing === 'new' ? undefined : editing} close={() => setEditing(undefined)} changed={refresh} />}
  </div></div>
}
