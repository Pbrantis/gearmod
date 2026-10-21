import React, { useEffect, useState } from 'react'
import type { AgentProbe, AgentProfile } from '@agentboard/contracts'

export function AgentManager({ profiles, close, changed }: { profiles: AgentProfile[]; close(): void; changed(): Promise<void> }): React.JSX.Element {
  const [items, setItems] = useState(profiles), [adding, setAdding] = useState(false)
  const [provider, setProvider] = useState<'codex' | 'claude'>('codex'), [label, setLabel] = useState(''), [scope, setScope] = useState('Pessoal'), [existing, setExisting] = useState(true)
  const [installed, setInstalled] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [pending, setPending] = useState<AgentProfile>(), [editing, setEditing] = useState<AgentProfile>(), [statuses, setStatuses] = useState<Record<string, AgentProbe>>({})
  const [createdHere, setCreatedHere] = useState(false)
  const run = async (action: () => Promise<void>): Promise<void> => { setBusy(true); setMessage(''); try { await action() } catch (error) { setMessage(String(error)) } finally { setBusy(false) } }
  const refresh = async (): Promise<void> => { setItems(await window.agentboard.invoke('profiles:list', undefined)); await changed() }
  const checkInstall = async (): Promise<void> => {
    const result = await window.agentboard.invoke('profiles:detect-provider', { provider })
    setInstalled(result.installed)
    setMessage(result.installed ? `Instalação encontrada: ${result.version || provider}. Continue para conectar sua conta.` : `Programa não encontrado. Clique em Instalar e, ao terminar, em Verificar instalação.${result.error ? ` Detalhe: ${result.error}` : ''}`)
  }
  useEffect(() => { if (adding) { setInstalled(false); void run(checkInstall) } }, [provider, adding])
  const checkAccount = async (profile: AgentProfile): Promise<void> => {
    const result = await window.agentboard.invoke('profiles:probe', { profileId: profile.id })
    setStatuses((current) => ({ ...current, [profile.id]: result }))
    if (result.authenticated && result.installed) { await refresh(); setPending(undefined); setAdding(false); setMessage(`${profile.label} conectado e pronto para selecionar nos projetos.`) }
    else setMessage(result.installed ? 'Instalação encontrada. Clique em Entrar, conclua o login e depois em Verificar conta.' : `Não foi possível executar o agente: ${result.error || 'programa não encontrado'}`)
  }
  const continueAccount = async (): Promise<void> => {
    const profile = await window.agentboard.invoke('profiles:create', { provider, label: label.trim() || (provider === 'codex' ? 'Meu Codex' : 'Meu Claude'), scope: scope.trim() || 'Pessoal', useExistingSession: existing })
    setCreatedHere(true); setPending(profile); await checkAccount(profile)
  }
  const remove = async (profile: AgentProfile): Promise<void> => { if (!window.confirm(`Remover ${profile.label}?`)) return; await window.agentboard.invoke('profiles:delete', { profileId: profile.id }); await refresh() }
  return <div className="overlay"><div className="modal"><header><div><h2>Gerenciar agentes</h2><p>Instale, conecte sua conta e escolha os agentes nos projetos.</p></div><button onClick={close} aria-label="Fechar">×</button></header>
    {!adding && <button onClick={() => { setLabel(''); setScope('Pessoal'); setPending(undefined); setAdding(true) }}>＋ Adicionar agente</button>}
    {adding && <section className="agentSetup onboarding"><p className="fieldTitle">{pending ? '3 · Conectar conta' : installed ? '2 · Configurar agente' : '1 · Instalar agente'}</p>
      {!pending && <><div className="providerCards"><button disabled={busy} className={provider === 'codex' ? 'selected' : ''} onClick={() => setProvider('codex')}>Codex</button><button disabled={busy} className={provider === 'claude' ? 'selected' : ''} onClick={() => setProvider('claude')}>Claude</button></div>
      <div className="inlineActions"><button disabled={busy} className="secondary" onClick={() => void run(checkInstall)}>{busy ? 'Verificando…' : 'Verificar instalação'}</button>{!installed && <button disabled={busy} onClick={() => void run(async () => { await window.agentboard.invoke('profiles:install-provider', { provider }); setMessage('Instalação aberta no terminal. Quando terminar, clique em Verificar instalação aqui.'); })}>Instalar {provider === 'codex' ? 'Codex' : 'Claude'}</button>}</div>
      {installed && <><label>Nome<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Meu agente" /></label><label>Uso<input value={scope} onChange={(e) => setScope(e.target.value)} /></label><label className="sessionOption"><input type="checkbox" checked={existing} onChange={(e) => setExisting(e.target.checked)} /><span>Usar sessão atual<small>Desmarque para conectar outra conta em uma sessão separada.</small></span></label><button disabled={busy} onClick={() => void run(continueAccount)}>Continuar para conta</button></>}
      </>}
      {pending && <><p>{pending.label}: conclua o login para disponibilizar o agente.</p><div className="inlineActions"><button disabled={busy} onClick={() => void run(async () => { await window.agentboard.invoke('profiles:login', { profileId: pending.id }); setMessage('Conclua o login na janela aberta. Depois clique em Verificar conta.'); })}>Entrar</button><button disabled={busy} className="secondary" onClick={() => void run(() => checkAccount(pending))}>Verificar conta</button></div></>}
      <div className="inlineActions"><button disabled={busy} className="secondary" onClick={() => void run(async () => { if (pending && createdHere) await window.agentboard.invoke('profiles:delete', { profileId: pending.id }); setCreatedHere(false); setPending(undefined); setAdding(false); await refresh() })}>Cancelar cadastro</button></div>
    </section>}
    {message && <p role="status" className="hint" style={{ background: 'var(--surface-2)', color: 'var(--text)', overflowWrap: 'anywhere' }}>{message}</p>}
    {!adding && <div className="agentLibrary">{!items.length && <p>Nenhum agente cadastrado.</p>}{items.map((profile) => <div className="agentLibraryRow" key={profile.id}><i>{profile.provider === 'codex' ? 'C' : 'A'}</i><span><b>{profile.label}</b><small>{profile.provider} · {profile.scope} · {statuses[profile.id]?.authenticated ? 'conectado' : 'verifique a conta'}</small></span><div style={{ flexWrap: 'wrap' }}><button disabled={busy} className="secondary" onClick={() => void run(async () => { setProvider(profile.provider); setPending(profile); setAdding(true); await checkAccount(profile) })}>Conectar / verificar</button><button disabled={busy} className="secondary" onClick={() => setEditing({ ...profile })}>Editar</button><button disabled={busy} className="dangerButton" onClick={() => void run(() => remove(profile))}>Remover</button></div></div>)}</div>}
    {editing && <section><label>Nome<input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></label><label>Uso<input value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value })} /></label><button disabled={busy} onClick={() => void run(async () => { await window.agentboard.invoke('profiles:update', { profileId: editing.id, label: editing.label, scope: editing.scope }); setEditing(undefined); await refresh() })}>Salvar edição</button></section>}
    <div className="actions"><button disabled={busy} className="secondary" onClick={close}>Fechar</button></div>
  </div></div>
}
