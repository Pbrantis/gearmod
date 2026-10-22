import React, { useCallback, useEffect, useRef, useState } from 'react'
import { defaultPermissionMode, permissionModes, type AgentProfile, type AgentPurpose, type Card, type Chat, type ChatMessage, type Project, type ProjectBoard, type Run, type SkillEntry, type SkillRef } from '@agentboard/contracts'
import { AgentIcon } from './AgentIcon'
import { ConfirmDialog } from './ConfirmDialog'
import { CheckIcon, CloseIcon, CollapseIcon, ExpandIcon, MicIcon, SendIcon, StopIcon } from './icons'
import { ModelMenu, useAgentConfig } from './ModelMenu'
import { QualityPanel } from './QualityPanel'
import { useDictation } from './useDictation'

const stepLabel: Record<AgentPurpose, string> = { planning: 'Planejamento', execution: 'Implementação', test: 'Teste' }
const typeColor: Record<Card['type'], string> = { feature: '#8fb8d6', bug: '#ff9d91', improvement: 'var(--accent-strong)', task: '#98a099' }

function Tile({ card, board, here, profiles, open }: { card: Card; board: ProjectBoard; here: boolean; profiles: AgentProfile[]; open(): void }): React.JSX.Element {
  const run = card.run.state, agent = profiles.find((profile) => profile.id === (card.run.profileId ?? card.execProfileId))
  const state = board.columns.find((column) => column.id === card.columnId)
  const ready = run === 'idle' && card.hasPlan && (state?.semanticState === 'backlog' || state?.semanticState === 'todo')
  const status = card.planningOpen ? <><span className="dot" style={{ color: '#b9b9f0' }} /><small>Em planejamento</small></> : run === 'running' ? <><span className="spin sm" /><small>Executando</small></> : run === 'planning' ? <><span className="dot pulse" style={{ color: '#b9b9f0' }} /><small>Planejando</small></> : ready ? <><span className="dot" style={{ color: 'var(--accent-strong)' }} /><small>Plano pronto</small></> : run === 'finished' ? <><span className="dot pulse" style={{ color: 'var(--accent)' }} /><small>Terminou</small></> : run === 'paused' ? <small style={{ color: 'var(--warn)' }}>Pausado</small> : <small>{state?.label}</small>
  return <button type="button" className={`tile ${run === 'running' ? 'run' : ''} ${run === 'planning' ? 'plan' : ''} ${here ? 'here' : ''}`} onClick={open}><span className="tdot" style={{ background: typeColor[card.type] }} /><span className="ttl">{card.title || 'Novo card'}</span><span className="tfoot">{agent ? <AgentIcon profile={agent} size="sm" /> : <i />}<span className="tst">{status}</span></span></button>
}

/** Visão rápida (protótipo): o que está executando agora e os demais cards, com o estado de cada um. */
function Activity({ board, cardId, profiles, openEdit }: { board: ProjectBoard; cardId: string; profiles: AgentProfile[]; openEdit(card: Card): void }): React.JSX.Element {
  const cards = board.cards.filter((card) => !card.archivedAt), running = cards.filter((card) => card.run.state === 'running')
  const rank = (card: Card): number => card.id === cardId ? 0 : card.run.state === 'finished' ? 0.5 : card.run.state === 'planning' ? 1 : card.hasPlan && card.run.state === 'idle' ? 2 : 3 + board.columns.findIndex((column) => column.id === card.columnId)
  const rest = cards.filter((card) => card.run.state !== 'running').sort((a, b) => rank(a) - rank(b))
  return <section className="activity"><div className="eyebrow">Visão rápida</div>
    <div className="agrp"><span>Executando</span><b>{running.length}</b></div>
    <div className="tilecol">{running.length ? running.map((card) => <Tile key={card.id} card={card} board={board} here={card.id === cardId} profiles={profiles} open={() => openEdit(card)} />) : <div className="emptyact">Nada executando agora.</div>}</div>
    <div className="agrp"><span>Demais cards</span><b>{rest.length}</b></div>
    <div className="tilecol">{rest.map((card) => <Tile key={card.id} card={card} board={board} here={card.id === cardId} profiles={profiles} open={() => openEdit(card)} />)}</div>
  </section>
}

