import React, { useEffect, useState } from 'react'
import type { Extension } from '@codemirror/state'
import { placeholder } from '@codemirror/view'
import { CodeEditor } from './editor/CodeEditor'
import { cardDocumentKinds, permissionModes, defaultPermissionMode, type AgentProfile, type CardChecklist, type AgentPurpose, type Card, type Chat, type CardDocumentKind, type CardDocuments, type DocumentVersion, type GitCard, type ProjectSource } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { ConfirmDialog } from './ConfirmDialog'
import { BranchIcon, ChatIcon, CollapseIcon, TreeIcon, ExpandIcon, EyeIcon, PencilIcon, SplitIcon } from './icons'
import { Markdown } from './markdown'
import { TokenUsage } from './TokenUsage'
import { TestChecklist } from './TestChecklist'
import { checklistEvent } from './checklistToggle'
import { ModelMenu, effortLabel, useAgentConfig } from './ModelMenu'
import { AssessmentDialog, ComplexityBadge } from './Assessment'
import { RepoChooser } from './Delivery'
import { DocHistory } from './DocHistory'
import { Select } from './Select'

export interface Draft { id?: string; columnId: string; sourceId?: string | null; title: string; type: Card['type']; priority: Card['priority'] }
export const blankDraft = (columnId: string): Draft => ({ columnId, title: '', type: 'task', priority: 'medium' })

/** Opções do editor de texto corrido dos documentos: quebra de linha, Tab segue o foco (como o campo de texto de antes). */
const proseOptions = { wrap: true, tabSize: 2, indentWithTab: false, whitespace: false, guides: false, scrollPastEnd: false }
const placeholderCache = new Map<string, Extension[]>()
const placeholderFor = (kind: string): Extension[] => { let found = placeholderCache.get(kind); if (!found) { found = [placeholder((placeholders as Record<string, string>)[kind] ?? '')]; placeholderCache.set(kind, found) } return found }
const labels: Record<CardDocumentKind, string> = { resumo: 'Resumo', especificacao: 'Especificação', plano: 'Plano', tasks: 'Tasks', duvidas: 'Dúvidas', mudancas: 'Mudanças' }
const systemKinds: readonly CardDocumentKind[] = ['duvidas', 'mudancas']
const placeholders: Record<CardDocumentKind, string> = {
  resumo: 'Resumo do que está acontecendo neste card.',
  especificacao: '## Especificação\n**Objetivo.** …\n\n**Comportamento esperado**\n- …\n\n**Fora de escopo**\n- …',
  plano: '## Plano\n1. …\n2. …',
  tasks: '## Tasks\n- [ ] T001 Nome da task\n  - [ ] Critério de aceite desta task\n  - [ ] Outro critério',
  duvidas: 'Ainda não há dúvidas. Quando o desenvolvedor ou o testador perguntarem algo, aparece aqui.',
  mudancas: 'Ainda não há propostas de mudança. O que o desenvolvedor ou o testador propuserem fora dos documentos aparece aqui, esperando a sua autorização.'
}
const types = [{ value: 'feature', label: 'Feature', color: '#8fb8d6' }, { value: 'bug', label: 'Bug', color: '#ff9d91' }, { value: 'improvement', label: 'Improvement', color: 'var(--accent-strong)' }, { value: 'task', label: 'Task', color: 'var(--muted)' }, { value: 'minor', label: 'Pequena', color: '#d9c27a' }]
const priorities = [{ value: 'low', label: 'Baixa', color: 'var(--muted)' }, { value: 'medium', label: 'Média', color: '#8fb8d6' }, { value: 'high', label: 'Alta', color: '#e8c27a' }, { value: 'urgent', label: 'Urgente', color: '#ff9d91' }]
type Mode = 'write' | 'split' | 'prev'
type Texts = Record<CardDocumentKind, string>
const empty: Texts = { resumo: '', especificacao: '', plano: '', tasks: '', duvidas: '', mudancas: '' }
const toTexts = (docs: CardDocuments): Texts => ({ resumo: docs.resumo.contentMd, especificacao: docs.especificacao.contentMd, plano: docs.plano.contentMd, tasks: docs.tasks.contentMd, duvidas: docs.duvidas.contentMd, mudancas: docs.mudancas.contentMd })
const topLevel = (markdown: string): { done: number; total: number } => { const items = markdown.split('\n').filter((line) => /^[-*+]\s+\[( |x|X)\]/.test(line)); return { total: items.length, done: items.filter((line) => !/\[ \]/.test(line)).length } }

