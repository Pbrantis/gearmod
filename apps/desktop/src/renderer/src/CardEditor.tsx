import React, { useEffect, useRef, useState } from 'react'
import { cardDocumentKinds, type AgentProfile, type Card, type CardDocumentKind, type CardDocuments, type DocumentVersion, type ProjectSource } from '@agentboard/contracts'
import { AgentMenu, useAgentConfig } from './AgentMenu'
import { ConfirmDialog } from './ConfirmDialog'
import { ChatIcon, TrashIcon } from './icons'
import { Markdown } from './markdown'

export interface Draft { id?: string; columnId: string; sourceId?: string | null; title: string; type: Card['type']; priority: Card['priority'] }
export const blankDraft = (columnId: string): Draft => ({ columnId, title: '', type: 'task', priority: 'medium' })

const labels: Record<CardDocumentKind, string> = { resumo: 'Resumo', especificacao: 'Especificação', plano: 'Plano', tasks: 'Tasks' }
type Mode = 'write' | 'split' | 'preview'
type Texts = Record<CardDocumentKind, string>
const empty: Texts = { resumo: '', especificacao: '', plano: '', tasks: '' }
const modes: Array<{ value: Mode; label: string }> = [{ value: 'write', label: 'Escrever' }, { value: 'split', label: 'Dividido' }, { value: 'preview', label: 'Prévia' }]
const toTexts = (docs: CardDocuments): Texts => ({ resumo: docs.resumo.contentMd, especificacao: docs.especificacao.contentMd, plano: docs.plano.contentMd, tasks: docs.tasks.contentMd })