/** Chat do card (planejamento ou execução) como o dock do protótipo: encaixado à direita ou em tela cheia com a visão rápida. */
export function CardChat({ project, card, board, profiles, columnLabel, mode, close, openEdit, onSwitch }: { project: Project; card: Card; board: ProjectBoard; profiles: AgentProfile[]; columnLabel: string; mode: AgentPurpose; close(): void; openEdit(card: Card): void; onSwitch(purpose: AgentPurpose): void }): React.JSX.Element {
  const usable = profiles.filter((profile) => project.allowedProfileIds.includes(profile.id))
  const [chat, setChat] = useState<Chat>(), [messages, setMessages] = useState<ChatMessage[]>([]), [run, setRun] = useState<Run>(), [live, setLive] = useState('')
  const [input, setInput] = useState(''), [expanded, setExpanded] = useState(true), [error, setError] = useState(''), [skills, setSkills] = useState<SkillEntry[]>([]), [skill, setSkill] = useState<SkillRef | null>(null)
  const [menu, setMenu] = useState<'mode' | 'skill' | null>(null), [quality, setQuality] = useState(false), [voiceSetup, setVoiceSetup] = useState(false)
  const log = useRef<HTMLDivElement>(null), runId = useRef<string | undefined>(undefined), wrap = useRef<HTMLDivElement>(null)
  const planning = mode === 'planning'
  const [switchTo, setSwitchTo] = useState<AgentProfile>(), [chats, setChats] = useState<Chat[]>([])
  const agentState = useAgentConfig(card.id, mode, usable, chat?.profileId)
  const dictation = useDictation(useCallback((text: string) => setInput((value) => `${value}${value && !/\s$/.test(value) ? ' ' : ''}${text}`), []), card.title || undefined)
  const voiceReady = Boolean(dictation.status?.modelInstalled && dictation.status.engineInstalled)
  const loadMessages = useCallback(async (chatId: string) => setMessages(await window.agentboard.invoke('messages:list', { chatId })), [])
  useEffect(() => { void window.agentboard.invoke('cards:mark-viewed', { cardId: card.id }).catch(() => undefined) }, [card.id])
  useEffect(() => { void window.agentboard.invoke('chats:list', { projectId: project.id, cardId: card.id }).then((items) => { setChats(items); const found = items.find((item) => item.purpose === mode); if (found) { setChat(found); void loadMessages(found.id) } }).catch((reason: unknown) => setError(String(reason))) }, [project.id, card.id, mode, loadMessages])
  useEffect(() => window.agentboard.onRunEvent((event) => {
    if (event.runId !== runId.current) return
    if (event.eventType === 'item/agentMessage/delta') setLive((value) => value + String(event.payload.delta ?? ''))
    if (event.eventType === 'agentboard/run-completed') { runId.current = undefined; setRun(undefined); setLive(''); setChat((current) => { if (current) void loadMessages(current.id); return current }); void window.agentboard.invoke('cards:mark-viewed', { cardId: card.id }).catch(() => undefined) }
  }), [card.id, loadMessages])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [messages, live])
  useEffect(() => { void Promise.all([window.agentboard.invoke('skills:list', { scope: 'global' }), window.agentboard.invoke('skills:list', { scope: 'project', projectId: project.id })]).then(([global, local]) => setSkills([...local, ...global])).catch(() => undefined) }, [project.id])
  useEffect(() => { setSkill(chat?.skill ?? null) }, [chat?.id, chat?.skill])
  useEffect(() => {
    if (!menu) return
    const close = (event: Event): void => { if (!wrap.current?.contains(event.target as Node)) setMenu(null) }
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const provider = usable.find((item) => item.id === (agentState.config?.profileId ?? chat?.profileId))?.provider
  const available = skills.filter((item) => provider && item.paths[provider])
  const chooseSkill = async (next: SkillRef | null): Promise<void> => { setMenu(null); try { setError(''); if (chat) setChat(await window.agentboard.invoke('chats:set-skill', { chatId: chat.id, skill: next })); setSkill(next) } catch (reason) { setError(String(reason)) } }
  const send = async (): Promise<void> => {
    const prompt = input.trim(); if (!prompt || run) return
    try {
      setError(''); setInput('')
      let current = chat
      const chosen = agentState.config?.profileId
      if (!current) { if (!chosen) throw new Error('Escolha um agente'); current = await window.agentboard.invoke('chats:create', { projectId: project.id, cardId: card.id, purpose: mode, profileId: chosen, skill }); setChat(current) }
      const started = await window.agentboard.invoke('agents:start', { chatId: current.id, prompt, planning })
      runId.current = started.id; setRun(started); setLive(''); await loadMessages(current.id)
    } catch (reason) { setError(String(reason).replace(/^Error: /, '')); setInput(prompt) }
  }
  const stop = async (): Promise<void> => { if (run) await window.agentboard.invoke('agents:cancel', { runId: run.id }).catch((reason: unknown) => setError(String(reason))) }
  const resetAndSwitch = async (target: AgentProfile): Promise<void> => {
    setSwitchTo(undefined)
    try {
      setError('')
      if (chat) { await window.agentboard.invoke('chats:reset', { chatId: chat.id }); setChat(undefined); setMessages([]); setSkill(null) }
      await agentState.update({ profileId: target.id, model: null, effort: null, mode: defaultPermissionMode(target.provider, mode) })
      setChats(await window.agentboard.invoke('chats:list', { projectId: project.id, cardId: card.id }))
    } catch (reason) { setError(String(reason).replace(/^Error: /, '')) }
  }
  const busy = Boolean(run) || ((card.run.state === 'running' || card.run.state === 'planning') && card.run.purpose === mode)
  const execModes = provider ? permissionModes[provider].filter((item) => item.purposes.includes('execution')) : []
  const currentMode = execModes.find((item) => item.id === agentState.config?.mode)
  const testing = mode === 'test', eyebrow = planning ? 'Planejando card' : card.run.state === 'running' || run ? (testing ? 'Testando' : 'Executando') : card.run.state === 'paused' ? 'Pausado' : testing ? 'Teste' : 'Implementação'

  return <section className={`dock open ${expanded ? 'full' : ''}`} aria-label="Chat do card">
    <div className="dock-in">
      <div className="dock-head"><div className="top"><div><div className="eyebrow">{eyebrow}</div><h2>{card.title || 'Novo card'}</h2><div className="ctxline"><span className="ctxchip">{columnLabel}</span></div>
          <div className="tabs stepTabs" role="tablist" aria-label="Chats do card">{(['planning', 'execution', 'test'] as const).map((step) => { const has = chats.some((item) => item.purpose === step), working = card.run.purpose === step && (card.run.state === 'running' || card.run.state === 'planning'); return <button key={step} role="tab" aria-selected={mode === step} className={`tab ${mode === step ? 'on' : ''}`} onClick={() => step !== mode && onSwitch(step)}>{stepLabel[step]}{working ? <span className="spin sm" /> : has ? <span className="agdot" /> : null}</button> })}</div></div>
        <div className="dock-tools"><button type="button" className="ibtn tip" data-tip={expanded ? 'Voltar para o canto' : 'Expandir em tela cheia'} aria-label={expanded ? 'Voltar para o canto' : 'Expandir em tela cheia'} onClick={() => setExpanded(!expanded)}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button><button className="x" aria-label="Fechar chat" onClick={close}><CloseIcon /></button></div></div></div>
      <div className="chatlog" ref={log}>
        {!messages.length && !live && <div className="msg sys">{planning ? 'Skill de planejamento carregada. Este chat só planeja, não altera arquivos.' : testing ? 'Chat de teste do card. Use Testar no card ou escreva o que o agente deve conferir.' : 'Chat de implementação do card. Use Iniciar no card ou escreva uma instrução.'}</div>}
        {messages.map((m) => <div className={`msg ${m.role === 'assistant' ? 'agent' : m.role === 'system' ? 'sys' : m.role}`} key={m.id}>{m.role === 'system' && m.status === 'failed' ? '⚠ ' : ''}{m.body}</div>)}
        {live && <div className="msg agent">{live}</div>}
        {busy && !live && <div className="msg agent typing" aria-label="O agente está escrevendo"><i /><i /><i /></div>}
      </div>
      <div className="composer" ref={wrap}>
        {(error || dictation.error) && <p className="error">{error || dictation.error}</p>}
        {voiceSetup && !voiceReady && dictation.status && <div className="convbox"><p>O ditado por voz roda no seu computador, sem gastar token. Falta baixar {!dictation.status.engineInstalled ? (dictation.status.canInstallEngine ? 'o programa de transcrição e ' : 'o programa de transcrição (whisper-cli no PATH) e ') : ''}o modelo ({dictation.status.sizeMb} MB), só uma vez.</p><div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setVoiceSetup(false)}>Agora não</button><button type="button" disabled={Boolean(dictation.progress) || (!dictation.status.engineInstalled && !dictation.status.canInstallEngine)} onClick={() => void dictation.install().then(() => setVoiceSetup(false))}>{dictation.progress || 'Baixar'}</button></div></div>}
        {!planning && <><button type="button" className="expand" aria-expanded={quality} onClick={() => setQuality(!quality)}>Worktree, teste e revisão {quality ? '▴' : '▾'}</button>{quality && <QualityPanel cardId={card.id} />}</>}
        <div className="cbox">
          <textarea rows={1} aria-label="Mensagem para o agente" value={input} placeholder={dictation.recording ? 'Ouvindo…' : planning ? 'Descreva o que você quer planejar…' : testing ? 'Diga o que o agente deve testar…' : 'Envie uma instrução ao agente…'} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} />
          {dictation.recording && <span className="wave"><i /><i /><i /><i /><i /><i /><i /></span>}
          {busy ? <button type="button" className="sendbtn stop tip" data-tip="Parar" aria-label="Parar" onClick={() => void stop()}><StopIcon /></button> : <button type="button" className="sendbtn tip" data-tip="Enviar (Enter)" aria-label="Enviar" hidden={!input.trim()} onClick={() => void send()}><SendIcon /></button>}
          <button type="button" className={`micbtn tip ${dictation.recording ? 'on' : ''}`} data-tip={dictation.recording ? 'Parar de ouvir' : dictation.transcribing ? 'Transcrevendo…' : 'Ditar por voz'} aria-label="Ditar por voz" aria-pressed={dictation.recording} disabled={dictation.transcribing || !dictation.status} onClick={() => (voiceReady ? void dictation.toggle() : setVoiceSetup(true))}>{dictation.transcribing ? <span className="spin sm" /> : <MicIcon />}</button>
        </div>
        <div className="cmeta">
          {planning ? <><span className="mode tip" data-tip="Este chat não altera arquivos">✦ Só planejar</span>
            <span className="modewrap"><button type="button" className={`skillchip ${menu === 'skill' ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={menu === 'skill'} title="Skill de planejamento" onClick={() => setMenu(menu === 'skill' ? null : 'skill')}>{skill?.name ?? 'Planejamento SDD'}</button>
              {menu === 'skill' && <div className="modemenu skillmenu" role="menu"><div className="mm-title">Skill de planejamento</div>
                <button type="button" role="menuitem" className="modeopt" onClick={() => void chooseSkill(null)}><span className="mo-t"><b>Planejamento SDD</b><em>Padrão</em><small>Sistema</small></span><span className="mo-r">{!skill && <CheckIcon />}</span></button>
                {available.map((item) => { const path = provider ? item.paths[provider]! : ''; return <button type="button" role="menuitem" key={item.id} className="modeopt" onClick={() => void chooseSkill({ name: item.name, path })}><span className="mo-t"><b>{item.name}</b><small>{item.scope === 'project' ? 'Do projeto' : 'Global'}</small></span><span className="mo-r">{skill?.path === path && <CheckIcon />}</span></button> })}</div>}</span></>
            : <span className="modewrap"><button type="button" className={`modechip ${menu === 'mode' ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={menu === 'mode'} onClick={() => setMenu(menu === 'mode' ? null : 'mode')}>{currentMode?.label ?? 'Modo'}</button>
              {menu === 'mode' && <div className="modemenu" role="menu"><div className="mm-title">Modo</div>{execModes.map((item, index) => <button type="button" role="menuitem" key={item.id} disabled={item.needsApprovalUi} title={item.needsApprovalUi ? 'Precisa da tela de aprovação (em breve)' : undefined} className="modeopt" onClick={() => { setMenu(null); void agentState.update({ mode: item.id }) }}><span className="mo-t"><b>{item.label}</b>{item.recommended && <em>Recomendado</em>}<small>{item.description}</small></span><span className="mo-r">{agentState.config?.mode === item.id ? <CheckIcon /> : index + 1}</span></button>)}</div>}</span>}
          <div className="pick"><ModelMenu profiles={usable} purpose={mode} state={agentState} lockProfile={Boolean(chat)} onLockedPick={setSwitchTo} /></div>
        </div>
      </div>
    </div>
    {switchTo && <ConfirmDialog eyebrow="Trocar agente" title={`Reiniciar o chat com ${switchTo.label}?`} text="Este chat já começou com outro agente. Trocar apaga as mensagens e as execuções deste chat e ele recomeça do zero com o novo agente. Os documentos do card ficam como estão." ok="Trocar e reiniciar" danger cancel={() => setSwitchTo(undefined)} confirm={() => void resetAndSwitch(switchTo)} />}
    {expanded && <Activity board={board} cardId={card.id} profiles={profiles} openEdit={openEdit} />}
  </section>
}
