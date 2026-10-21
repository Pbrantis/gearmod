import React, { useEffect, useState } from 'react'
import { cardDocumentKinds, permissionModes, defaultPermissionMode, type AgentProfile, type Card, type CardDocumentKind, type CardDocuments, type DocumentVersion, type ProjectSource } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { ConfirmDialog } from './ConfirmDialog'
import { ChatIcon, EyeIcon, PencilIcon, SplitIcon } from './icons'
import { Markdown } from './markdown'
import { ModelMenu, useAgentConfig } from './ModelMenu'
import { Select } from './Select'

export interface Draft { id?: string; columnId: string; sourceId?: string | null; title: string; type: Card['type']; priority: Card['priority'] }
export const blankDraft = (columnId: string): Draft => ({ columnId, title: '', type: 'task', priority: 'medium' })

const labels: Record<CardDocumentKind, string> = { resumo: 'Resumo', especificacao: 'Especificação', plano: 'Plano', tasks: 'Tasks' }
const placeholders: Record<CardDocumentKind, string> = {
  resumo: 'Resumo do que está acontecendo neste card.',
  especificacao: '## Especificação\n**Objetivo.** …\n\n**Comportamento esperado**\n- …\n\n**Fora de escopo**\n- …',
  plano: '## Plano\n1. …\n2. …',
  tasks: '## Tasks\n- [ ] T001 Nome da task\n  - [ ] Critério de aceite desta task\n  - [ ] Outro critério'
}
const types = [{ value: 'feature', label: 'Feature', color: '#8fb8d6' }, { value: 'bug', label: 'Bug', color: '#ff9d91' }, { value: 'improvement', label: 'Improvement', color: 'var(--accent-strong)' }, { value: 'task', label: 'Task', color: '#98a099' }]
const priorities = [{ value: 'low', label: 'Baixa', color: '#98a099' }, { value: 'medium', label: 'Média', color: '#8fb8d6' }, { value: 'high', label: 'Alta', color: '#e8c27a' }, { value: 'urgent', label: 'Urgente', color: '#ff9d91' }]
type Mode = 'write' | 'split' | 'prev'
type Texts = Record<CardDocumentKind, string>
const empty: Texts = { resumo: '', especificacao: '', plano: '', tasks: '' }
const toTexts = (docs: CardDocuments): Texts => ({ resumo: docs.resumo.contentMd, especificacao: docs.especificacao.contentMd, plano: docs.plano.contentMd, tasks: docs.tasks.contentMd })
const topLevel = (markdown: string): { done: number; total: number } => { const items = markdown.split('\n').filter((line) => /^[-*+]\s+\[( |x|X)\]/.test(line)); return { total: items.length, done: items.filter((line) => !/\[ \]/.test(line)).length } }