/** Editor do card: dados básicos e os 4 documentos Markdown (Resumo, Especificação, Plano e Tasks). */
export function CardEditor({ projectId, sources, profiles, draft: start, close, saved, openChat }: { projectId: string; sources: ProjectSource[]; profiles: AgentProfile[]; draft: Draft; close(): void; saved(): void; openChat?(): void }): React.JSX.Element {
  const [d, set] = useState(start), [kind, setKind] = useState<CardDocumentKind>('resumo'), [mode, setMode] = useState<Mode>('split'), [texts, setTexts] = useState<Texts>(empty), [original, setOriginal] = useState<Texts>(empty)
  const [versions, setVersions] = useState<DocumentVersion[]>(), [error, setError] = useState(''), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(!start.id)
  const planAgent = useAgentConfig(start.id ?? '', 'planning', profiles), execAgent = useAgentConfig(start.id ?? '', 'execution', profiles)
  const gitSources = sources.filter((source) => source.isGitRepository), area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (start.id) void window.agentboard.invoke('cards:documents', { cardId: start.id }).then((docs) => { setTexts(toTexts(docs)); setOriginal(toTexts(docs)); setLoaded(true) }).catch((reason: unknown) => setError(String(reason))) }, [start.id])
  useEffect(() => { setVersions(undefined) }, [kind])
  const dirty = (k: CardDocumentKind): boolean => texts[k] !== original[k]
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const sourceId = d.sourceId ?? gitSources[0]?.id ?? null
      const base = { sourceId, title: d.title, type: d.type, priority: d.priority, description: texts.resumo, acceptanceCriteria: [] }
      const card = d.id ? await window.agentboard.invoke('cards:update', { cardId: d.id, ...base }) : await window.agentboard.invoke('cards:create', { projectId, columnId: d.columnId, ...base })
      for (const k of cardDocumentKinds) if (k !== 'resumo' && dirty(k)) await window.agentboard.invoke('cards:write-document', { cardId: card.id, kind: k, contentMd: texts[k] })
      saved()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const toggle = (line: number, checked: boolean): void => {
    const lines = texts.tasks.split('\n'); const current = lines[line]; if (current === undefined) return
    lines[line] = current.replace(/\[( |x|X)\]/, checked ? '[x]' : '[ ]'); setTexts({ ...texts, tasks: lines.join('\n') })
  }
  const toggleOn = kind === 'tasks' || kind === 'plano' ? toggle : undefined
  const showVersions = async (): Promise<void> => { if (d.id) setVersions(await window.agentboard.invoke('cards:document-versions', { cardId: d.id, kind })) }
  return <div className="overlay full"><div className="modal wide cardEditor"><header><div><p className="eyebrow">{d.id ? 'Editar card' : 'Novo card'}</p><h2>{d.title || 'Sem título'}</h2></div><div className="hdrActions">{d.id && openChat && <button type="button" className="secondary iconText" onClick={openChat}><ChatIcon /> Abrir chat</button>}<button type="button" onClick={close} aria-label="Fechar">×</button></div></header>
    <form onSubmit={(e) => void submit(e)}>
      <div className="editorGrid">
        <aside className="meta">
          <label>Título<input value={d.title} onChange={(e) => set({ ...d, title: e.target.value })} required /></label>
          <div className="two"><label>Tipo<select value={d.type} onChange={(e) => set({ ...d, type: e.target.value as Card['type'] })}><option value="feature">Feature</option><option value="bug">Bug</option><option value="improvement">Improvement</option><option value="task">Task</option></select></label><label>Prioridade<select value={d.priority} onChange={(e) => set({ ...d, priority: e.target.value as Card['priority'] })}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label></div>
          {gitSources.length > 0 ? <label>Repositório<select value={d.sourceId ?? gitSources[0]?.id} onChange={(e) => set({ ...d, sourceId: e.target.value })}>{gitSources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.currentBranch}</option>)}</select></label> : <p className="hint">Este projeto não possui Git. O planejamento funciona normalmente; execução com worktree exige um repositório.</p>}
          {d.id && profiles.length > 0 && <div className="agentsBlock"><span className="sectitle">Agente de planejamento</span><AgentMenu profiles={profiles} purpose="planning" state={planAgent} showMode={false} /><span className="sectitle">Agente de execução</span><AgentMenu profiles={profiles} purpose="execution" state={execAgent} /></div>}
        </aside>
        <section className="docs">
          <div className="docTabs" role="tablist">{cardDocumentKinds.map((k) => <button type="button" role="tab" aria-selected={kind === k} key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{labels[k]}{dirty(k) && <i className="dirtyDot" aria-label="alterado" />}</button>)}</div>
          <div className="docBar"><span className="sectitle">{labels[kind]} · Markdown</span><div className="modeSwitch">{modes.map((m) => <button type="button" key={m.value} aria-pressed={mode === m.value} className={mode === m.value ? 'on' : ''} onClick={() => setMode(m.value)}>{m.label}</button>)}{d.id && <button type="button" onClick={() => void showVersions()}>Histórico</button>}</div></div>
          <div className={`docBody ${mode}`}>
            {mode !== 'preview' && <textarea ref={area} aria-label={`Documento ${labels[kind]}`} value={texts[kind]} disabled={!loaded} placeholder={kind === 'tasks' ? '- [ ] T001 Descrição da task\n  - [ ] Critério de aceite' : 'Escreva em Markdown…'} onChange={(e) => setTexts({ ...texts, [kind]: e.target.value })} />}
            {mode !== 'write' && <div className="preview"><Markdown source={texts[kind]} onToggle={toggleOn} /></div>}
          </div>
          {versions && <div className="versions"><b>Versões de {labels[kind]}</b>{versions.length === 0 && <p>Sem versões salvas ainda.</p>}{versions.map((v) => <div key={v.id} className="versionRow"><span>v{v.version} · {new Date(v.createdAt).toLocaleString('pt-BR')} · {v.actor === 'agent' ? 'agente' : v.actor === 'system' ? 'sistema' : 'você'}</span><button type="button" className="secondary" onClick={() => { setTexts({ ...texts, [kind]: v.contentMd }); setVersions(undefined) }}>Restaurar</button></div>)}</div>}
        </section>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="actions">{d.id && <button type="button" className="dangerButton deleteCard iconText" onClick={() => setConfirming(true)}><TrashIcon /> Excluir</button>}<button type="button" className="secondary" onClick={close}>Cancelar</button><button disabled={busy || !loaded || !d.title.trim()}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
    </form>
    {confirming && d.id && <ConfirmDialog eyebrow="Excluir card" title={d.title || 'Card'} text="O card, os documentos, os planos e o histórico de conversas dele serão removidos. Isso não pode ser desfeito." ok="Excluir" danger cancel={() => setConfirming(false)} confirm={() => void window.agentboard.invoke('cards:delete', { cardId: d.id! }).then(saved).catch((reason: unknown) => { setConfirming(false); setError(String(reason)) })} />}
  </div></div>
}
