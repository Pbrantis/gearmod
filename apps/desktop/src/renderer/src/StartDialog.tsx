import React, { useEffect, useState } from 'react'
import { defaultPermissionMode, permissionModes, type AgentConfig, type AgentProfile, type Card } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { CheckIcon } from './icons'
import { ModelMenu, useAgentConfig } from './ModelMenu'
import { Select } from './Select'

/** Iniciar execução (protótipo): agente · modelo · esforço e "Executar como?". Iniciar aprova o plano atual e leva o card para Doing. */
export function StartDialog({ card, purpose, profiles, close, start }: { card: Card; purpose: 'execution' | 'test'; profiles: AgentProfile[]; close(): void; start(config: AgentConfig, baseBranch?: string): Promise<void> }): React.JSX.Element {
  const [lockedId, setLockedId] = useState<string>()
  useEffect(() => { void window.agentboard.invoke('chats:list', { projectId: card.projectId, cardId: card.id }).then((items) => setLockedId(items.find((item) => item.purpose === purpose)?.profileId)).catch(() => undefined) }, [card.id, card.projectId, purpose])
  const state = useAgentConfig(card.id, purpose, profiles, lockedId)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  // Worktree: nova (padrão) ou a de outro card do projeto (só se este card ainda não tem uma).
  const [others, setOthers] = useState<Array<{ cardId: string; title: string; branch: string }>>([]), [from, setFrom] = useState('new')
  useEffect(() => { if (!card.workspace) void window.agentboard.invoke('worktrees:candidates', { cardId: card.id }).then(setOthers).catch(() => undefined) }, [card.id, card.workspace])
  const [branches, setBranches] = useState<{ branches: string[]; current: string | null; selected: string | null; locked: boolean }>(), [branch, setBranch] = useState('')
  useEffect(() => { void window.agentboard.invoke('cards:branches', { cardId: card.id }).then((info) => { setBranches(info); setBranch(info.selected ?? info.current ?? info.branches[0] ?? '') }).catch(() => undefined) }, [card.id])
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close])
  const profile = profiles.find((item) => item.id === state.config?.profileId)
  const modes = profile ? permissionModes[profile.provider].filter((item) => item.purposes.includes(purpose)) : []
  return <div className="overlay" role="dialog" aria-label={purpose === 'test' ? 'Iniciar teste' : 'Iniciar execução'}><div className="modal" style={{ width: 'min(480px,100%)' }}>
    <header><div><div className="eyebrow">{purpose === 'test' ? 'Iniciar teste' : 'Iniciar execução'}</div><h2>{card.title || 'Novo card'}</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    <div className="stack" style={{ gap: 10, marginBottom: 14 }}>
      <div className="f"><span>Agente</span><Select label="Agente" disabled={Boolean(lockedId)} options={profiles.map((item) => ({ value: item.id, label: item.label, icon: <AgentIcon profile={item} tip={false} />, sub: item.provider === 'codex' ? 'Codex' : 'Claude' }))} value={state.config?.profileId ?? ''} onChange={(value) => { const next = profiles.find((item) => item.id === value); if (next) void state.update({ profileId: next.id, model: null, effort: null, mode: defaultPermissionMode(next.provider, purpose) }) }} /></div>
      {lockedId && <p className="hint">Esta etapa já tem um chat com {profile?.label}; o agente fica travado. Para trocar, reinicie o chat pelo menu do agente no chat.</p>}
      <div className="f"><span>Modelo e esforço</span><ModelMenu profiles={profiles} purpose={purpose} state={state} noAgent field /></div>
      {from === 'new' && branches && branches.branches.length > 0 && <div className="f"><span>Branch base</span>
        {branches.locked ? <p className="hint" style={{ margin: 0 }}>A worktree deste card já foi criada a partir de <b>{card.workspace?.baseRef ?? branches.selected}</b>; a base não muda mais.</p>
          : <><Select label="Branch base" up options={branches.branches.map((name) => ({ value: name, label: name, sub: name === branches.current ? 'atual' : '' }))} value={branch} onChange={setBranch} /><small className="hint">O agente trabalha numa branch nova de {branch || 'a atual'}, numa worktree isolada.</small></>}</div>}
      {others.length > 0 && <div className="f"><span>Worktree</span><Select label="Worktree" up options={[{ value: 'new', label: 'Criar uma nova', sub: 'isolada' }, ...others.map((item) => ({ value: item.cardId, label: `Usar a de ${item.title || 'outro card'}`, sub: item.branch }))]} value={from} onChange={setFrom} /><small className="hint">{from === 'new' ? 'O agente trabalha numa worktree própria deste card.' : 'O agente trabalha na pasta do outro card; Alterações e Git deste card mostram essa pasta.'}</small></div>}
    </div>
    <div className="sectitle" style={{ marginBottom: 8 }}>{purpose === 'test' ? 'Testar como?' : 'Executar como?'}</div>
    <div className="stack" style={{ gap: 8 }}>{modes.map((item) => <button type="button" key={item.id} disabled={item.needsApprovalUi} title={item.needsApprovalUi ? 'Precisa da tela de aprovação (em breve)' : undefined} className={`startopt ${state.config?.mode === item.id ? 'sel' : ''}`} onClick={() => void state.update({ mode: item.id })}><span className="mo-t"><b>{item.label}</b>{item.recommended && <em>Recomendado</em>}{item.dangerous && <em>Cuidado</em>}<small>{item.description}</small></span><span className="mo-r">{state.config?.mode === item.id && <CheckIcon />}</span></button>)}</div>
    {(error || state.error) && <p className="error" style={{ marginTop: 10 }}>{error || state.error}</p>}
    <div className="actions"><button type="button" className="secondary" onClick={close}>Cancelar</button><button type="button" disabled={busy || !state.config} onClick={() => { if (!state.config) return; setBusy(true); setError(''); const config = state.config; void (from === 'new' ? Promise.resolve() : window.agentboard.invoke('worktrees:link', { cardId: card.id, fromCardId: from }).then(() => undefined)).then(() => start(config, from === 'new' && branches && !branches.locked && branch ? branch : undefined)).catch((reason: unknown) => { setError(String(reason).replace(/^Error: /, '')); setBusy(false) }) }}>{busy ? 'Iniciando…' : 'Iniciar'}</button></div>
  </div></div>
}