/** Editor do card (protótipo): dados e agentes à esquerda, documento Markdown no meio e a lista dos 4 documentos à direita. */
export function CardEditor({ projectId, sources, profiles, draft: start, close, saved, openChat }: { projectId: string; sources: ProjectSource[]; profiles: AgentProfile[]; draft: Draft; close(): void; saved(): void; openChat?(): void }): React.JSX.Element {
  const [d, set] = useState(start), [kind, setKind] = useState<CardDocumentKind>('resumo'), [mode, setMode] = useState<Mode>('write'), [texts, setTexts] = useState<Texts>(empty), [original, setOriginal] = useState<Texts>(empty)
  const [versions, setVersions] = useState<DocumentVersion[]>(), [error, setError] = useState(''), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(!start.id)
  const planAgent = useAgentConfig(start.id ?? '', 'planning', profiles), execAgent = useAgentConfig(start.id ?? '', 'execution', profiles)
  const gitSources = sources.filter((source) => source.isGitRepository)
  useEffect(() => { if (start.id) void window.agentboard.invoke('cards:documents', { cardId: start.id }).then((docs) => { setTexts(toTexts(docs)); setOriginal(toTexts(docs)); setLoaded(true) }).catch((reason: unknown) => setError(String(reason))) }, [start.id])
  useEffect(() => { setVersions(undefined) }, [kind])
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !confirming) close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close, confirming])
  const dirty = (k: CardDocumentKind): boolean => texts[k] !== original[k]
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const sourceId = d.sourceId ?? gitSources[0]?.id ?? null
      const base = { sourceId, title: d.title, type: d.type, priority: d.priority, description: texts.resumo, acceptanceCriteria: [] }
      const card = d.id ? await window.agentboard.invoke('cards:update', { cardId: d.id, ...base }) : await window.agentboard.invoke('cards:create', { projectId, columnId: d.columnId, ...base })
      for (const k of cardDocumentKinds) if (k !== 'resumo' && dirty(k)) await window.agentboard.invoke('cards:write-document', { cardId: card.id, kind: k, contentMd: texts[k] })
      if (!d.id) for (const [purpose, state] of [['planning', planAgent], ['execution', execAgent]] as const) if (state.touched && state.config) await window.agentboard.invoke('cards:set-agent-config', { cardId: card.id, purpose, config: state.config })
      saved()
    } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } finally { setBusy(false) }
  }
  const toggle = (line: number, checked: boolean): void => {
    const lines = texts[kind].split('\n'); const current = lines[line]; if (current === undefined) return
    lines[line] = current.replace(/\[( |x|X)\]/, checked ? '[x]' : '[ ]'); setTexts({ ...texts, [kind]: lines.join('\n') })
  }
  const showVersions = async (): Promise<void> => { if (d.id) setVersions(await window.agentboard.invoke('cards:document-versions', { cardId: d.id, kind })) }
  const agentOptions = () => profiles.map((item) => ({ value: item.id, label: item.label, icon: <AgentIcon profile={item} tip={false} />, sub: item.provider === 'codex' ? 'Codex' : 'Claude' }))
  const agentField = (purpose: 'planning' | 'execution', state: typeof planAgent, withMode: boolean): React.JSX.Element => {
    const profile = profiles.find((item) => item.id === state.config?.profileId)
    const modes = profile ? permissionModes[profile.provider].filter((item) => item.purposes.includes('execution')) : []
    return <div className="agentfield">
      <Select label={`Agente de ${purpose === 'planning' ? 'planejamento' : 'execução'}`} up={purpose === 'execution'} options={agentOptions()} value={state.config?.profileId ?? ''} onChange={(value) => { const next = profiles.find((item) => item.id === value); if (next) void state.update({ profileId: next.id, model: null, effort: null, mode: defaultPermissionMode(next.provider, purpose) }) }} />
      <ModelMenu profiles={profiles} purpose={purpose} state={state} noAgent field />
      {withMode && profile && <div className="f"><span>Modo de execução</span><Select label="Modo de execução" up options={modes.map((item) => ({ value: item.id, label: item.label, sub: item.recommended ? 'Recomendado' : item.needsApprovalUi ? 'em breve' : '', disabled: item.needsApprovalUi }))} value={state.config?.mode ?? ''} onChange={(value) => void state.update({ mode: value as never })} /></div>}
    </div>
  }
  const text = texts[kind]
  return <div className="overlay full"><div className="modal wide" role="dialog" aria-label={d.id ? 'Editar card' : 'Novo card'}>
    <header><div><div className="eyebrow">{d.id ? 'Editar card' : 'Novo card'}</div><h2>{d.title || 'Sem título'}</h2></div><div className="hdr-actions">{d.id && openChat && <button type="button" className="mini secondary openchat" onClick={openChat}><ChatIcon />Abrir chat</button>}<button type="button" className="x" onClick={close} aria-label="Fechar">×</button></div></header>
    <form onSubmit={(e) => void submit(e)} style={{ display: 'contents' }}>
      <div className="editor docs">
        <div className="stack pane-left" style={{ alignContent: 'start' }}>
          <label className="f">Título<input className="in" style={{ fontWeight: 600 }} value={d.title} onChange={(e) => set({ ...d, title: e.target.value })} required /></label>
          <div className="f"><span>Tipo</span><Select label="Tipo" options={types} value={d.type} onChange={(value) => set({ ...d, type: value as Card['type'] })} /></div>
          <div className="f"><span>Prioridade</span><Select label="Prioridade" options={priorities} value={d.priority} onChange={(value) => set({ ...d, priority: value as Card['priority'] })} /></div>
          {gitSources.length > 1 && <div className="f"><span>Repositório</span><Select label="Repositório" options={gitSources.map((source) => ({ value: source.id, label: source.name, sub: source.currentBranch ?? '' }))} value={d.sourceId ?? gitSources[0]!.id} onChange={(value) => set({ ...d, sourceId: value })} /></div>}
          {profiles.length > 0 && <><div className="sep"><span className="sectitle">Planejamento</span>{agentField('planning', planAgent, false)}</div><div className="sep"><span className="sectitle">Execução · responsável</span>{agentField('execution', execAgent, true)}</div></>}
          {gitSources.length === 0 && <p className="hint">Este projeto não possui Git. O planejamento funciona normalmente; a execução com worktree exige um repositório.</p>}
        </div>
        <div className="stack pane-mid" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="sectitle">{labels[kind]} · Markdown</span>
            <div className="tabs">{d.id && <button type="button" className="ibtn tip" data-tip="Histórico de versões" aria-label="Histórico de versões" onClick={() => void showVersions()}><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg></button>}
              {([['write', 'Escrever', <PencilIcon key="w" />], ['split', 'Dividido', <SplitIcon key="s" />], ['prev', 'Prévia', <EyeIcon key="p" />]] as const).map(([value, label, icon]) => <button type="button" key={value} className={`ibtn tip ${mode === value ? 'on' : ''}`} data-tip={label} aria-label={label} aria-pressed={mode === value} onClick={() => setMode(value)}>{icon}</button>)}</div></div>
          {mode === 'prev' ? <div className="md descarea"><Markdown source={text} onToggle={kind === 'tasks' || kind === 'plano' ? toggle : undefined} /></div>
            : <div className={`descwrap ${mode === 'split' ? 'split' : ''}`}><textarea className="in descarea" aria-label={`Documento ${labels[kind]}`} style={{ fontFamily: 'var(--mono)', fontSize: 13 }} value={text} disabled={!loaded} placeholder={placeholders[kind]} onChange={(e) => setTexts({ ...texts, [kind]: e.target.value })} />{mode === 'split' && <div className="md descarea"><Markdown source={text} onToggle={kind === 'tasks' || kind === 'plano' ? toggle : undefined} /></div>}</div>}
          {versions && <div className="versions"><b>Versões de {labels[kind]}</b>{versions.length === 0 && <p>Sem versões salvas ainda.</p>}{versions.map((v) => <div key={v.id} className="versionRow"><span>v{v.version} · {new Date(v.createdAt).toLocaleString('pt-BR')} · {v.actor === 'agent' ? 'agente' : v.actor === 'system' ? 'sistema' : 'você'}</span><button type="button" className="mini secondary" onClick={() => { setTexts({ ...texts, [kind]: v.contentMd }); setVersions(undefined) }}>Restaurar</button></div>)}</div>}
        </div>
        <div className="stack pane-docs">
          <span className="sectitle">Documentos</span>
          {cardDocumentKinds.map((k) => { const value = texts[k], tasks = k === 'tasks' ? topLevel(value) : null, status = tasks ? (tasks.total ? `${tasks.done}/${tasks.total}` : 'vazio') : value.trim() ? 'escrito' : 'vazio'
            return <button type="button" key={k} className={`docbtn ${kind === k ? 'on' : ''} ${value.trim() ? '' : 'empty'}`} onClick={() => setKind(k)}><span className="dn">{labels[k]}{dirty(k) && <i className="dirtyDot" aria-label="alterado" />}</span><span className="ds">{status}</span>{tasks && tasks.total > 0 && <span className="dprog"><i style={{ width: `${Math.round((tasks.done / tasks.total) * 100)}%` }} /></span>}</button> })}
        </div>
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="actions">{d.id && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={() => setConfirming(true)}>Excluir card</button>}<button type="button" className="secondary" onClick={close}>Cancelar</button><button disabled={busy || !loaded || !d.title.trim()}>{busy ? 'Salvando…' : 'Salvar card'}</button></div>
    </form>
    {confirming && d.id && <ConfirmDialog eyebrow="Excluir card" title={d.title || 'Card'} text="O card, os documentos, os planos e o histórico de conversas dele serão removidos. Isso não pode ser desfeito." ok="Excluir" danger cancel={() => setConfirming(false)} confirm={() => void window.agentboard.invoke('cards:delete', { cardId: d.id! }).then(saved).catch((reason: unknown) => { setConfirming(false); setError(String(reason)) })} />}
  </div></div>
}