/** Editor do card (protótipo): dados e agentes à esquerda, documento Markdown no meio e a lista dos 4 documentos à direita. */
export function CardEditor({ projectId, sources, profiles, draft: start, close, saved, openChat, onStart, pending, onPending }: { projectId: string; sources: ProjectSource[]; profiles: AgentProfile[]; pending?: { changes: number; questions: number; toSend?: number }; onPending?(): void; draft: Draft; close(): void; saved(): void; openChat?(purpose: AgentPurpose): void; onStart?(purpose: 'execution' | 'test'): void }): React.JSX.Element {
  const [workspace, setWorkspace] = useState<Card['workspace']>(null), [complexity, setComplexity] = useState<Card>(), [assessing, setAssessing] = useState(false)
  useEffect(() => { if (start.id) void window.agentboard.invoke('cards:get', { cardId: start.id }).then((card) => { setWorkspace(card.workspace); setComplexity(card) }).catch(() => undefined) }, [start.id])
  const [d, set] = useState(start), [chosenKind, setKind] = useState<CardDocumentKind>('resumo'), [mode, setMode] = useState<Mode>(start.id ? 'prev' : 'write'), [texts, setTexts] = useState<Texts>(empty), [original, setOriginal] = useState<Texts>(empty)
  // Tarefa pequena só tem o Resumo, que aqui é o "O que fazer"; os outros documentos não existem para ela.
  const small = d.type === 'minor', kind: CardDocumentKind = small ? 'resumo' : chosenKind
  // Documentos vazios ficam ocultos e aparecem quando alguém escreve; o Resumo e o aberto agora sempre aparecem. "+ Documento" abre um vazio para escrever à mão.
  const [addingDoc, setAddingDoc] = useState(false)
  const waiting = (k: CardDocumentKind): number => k === 'mudancas' ? (pending?.changes ?? 0) + (pending?.toSend ?? 0) : k === 'duvidas' ? pending?.questions ?? 0 : 0
  const shownKinds = cardDocumentKinds.filter((k) => k === 'resumo' || k === kind || waiting(k) > 0 || texts[k].trim() || original[k].trim())
  const hiddenKinds = cardDocumentKinds.filter((k) => !shownKinds.includes(k) && !systemKinds.includes(k))
  const [testsView, setTestsView] = useState(false), [checklistData, setChecklistData] = useState<CardChecklist>()
  const checklist = checklistData?.contentMd ?? ''
  useEffect(() => {
    const cardId = start.id
    if (!cardId) return
    const load = (): void => { void window.agentboard.invoke('cards:checklist', { cardId }).then(setChecklistData).catch(() => undefined) }
    load()
    const received = (event: Event): void => { const next = (event as CustomEvent<CardChecklist>).detail; if (next.cardId === cardId) setChecklistData(next) }
    window.addEventListener(checklistEvent, received)
    const off = window.agentboard.onRunEvent((event) => { if (event.eventType === 'agentboard/card-updated' && event.payload.cardId === cardId) load() })
    return () => { window.removeEventListener(checklistEvent, received); off() }
  }, [start.id])
  const testItems = (checklist.match(/^\s*[-*] \[[ xX]\]/gm) ?? []).length, testDone = (checklist.match(/^\s*[-*] \[[xX]\]/gm) ?? []).length
  const [versions, setVersions] = useState<DocumentVersion[]>(), [error, setError] = useState(''), [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(!start.id)
  const [chats, setChats] = useState<Chat[]>([]), [resetting, setResetting] = useState<AgentPurpose>()
  const loadChats = (): void => { if (start.id) void window.agentboard.invoke('chats:list', { projectId, cardId: start.id }).then(setChats).catch(() => undefined) }
  useEffect(loadChats, [start.id, projectId])
  const chatOf = (purpose: AgentPurpose): Chat | undefined => chats.find((item) => item.purpose === purpose)
  const planAgent = useAgentConfig(start.id ?? '', 'planning', profiles, chatOf('planning')?.profileId), execAgent = useAgentConfig(start.id ?? '', 'execution', profiles, chatOf('execution')?.profileId), testAgent = useAgentConfig(start.id ?? '', 'test', profiles, chatOf('test')?.profileId)
  const gitSources = sources.filter((source) => source.isGitRepository)
  useEffect(() => { if (start.id) void window.agentboard.invoke('cards:documents', { cardId: start.id }).then((docs) => { setTexts(toTexts(docs)); setOriginal(toTexts(docs)); setLoaded(true) }).catch((reason: unknown) => setError(String(reason))) }, [start.id])
  useEffect(() => { setVersions(undefined) }, [kind])
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !confirming) close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close, confirming])
  const dirty = (k: CardDocumentKind): boolean => texts[k] !== original[k]
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem('agentboard.cardAutosave') === '1' } catch { return false } })
  const [autoState, setAutoState] = useState<'' | 'saving' | 'saved'>('')
  const setAutoSave = (value: boolean): void => { setAuto(value); try { localStorage.setItem('agentboard.cardAutosave', value ? '1' : '0') } catch { /* sem armazenamento: vale só nesta abertura */ } }
  // Salvar automaticamente: só em card que já existe; espera 1,2 s sem digitar e grava sem fechar o editor.
  useEffect(() => {
    if (!auto || !d.id || !loaded || !d.title.trim()) return
    const changed = cardDocumentKinds.some((k) => !systemKinds.includes(k) && texts[k] !== original[k]) || d.title !== start.title || d.type !== start.type || d.priority !== start.priority || d.sourceId !== start.sourceId
    if (!changed) return
    const timer = setTimeout(() => {
      setAutoState('saving')
      void (async () => {
        try {
          const base = { sourceId: d.sourceId ?? gitSources[0]?.id ?? null, title: d.title, type: d.type, priority: d.priority, description: texts.resumo, acceptanceCriteria: [] }
          await window.agentboard.invoke('cards:update', { cardId: d.id!, ...base })
          for (const k of cardDocumentKinds) if (k !== 'resumo' && !systemKinds.includes(k) && texts[k] !== original[k]) await window.agentboard.invoke('cards:write-document', { cardId: d.id!, kind: k, contentMd: texts[k] })
          setOriginal(texts); setAutoState('saved'); setError('')
        } catch (reason) { setAutoState(''); setError(String(reason).replace(/^Error: /, '')) }
      })()
    }, 1200)
    return () => clearTimeout(timer)
  }, [auto, d, texts, loaded])
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault(); if (!d.title.trim()) { setError('Informe o título do card.'); return }
    setBusy(true); setError('')
    try {
      const sourceId = d.sourceId ?? gitSources[0]?.id ?? null
      const base = { sourceId, title: d.title, type: d.type, priority: d.priority, description: texts.resumo, acceptanceCriteria: [] }
      const card = d.id ? await window.agentboard.invoke('cards:update', { cardId: d.id, ...base }) : await window.agentboard.invoke('cards:create', { projectId, columnId: d.columnId, ...base })
      for (const k of cardDocumentKinds) if (k !== 'resumo' && !systemKinds.includes(k) && dirty(k)) await window.agentboard.invoke('cards:write-document', { cardId: card.id, kind: k, contentMd: texts[k] })
      if (!d.id) for (const [purpose, state] of [['planning', planAgent], ['execution', execAgent], ['test', testAgent]] as const) if (state.touched && state.config) await window.agentboard.invoke('cards:set-agent-config', { cardId: card.id, purpose, config: state.config })
      saved()
    } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } finally { setBusy(false) }
  }
  const toggle = (line: number, checked: boolean): void => {
    const lines = texts[kind].split('\n'); const current = lines[line]; if (current === undefined) return
    lines[line] = current.replace(/\[( |x|X)\]/, checked ? '[x]' : '[ ]'); setTexts({ ...texts, [kind]: lines.join('\n') })
  }
  const showVersions = async (): Promise<void> => { if (d.id) setVersions(await window.agentboard.invoke('cards:document-versions', { cardId: d.id, kind })) }
  const agentOptions = () => profiles.map((item) => ({ value: item.id, label: item.label, icon: <AgentIcon profile={item} tip={false} />, sub: item.provider === 'codex' ? 'Codex' : 'Claude' }))
  const stepTitle: Record<AgentPurpose, string> = { planning: 'Planejamento', execution: 'Execução', test: 'Teste' }
  const agentField = (purpose: AgentPurpose, state: typeof planAgent): React.JSX.Element => {
    const profile = profiles.find((item) => item.id === state.config?.profileId)
    const modes = profile ? permissionModes[profile.provider].filter((item) => item.purposes.includes('execution')) : []
    const chat = chatOf(purpose)
    return <div className="agentfield">
      <Select label={`Agente de ${purpose === 'planning' ? 'planejamento' : purpose === 'test' ? 'teste' : 'execução'}`} up={purpose !== 'planning'} disabled={Boolean(chat)} options={agentOptions()} value={state.config?.profileId ?? ''} onChange={(value) => { const next = profiles.find((item) => item.id === value); if (next) void state.update({ profileId: next.id, model: null, effort: null, mode: defaultPermissionMode(next.provider, purpose) }) }} />
      {chat && <div className="lockrow"><small>Chat iniciado: o agente fica travado.</small><button type="button" className="mini secondary" onClick={() => setResetting(purpose)}>Trocar agente</button></div>}
      <ModelMenu profiles={profiles} purpose={purpose} state={state} noAgent field />
      {purpose !== 'planning' && profile && <div className="f"><span>{purpose === 'test' ? 'Modo do teste' : 'Modo de execução'}</span><Select label="Modo" up options={modes.map((item) => ({ value: item.id, label: item.label, sub: item.recommended ? 'Recomendado' : item.needsApprovalUi ? 'em breve' : '', disabled: item.needsApprovalUi }))} value={state.config?.mode ?? ''} onChange={(value) => void state.update({ mode: value as never })} /></div>}
    </div>
  }
  const [wsOpen, setWsOpen] = useState(false), [wide, setWide] = useState(false), [wsRepos, setWsRepos] = useState<GitCard['repos']>(), [openRepos, setOpenRepos] = useState<string[]>([])
  const [openSec, setOpenSec] =useState<Partial<Record<AgentPurpose, boolean>>>({})
  const startLabel: Record<'execution' | 'test', string> = { execution: 'Iniciar execução', test: 'Iniciar teste' }
  // Planejamento sempre aparece; execução e teste só depois de iniciados (antes disso é um botão que escolhe o agente e já começa).
  const section = (purpose: AgentPurpose, state: typeof planAgent): React.JSX.Element | null => {
    const chat = chatOf(purpose), profile = profiles.find((item) => item.id === state.config?.profileId)
    const chatButton = d.id && openChat && <button type="button" className="ibtn tip" data-tip={chat ? 'Abrir o chat desta etapa' : 'Abrir chat (ainda sem conversa)'} aria-label={`Abrir chat de ${stepTitle[purpose]}`} onClick={() => openChat(purpose)}><ChatIcon /></button>
    if (purpose !== 'planning' && !chat) {
      if (!d.id || !onStart) return null
      return <div className="sep"><div className="sechead"><span className="sectitle">{stepTitle[purpose]}</span></div><button type="button" className="mini startsec" onClick={() => onStart(purpose as 'execution' | 'test')}>{startLabel[purpose as 'execution' | 'test']}</button></div>
    }
    const expanded = openSec[purpose] ?? !d.id
    const model = state.options?.models.find((item) => item.id === state.config?.model)
    const preview = [profile?.label, model?.label ?? state.config?.model ?? 'Modelo padrão', state.config?.effort ? effortLabel[state.config.effort] : ''].filter(Boolean).join(' · ')
    return <div className={`sep secfold ${expanded ? 'open' : ''}`}><div className="sechead"><button type="button" className="foldbtn" aria-expanded={expanded} onClick={() => setOpenSec({ ...openSec, [purpose]: !expanded })}><span className="chev" aria-hidden="true">›</span><span className="sectitle">{stepTitle[purpose]}</span></button>{chatButton}</div>{!expanded && <button type="button" className="foldprev" onClick={() => setOpenSec({ ...openSec, [purpose]: true })}>{profile && <AgentIcon profile={profile} size="sm" tip={false} />}<span>{preview}</span></button>}{expanded && agentField(purpose, state)}</div>
  }
  // Worktree por repositório: só busca ao expandir o bloco (o estado de cada repositório custa uma consulta ao Git).
  useEffect(() => { if (wsOpen && d.id) void window.agentboard.invoke('git:card', { cardId: d.id }).then((git) => setWsRepos(git.repos)).catch(() => setWsRepos([])) }, [wsOpen, d.id])
  const text = texts[kind]
  return <div className="overlay full"><div className="modal wide" role="dialog" aria-label={d.id ? 'Editar card' : 'Novo card'}>
    <header><div><h2><input className="titlein" aria-label="Título" value={d.title} placeholder="Sem título" onChange={(e) => set({ ...d, title: e.target.value })} /></h2>{assessing && complexity && <AssessmentDialog card={complexity} close={() => setAssessing(false)} changed={() => { void window.agentboard.invoke('cards:get', { cardId: complexity.id }).then(setComplexity).catch(() => undefined) }} />}</div><div className="hdr-actions">{d.id && pending && (pending.changes > 0 || pending.questions > 0) && <button type="button" className="mini ask" onClick={onPending}>Autorizar mudanças ({pending.changes + pending.questions})</button>}{d.id && openChat && <button type="button" className="mini secondary openchat" onClick={() => openChat('planning')}><ChatIcon />Abrir chat</button>}<button type="button" className="x" onClick={close} aria-label="Fechar">×</button></div></header>
    <form onSubmit={(e) => void submit(e)} style={{ display: 'contents' }}>
      <div className={`editor docs ${small ? 'smallcard' : ''} ${wide ? 'wide' : ''}`}>
        <div className="stack pane-left" style={{ alignContent: 'start' }}>
          {complexity && <div className="cxtop"><ComplexityBadge full complexity={complexity.complexity} onClick={() => setAssessing(true)} /></div>}
          <div className="f"><span>Tipo</span><Select label="Tipo" options={types} value={d.type} onChange={(value) => set({ ...d, type: value as Card['type'] })} /></div>
          <div className="f"><span>Prioridade</span><Select label="Prioridade" options={priorities} value={d.priority} onChange={(value) => set({ ...d, priority: value as Card['priority'] })} /></div>
          {d.id && complexity && gitSources.length > 1 && !workspace && <RepoChooser card={complexity} sources={gitSources} changed={setComplexity} />}
          {!d.id && gitSources.length > 1 && <div className="f"><span>Repositório</span><Select label="Repositório" options={gitSources.map((source) => ({ value: source.id, label: source.name, sub: source.currentBranch ?? '' }))} value={d.sourceId ?? gitSources[0]!.id} onChange={(value) => set({ ...d, sourceId: value })} /></div>}
          {small && <p className="smallnote"><b>Tarefa pequena.</b> Um agente só implementa e valida, sem planejamento nem teste separados, para gastar menos tokens. Descreva ao lado o que fazer.</p>}
          {profiles.length > 0 && <>{!small && section('planning', planAgent)}{section('execution', execAgent)}{!small && section('test', testAgent)}</>}
          {d.id && small && <TokenUsage cardId={d.id} small />}
          {d.id && workspace && <div className="f"><span>Branch e worktree</span><div className="wsbox"><button type="button" className="wsfold" aria-expanded={wsOpen} onClick={() => setWsOpen(!wsOpen)}><BranchIcon /><b>{workspace.branch}</b><span className="chev" aria-hidden="true">›</span></button><div className="wsmeta"><small className="wsbase">base {workspace.baseRef}</small></div>{wsOpen && (wsRepos?.length ? <ul className="wsrepos">{wsRepos.map((repo) => { const shown = openRepos.includes(repo.sourceId), touched = repo.ahead > 0 || repo.files.length > 0
    return <li key={repo.sourceId} className={`wstree ${touched ? 'touched' : ''}`}>
      <button type="button" className="wstree-head" aria-expanded={shown} onClick={() => setOpenRepos(shown ? openRepos.filter((id) => id !== repo.sourceId) : [...openRepos, repo.sourceId])}>
        <TreeIcon /><b>{repo.name}</b>
        {repo.state !== 'active' && <small className="cx-warn">{repo.state === 'failed' ? 'falhou' : 'pasta sumiu'}</small>}
        {touched && <small className="wstree-n" title="O card mexeu neste repositório">{repo.ahead > 0 ? `${repo.ahead} commit${repo.ahead === 1 ? '' : 's'}` : ''}{repo.ahead > 0 && repo.files.length > 0 ? ' · ' : ''}{repo.files.length > 0 ? `${repo.files.length} sem commit` : ''}</small>}
        <span className="chev" aria-hidden="true">›</span></button>
      {shown && <div className="wstree-body"><small className="wstree-path" title={repo.worktreePath}>{repo.worktreePath}</small><small className="wsbase">base {repo.baseRef}</small></div>}
    </li> })}</ul> : <small title={workspace.path}>Worktree: {workspace.path}</small>)}</div></div>}
          {gitSources.length === 0 && <p className="hint">Este projeto não possui Git. O planejamento funciona normalmente; a execução com worktree exige um repositório.</p>}
        </div>
        <div className="stack pane-mid" style={{ minWidth: 0 }}>
          {testsView && checklist.trim() ? <><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="sectitle">Testes · feito pelo testador</span></div><div className="md descarea">{checklistData && <TestChecklist data={checklistData} />}</div></> : <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="sectitle">{small ? 'O que fazer' : labels[kind]} · {systemKinds.includes(kind) ? 'gerado pelo sistema' : 'Markdown'}</span>
            <div className="tabs">{d.id && !systemKinds.includes(kind) && <button type="button" className={`ibtn tip ${versions ? 'on' : ''}`} data-tip={versions ? 'Fechar o histórico' : 'Histórico de versões'} aria-label="Histórico de versões" aria-pressed={Boolean(versions)} onClick={() => (versions ? setVersions(undefined) : void showVersions())}><svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg></button>}
              <button type="button" className={`ibtn tip ${wide ? 'on' : ''}`} data-tip={wide ? 'Mostrar as colunas laterais' : 'Expandir (oculta as colunas laterais)'} aria-label={wide ? 'Recolher documento' : 'Expandir documento'} aria-pressed={wide} onClick={() => setWide(!wide)}>{wide ? <CollapseIcon /> : <ExpandIcon />}</button>
              {([['write', 'Escrever', <PencilIcon key="w" />], ['split', 'Dividido', <SplitIcon key="s" />], ['prev', 'Prévia', <EyeIcon key="p" />]] as const).map(([value, label, icon]) => <button type="button" key={value} className={`ibtn tip ${mode === value ? 'on' : ''}`} data-tip={label} aria-label={label} aria-pressed={mode === value} onClick={() => setMode(value)}>{icon}</button>)}</div></div>
          {/* Card existente abre em Prévia (melhor de ler); dois cliques no texto passam para Escrever. */}
          {versions ? <DocHistory title={labels[kind]} versions={versions} restore={(v) => { setTexts({ ...texts, [kind]: v.contentMd }); setVersions(undefined) }} /> : mode === 'prev' ? <div className="md descarea" title={systemKinds.includes(kind) ? undefined : 'Dois cliques para editar'} onDoubleClick={() => { if (!systemKinds.includes(kind)) setMode('write') }}>{text.trim() ? <Markdown source={text} onToggle={kind === 'tasks' || kind === 'plano' ? toggle : undefined} /> : <p className="hint">{loaded ? `${labels[kind]} ainda está vazio.${systemKinds.includes(kind) ? '' : ' Clique em Escrever (ou dois cliques aqui) para editar.'}` : 'Carregando…'}</p>}</div>
            : <div className={`descwrap ${mode === 'split' ? 'split' : ''}`}><CodeEditor key={kind} variant="prose" className="in descarea" path="documento.md" ariaLabel={`Documento ${labels[kind]}`} value={text} readOnly={!loaded || systemKinds.includes(kind)} extensions={placeholderFor(kind)} options={proseOptions} onChange={(value) => setTexts((all) => ({ ...all, [kind]: value }))} />{mode === 'split' && <div className="md descarea"><Markdown source={text} onToggle={kind === 'tasks' || kind === 'plano' ? toggle : undefined} /></div>}</div>}
</>}
        </div>
        {!small && <div className="stack pane-docs">
          <span className="sectitle">Documentos</span>
          {shownKinds.map((k) => { const value = texts[k], tasks = k === 'tasks' ? topLevel(value) : null, status = tasks ? (tasks.total ? `${tasks.done}/${tasks.total}` : 'vazio') : value.trim() ? 'escrito' : 'vazio'
            const ask = waiting(k)
            return <button type="button" key={k} className={`docbtn ${kind === k && !testsView ? 'on' : ''} ${value.trim() || ask ? '' : 'empty'} ${ask ? 'ask' : ''}`} title={ask ? 'Aguardando a sua autorização: clique para revisar' : undefined} onClick={() => { setTestsView(false); setKind(k); if (ask) onPending?.() }}><span className="dn">{labels[k]}{dirty(k) && <i className="dirtyDot" aria-label="alterado" />}</span><span className="ds">{ask ? <><span className="dot pulse" />{k === 'mudancas' ? (ask === 1 ? 'autorizar' : `${ask} para autorizar`) : (ask === 1 ? 'responder' : `${ask} para responder`)}</> : status}</span>{tasks && tasks.total > 0 && <span className="dprog"><i style={{ width: `${Math.round((tasks.done / tasks.total) * 100)}%` }} /></span>}</button> })}
          {checklist.trim() && <button type="button" className={`docbtn ${testsView ? 'on' : ''}`} onClick={() => setTestsView(true)}><span className="dn">Testes</span><span className="ds">{testItems ? `${testDone}/${testItems}` : 'escrito'}</span>{testItems > 0 && <span className="dprog"><i style={{ width: `${Math.round((testDone / testItems) * 100)}%` }} /></span>}</button>}
          {hiddenKinds.length > 0 && <div className="docadd">{addingDoc ? hiddenKinds.map((k) => <button type="button" key={k} className="mini secondary" onClick={() => { setAddingDoc(false); setKind(k); setMode('write') }}>{labels[k]}</button>)
            : <button type="button" className="mini secondary" onClick={() => setAddingDoc(true)}>+ Documento</button>}</div>}
          {d.id && <TokenUsage cardId={d.id} />}
        </div>}
      </div>
      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
      <div className="actions">{d.id && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={() => setConfirming(true)}>Excluir card</button>}{d.id && <label className="autosave tip" data-tip="Grava sozinho enquanto você edita"><input type="checkbox" role="switch" checked={auto} onChange={(e) => setAutoSave(e.target.checked)} /><span className="sw" aria-hidden="true" />Salvar automaticamente{auto && autoState && <small>{autoState === 'saving' ? 'Salvando…' : 'Salvo'}</small>}</label>}<button type="button" className="secondary" onClick={close}>Cancelar</button><button disabled={busy || !loaded || !d.title.trim()}>{busy ? 'Salvando…' : 'Salvar card'}</button></div>
    </form>
    {resetting && d.id && <ConfirmDialog eyebrow="Trocar agente" title="Reiniciar o chat desta etapa?" text="O chat já começou com este agente. Para trocar, as mensagens e as execuções deste chat são apagadas e ele recomeça do zero com o novo agente. Os documentos do card ficam como estão." ok="Reiniciar chat" danger cancel={() => setResetting(undefined)} confirm={() => { const purpose = resetting, chat = chatOf(purpose); setResetting(undefined); if (chat) void window.agentboard.invoke('chats:reset', { chatId: chat.id }).then(() => loadChats()).catch((reason: unknown) => setError(String(reason).replace(/^Error: /, ''))) }} />}
    {confirming && d.id && <ConfirmDialog eyebrow="Excluir card" title={d.title || 'Card'} text="O card, os documentos, os planos e o histórico de conversas dele serão removidos. Isso não pode ser desfeito." ok="Excluir" danger cancel={() => setConfirming(false)} confirm={() => void window.agentboard.invoke('cards:delete', { cardId: d.id! }).then(saved).catch((reason: unknown) => { setConfirming(false); setError(String(reason)) })} />}
  </div></div>
}
