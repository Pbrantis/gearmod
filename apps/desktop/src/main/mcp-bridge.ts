import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CardDocumentKind, ChatPurpose } from '@agentboard/contracts'
import { cardDocumentKinds, systemDocumentKinds } from '@agentboard/contracts'
import type { AgentContextService } from './agent-context'
import type { CollaborationService } from './collaboration'
import type { ConstitutionRepository } from './constitution'
import type { ChecklistRepository } from './checklists'
import type { ConversationRepository } from './conversations'
import type { BoardRepository } from './projects'
import type { GitManager } from './git-manager'
import type { CardHistoryService } from './history'
import { assessmentTriggerSchema, complexityDimensions, decisionKindSchema, dimensionScoresSchema, evidenceSchema, levelLabels, workflowKindSchema, workflowLabels, type Evidence, type WorkflowKind } from '@agentboard/contracts'

export interface McpEndpoint { command: string; args: string[]; env: Record<string, string> }
export type CardChange = { type: 'document'; kind: CardDocumentKind } | { type: 'task' } | { type: 'moved'; column: string } | { type: 'card' } | { type: 'converted'; cardId: string; chatId: string } | { type: 'constitution' } | { type: 'checklist' } | { type: 'commit' }
interface RunState { runId: string; cardId: string | null; chatId: string; purpose: ChatPurpose; written: Set<CardDocumentKind>; pendingMove: string | null; notify(change: CardChange): void }
export interface RunReport { written: CardDocumentKind[]; pendingMove: string | null }
type Reply = { ok: true; text: string } | { ok: false; error: string }

const historyTools = new Set(['agentboard_avaliar_complexidade', 'agentboard_escolher_fluxo', 'agentboard_registrar_decisao', 'agentboard_registrar_entendimento', 'agentboard_registrar_exploracao'])
/** O que o planejador faz depois de cada fluxo escolhido. */
const workflowNext: Record<WorkflowKind, string> = {
  light: 'O card virou tarefa pequena: escreva a descrição do que fazer com agentboard_atualizar_card e chame agentboard_concluir_planejamento.',
  spec: 'Siga a skill agentboard-planejamento: Especificação objetiva, Plano e Tasks; depois agentboard_concluir_planejamento.',
  sdd: 'Siga o método configurado do projeto (vem no contexto em "metodo") e grave Especificação, Plano e Tasks no card; depois agentboard_concluir_planejamento.'
}

/** Fluxo curto reaproveita a tarefa pequena (minor) que já existe; sair dele volta o card para task. */
export function applyWorkflowType(board: BoardRepository, cardId: string, workflow: WorkflowKind): void {
  const card = board.card(cardId), type = workflow === 'light' ? 'minor' : card.type === 'minor' ? 'task' : card.type
  if (type === card.type || !card.title.trim()) return
  board.update({ cardId, type, title: card.title, description: card.description, priority: card.priority, acceptanceCriteria: card.acceptanceCriteria.map(({ body, checked }) => ({ body, checked })) })
}

const normalize = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Canal local entre o servidor MCP (processo filho do agente) e o app. Usa socket Unix / named pipe, nunca porta de rede,
 * e cada execução tem um token próprio, válido só enquanto ela roda. Toda escrita passa pelas mesmas validações do IPC.
 */
export class McpBridge {
  private server?: Server
  private readonly runs = new Map<string, RunState>()
  private readonly dir: string
  readonly socketPath: string

  constructor(private readonly deps: { board: BoardRepository; context: Pick<AgentContextService, 'block'>; serverScript: string; runtime?: string; collab?: CollaborationService; conversations?: Pick<ConversationRepository, 'projectOf' | 'convertToPlanning'>; constitution?: Pick<ConstitutionRepository, 'get' | 'write' | 'propose'>; checklists?: Pick<ChecklistRepository, 'write'>; git?: Pick<GitManager, 'agentCommit'>; history?: CardHistoryService; planReady?: (cardId: string) => { notices: string[] }; prepareWorktree?: (cardId: string) => Promise<unknown>; repositories?: (cardId: string) => Array<{ path: string; status: string }> }) {
    const id = randomBytes(6).toString('hex')
    this.dir = join(tmpdir(), `agentboard-${id}`)
    this.socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\agentboard-${id}` : join(this.dir, 'mcp.sock')
  }

  async listen(): Promise<void> {
    if (process.platform !== 'win32') { mkdirSync(this.dir, { recursive: true, mode: 0o700 }); chmodSync(this.dir, 0o700) }
    this.server = createServer((socket) => {
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        const end = buffer.indexOf('\n'); if (end < 0) return
        const answer = (reply: Reply): void => { socket.end(`${JSON.stringify(reply)}
`) }
        const fail = (error: unknown): void => answer({ ok: false, error: error instanceof Error ? error.message : String(error) })
        try { const request = JSON.parse(buffer.slice(0, end)) as { token?: string; tool?: string; args?: Record<string, unknown> }; Promise.resolve(this.handle(request.token ?? '', request.tool ?? '', request.args ?? {})).then(answer, fail) }
        catch (error) { fail(error) }
      })
      socket.on('error', () => undefined)
    })
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.socketPath, resolve) })
    if (process.platform !== 'win32') chmodSync(this.socketPath, 0o600)
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server ? this.server.close(() => resolve()) : resolve())
    if (process.platform !== 'win32') rmSync(this.dir, { recursive: true, force: true })
  }

  register(runId: string, cardId: string | null, notify: (change: CardChange) => void, chat: { id: string; purpose: ChatPurpose } = { id: '', purpose: 'execution' }): McpEndpoint {
    const token = randomBytes(24).toString('hex')
    this.runs.set(token, { runId, cardId, chatId: chat.id, purpose: chat.purpose, written: new Set(), pendingMove: null, notify })
    return { command: this.deps.runtime ?? process.execPath, args: [this.deps.serverScript], env: { ELECTRON_RUN_AS_NODE: '1', AGENTBOARD_SOCKET: this.socketPath, AGENTBOARD_TOKEN: token } }
  }

  finish(runId: string): RunReport {
    for (const [token, state] of this.runs) {
      if (state.runId !== runId) continue
      this.runs.delete(token)
      return { written: [...state.written], pendingMove: state.pendingMove }
    }
    return { written: [], pendingMove: null }
  }

  private handle(token: string, tool: string, args: Record<string, unknown>): Reply | Promise<Reply> {
    const run = this.runs.get(token)
    if (!run) return { ok: false, error: 'Execução desconhecida ou já encerrada.' }
    const { board, context } = this.deps
    try {
      if (tool === 'agentboard_criar_card') {
        if (run.purpose !== 'free' || run.cardId) return { ok: false, error: 'Esta conversa já tem card.' }
        if (!this.deps.conversations) return { ok: false, error: 'O chat livre não está disponível' }
        const title = args.titulo, type = args.tipo ?? 'task', priority = args.prioridade ?? 'medium', summary = args.resumo ?? ''
        if (typeof title !== 'string' || !title.trim() || title.length > 240) return { ok: false, error: 'titulo deve ser um texto de 1 a 240 caracteres' }
        if (!['feature', 'bug', 'improvement', 'task', 'minor'].includes(String(type))) return { ok: false, error: 'tipo deve ser feature, bug, improvement, task ou minor' }
        if (!['low', 'medium', 'high', 'urgent'].includes(String(priority))) return { ok: false, error: 'prioridade deve ser low, medium, high ou urgent' }
        if (typeof summary !== 'string') return { ok: false, error: 'resumo deve ser um texto' }
        const projectId = this.deps.conversations.projectOf(run.chatId), columns = board.get(projectId).columns
        const column = columns.find((item) => item.semanticState === 'backlog') ?? columns[0]
        if (!column) return { ok: false, error: 'O projeto não tem colunas' }
        const card = board.create({ projectId, columnId: column.id, type: String(type), title: title.trim(), description: summary, priority: String(priority), acceptanceCriteria: [] })
        this.deps.conversations.convertToPlanning(run.chatId, card.id)
        run.cardId = card.id; run.purpose = 'planning'
        run.notify({ type: 'converted', cardId: card.id, chatId: run.chatId })
        return { ok: true, text: `Card "${card.title}" criado no ${column.label}. Este chat agora é o chat de planejamento dele: siga a skill agentboard-planejamento, grave Especificação, Plano e Tasks com agentboard_escrever_documento e chame agentboard_concluir_planejamento quando terminar.` }
      }
      if (tool === 'agentboard_ler_constituicao' || tool === 'agentboard_escrever_constituicao' || tool === 'agentboard_propor_constituicao') return this.constitution(run, tool, args)
      if (!run.cardId) return { ok: false, error: 'Esta conversa ainda não tem card. Se o usuário pedir para planejar algo, chame agentboard_criar_card primeiro.' }
      if (tool === 'agentboard_pedir_commit') return this.requestCommit(run, args)
      if (historyTools.has(tool)) return this.history(run, tool, args)
      if (tool === 'agentboard_definir_repositorios') return this.setRepositories(run, args)
      if (tool === 'agentboard_contexto_do_card') return { ok: true, text: context.block(run.cardId) }
      if (tool === 'agentboard_escrever_documento') {
        const kind = args.tipo, markdown = args.markdown
        if (typeof kind !== 'string' || !(cardDocumentKinds as readonly string[]).includes(kind) || (systemDocumentKinds as readonly string[]).includes(kind)) return { ok: false, error: `tipo deve ser um destes: ${cardDocumentKinds.filter((item) => !(systemDocumentKinds as readonly string[]).includes(item)).join(', ')}` }
        if (typeof markdown !== 'string' || markdown.length > 200_000) return { ok: false, error: 'markdown deve ser um texto de até 200.000 caracteres' }
        board.documents.write(run.cardId, kind as CardDocumentKind, markdown, 'agent')
        run.written.add(kind as CardDocumentKind); run.notify({ type: 'document', kind: kind as CardDocumentKind })
        return { ok: true, text: `Documento ${kind} gravado.` }
      }
      if (tool === 'agentboard_checklist_teste') {
        if (run.purpose !== 'test') return { ok: false, error: 'Esta ferramenta é do testador.' }
        if (!this.deps.checklists) return { ok: false, error: 'O checklist do teste não está disponível' }
        if (typeof args.markdown !== 'string' || args.markdown.length > 50_000) return { ok: false, error: 'markdown deve ser o checklist completo (até 50.000 caracteres)' }
        this.deps.checklists.write(run.cardId, args.markdown); run.notify({ type: 'checklist' })
        return { ok: true, text: 'Checklist do teste gravado.' }
      }
      if (tool === 'agentboard_concluir_planejamento') {
        if (run.purpose !== 'planning') return { ok: false, error: 'Esta ferramenta é do planejador.' }
        const missing = board.markPlanReady(run.cardId)
        if (missing.length) return { ok: false, error: `Ainda faltam documentos escritos: ${missing.join(', ')}. Grave-os e chame de novo.` }
        run.notify({ type: 'card' })
        // Artefatos do plano (pasta do card e, no fluxo SDD, a pasta central do método) são gravados pelo app, nunca pelo planejador.
        let notices: string[] = []; try { notices = this.deps.planReady?.(run.cardId).notices ?? [] } catch (error) { notices = [error instanceof Error ? error.message : String(error)] }
        return { ok: true, text: `Planejamento concluído; o card agora aparece como "Plano pronto".${notices.length ? ` Avisos: ${notices.join(' ')}` : ''}` }
      }
      if (tool === 'agentboard_marcar_task') {
        if (!Number.isInteger(args.linha) || (args.linha as number) < 1 || typeof args.feito !== 'boolean') return { ok: false, error: 'linha deve ser um inteiro a partir de 1 e feito um booleano' }
        board.documents.setTask(run.cardId, (args.linha as number) - 1, args.feito, 'agent'); run.notify({ type: 'task' })
        return { ok: true, text: `Linha ${String(args.linha)} ${args.feito ? 'marcada' : 'desmarcada'}.` }
      }
      if (tool === 'agentboard_atualizar_card') {
        const current = board.card(run.cardId)
        const title = args.titulo === undefined ? current.title : args.titulo, type = args.tipo === undefined ? current.type : args.tipo, priority = args.prioridade === undefined ? current.priority : args.prioridade
        if (typeof title !== 'string' || !title.trim() || title.length > 240) return { ok: false, error: 'titulo deve ser um texto de 1 a 240 caracteres' }
        if (!['feature', 'bug', 'improvement', 'task', 'minor'].includes(String(type))) return { ok: false, error: 'tipo deve ser feature, bug, improvement, task ou minor' }
        if (!['low', 'medium', 'high', 'urgent'].includes(String(priority))) return { ok: false, error: 'prioridade deve ser low, medium, high ou urgent' }
        if (args.descricao !== undefined && (typeof args.descricao !== 'string' || args.descricao.length > 20_000)) return { ok: false, error: 'descricao deve ser um texto de até 20.000 caracteres' }
        board.update({ cardId: run.cardId, type: String(type), title: title.trim(), description: typeof args.descricao === 'string' ? args.descricao.trim() : current.description, priority: String(priority), acceptanceCriteria: current.acceptanceCriteria.map(({ body, checked }) => ({ body, checked })) })
        run.notify({ type: 'card' })
        return { ok: true, text: `Card atualizado: ${title.trim()} (${String(type)}, ${String(priority)}).` }
      }
      if (tool === 'agentboard_propor_mudanca' || tool === 'agentboard_perguntar_ao_planejador') {
        if (!this.deps.collab) return { ok: false, error: 'A colaboração entre etapas não está disponível' }
        if (run.purpose !== 'execution' && run.purpose !== 'test') return { ok: false, error: 'Esta ferramenta é do desenvolvedor e do testador; o planejador altera os documentos direto.' }
        if (tool === 'agentboard_perguntar_ao_planejador') {
          if (typeof args.pergunta !== 'string' || !args.pergunta.trim()) return { ok: false, error: 'informe a pergunta' }
          const question = this.deps.collab.askQuestion({ cardId: run.cardId, chatId: run.chatId, purpose: run.purpose, question: args.pergunta })
          run.notify({ type: 'card' })
          return { ok: true, text: `Dúvida D${String(question.number).padStart(3, '0')} registrada. Continue só com o que não depende dela e TERMINE esta execução: o app leva a dúvida ao planejador e te retoma com a resposta.` }
        }
        if (![args.titulo, args.o_que_muda, args.motivo].every((value) => typeof value === 'string' && value.trim())) return { ok: false, error: 'informe titulo, o_que_muda e motivo' }
        const change = this.deps.collab.proposeChange({ cardId: run.cardId, chatId: run.chatId, purpose: run.purpose, title: args.titulo as string, details: args.o_que_muda as string, reason: args.motivo as string })
        run.notify({ type: 'card' })
        return { ok: true, text: `Proposta M${String(change.number).padStart(3, '0')} registrada e aguardando a autorização do usuário. NÃO implemente essa mudança. Continue só com o que está nos documentos e termine esta execução; o app te retoma quando houver decisão.` }
      }
      if (tool === 'agentboard_responder_duvida' || tool === 'agentboard_pedir_ao_usuario') {
        if (!this.deps.collab) return { ok: false, error: 'A colaboração entre etapas não está disponível' }
        if (run.purpose !== 'planning') return { ok: false, error: 'Esta ferramenta é do planejador.' }
        if (!Number.isInteger(args.numero) || typeof (tool === 'agentboard_responder_duvida' ? args.resposta : args.pergunta) !== 'string') return { ok: false, error: 'informe numero (inteiro) e ' + (tool === 'agentboard_responder_duvida' ? 'resposta' : 'pergunta') }
        if (tool === 'agentboard_responder_duvida') this.deps.collab.answerFromPlanner(run.cardId, args.numero as number, args.resposta as string)
        else this.deps.collab.escalateToUser(run.cardId, args.numero as number, args.pergunta as string)
        run.notify({ type: 'card' })
        return { ok: true, text: tool === 'agentboard_responder_duvida' ? `Dúvida ${String(args.numero)} respondida; o app devolve a resposta a quem perguntou.` : `Dúvida ${String(args.numero)} enviada ao usuário; o app retoma quem perguntou quando ele responder.` }
      }
      if (tool === 'agentboard_mover_card') {
        if (typeof args.coluna !== 'string' || (args.quando !== 'agora' && args.quando !== 'ao_terminar')) return { ok: false, error: 'informe coluna e quando ("agora" ou "ao_terminar")' }
        const column = this.findColumn(run.cardId, args.coluna)
        if (!column) return { ok: false, error: `Coluna não encontrada: ${args.coluna}` }
        if (args.quando === 'ao_terminar') { run.pendingMove = column.id; return { ok: true, text: `O card vai para ${column.label} quando esta execução terminar.` } }
        board.move(run.cardId, column.id, null, 'agent'); run.notify({ type: 'moved', column: column.label })
        return { ok: true, text: `Card movido para ${column.label}.` }
      }
      return { ok: false, error: `Ferramenta desconhecida: ${tool}` }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  }

  /** Repositórios do card: só eles ganham worktree. Na execução, o repositório novo é preparado na hora (os outros continuam como estão). */
  private async setRepositories(run: RunState, args: Record<string, unknown>): Promise<Reply> {
    if (!run.cardId) return { ok: false, error: 'Esta conversa ainda não tem card.' }
    if (!Array.isArray(args.repositorios) || args.repositorios.some((item) => typeof item !== 'string')) return { ok: false, error: 'repositorios deve ser uma lista de nomes' }
    const { board } = this.deps, card = board.card(run.cardId)
    const sources = board.get(card.projectId).project.sources.filter((source) => source.isGitRepository)
    const names = (args.repositorios as string[]).map((name) => name.trim()).filter(Boolean)
    const chosen = names.map((name) => sources.find((source) => normalize(source.name) === normalize(name)))
    const missing = names.filter((_, index) => !chosen[index])
    if (missing.length) return { ok: false, error: `Repositório desconhecido: ${missing.join(', ')}. Disponíveis: ${sources.map((source) => source.name).join(', ')}` }
    board.setRepos(run.cardId, chosen.length ? chosen.map((source) => source!.id) : null)
    try { this.deps.history?.decide(run.cardId, { kind: 'scope', statement: `Repositórios do card: ${chosen.length ? chosen.map((source) => source!.name).join(', ') : 'todos'}`, rationale: typeof args.motivo === 'string' ? args.motivo : '', actor: 'agent', source: { actor: 'agent', runId: run.runId, chatId: run.chatId } }) } catch { /* decisão é registro, não bloqueia */ }
    let prepared = ''
    if (run.purpose === 'execution' || run.purpose === 'test') {
      const worktree = await this.deps.prepareWorktree?.(run.cardId).catch((error: unknown) => { prepared = ` Não foi possível preparar: ${error instanceof Error ? error.message : String(error)}`; return null })
      if (worktree) prepared = ` Worktree atualizada; pastas: ${(this.deps.repositories?.(run.cardId) ?? []).map((repo) => `${repo.path} (${repo.status})`).join(', ')}.`
    }
    run.notify({ type: 'card' })
    return { ok: true, text: `O card trabalha em: ${chosen.length ? chosen.map((source) => source!.name).join(', ') : 'todos os repositórios'}.${prepared}` }
  }

  /** Complexity Engine, decisões, entendimento e exploração: tudo vira evento versionado do card (docs/09). */
  private history(run: RunState, tool: string, args: Record<string, unknown>): Reply {
    const history = this.deps.history
    const cardId = run.cardId
    if (!cardId) return { ok: false, error: 'Esta conversa ainda não tem card.' }
    if (!history) return { ok: false, error: 'O histórico do card não está disponível' }
    const source = { actor: 'agent' as const, runId: run.runId, chatId: run.chatId }
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : []
    const evidence = (value: unknown): Evidence[] => (Array.isArray(value) ? value : []).map((item: Record<string, unknown>) => evidenceSchema.parse({ kind: item?.tipo, ref: item?.referencia, detail: typeof item?.detalhe === 'string' ? item.detalhe : '', line: Number.isInteger(item?.linha) ? item.linha : null, commit: typeof item?.commit === 'string' ? item.commit : null }))
    try {
      if (tool === 'agentboard_avaliar_complexidade') {
        const notes = (args.notas ?? {}) as Record<string, unknown>
        const scores = dimensionScoresSchema.safeParse(Object.fromEntries(complexityDimensions.map((dimension) => [dimension, notes[dimension]])))
        if (!scores.success) return { ok: false, error: `notas deve ter ${complexityDimensions.join(', ')}, cada uma de 0 a 3` }
        const confidence = ({ baixa: 'low', media: 'medium', alta: 'high' } as const)[String(args.confianca) as 'baixa']
        if (!confidence) return { ok: false, error: 'confianca deve ser baixa, media ou alta' }
        const trigger = assessmentTriggerSchema.safeParse(args.gatilho ?? 'initial')
        if (!trigger.success) return { ok: false, error: `gatilho deve ser um destes: ${assessmentTriggerSchema.options.filter((item) => item !== 'user-correction').join(', ')}` }
        if (trigger.data === 'user-correction') return { ok: false, error: 'Correção do usuário é feita por ele, na tela de avaliação do card.' }
        if (typeof args.motivo !== 'string' || !args.motivo.trim()) return { ok: false, error: 'informe o motivo (por que avaliar agora)' }
        const justifications = Object.fromEntries(Object.entries((args.justificativas ?? {}) as Record<string, unknown>).filter(([key, value]) => (complexityDimensions as readonly string[]).includes(key) && typeof value === 'string').map(([key, value]) => [key, (value as string).trim()]))
        const { assessment, previous } = history.assess({ cardId: cardId, scores: scores.data, justifications, confidence, preliminary: args.preliminar === true, criticalRisks: strings(args.riscos_criticos), evidence: evidence(args.evidencias), trigger: trigger.data, reason: args.motivo, source })
        run.notify({ type: 'card' })
        const delta = previous ? ` (antes ${previous.total}; ${assessment.total - previous.total >= 0 ? '+' : ''}${assessment.total - previous.total})` : ''
        return { ok: true, text: `Avaliação v${assessment.version} registrada: ${assessment.total} pontos${delta}, tarefa ${levelLabels[assessment.level]}${assessment.preliminary ? ' (preliminar)' : ''}. Fluxo recomendado: ${workflowLabels[assessment.workflow]}. Apresente a recomendação ao usuário; quando ele confirmar (ou escolher outro), chame agentboard_escolher_fluxo.` }
      }
      if (tool === 'agentboard_escolher_fluxo') {
        const workflow = workflowKindSchema.safeParse(args.fluxo)
        if (!workflow.success) return { ok: false, error: 'fluxo deve ser light, spec ou sdd' }
        if (args.confirmado_pelo_usuario !== true) return { ok: false, error: 'Só registre o fluxo depois que o usuário confirmar. Pergunte a ele primeiro.' }
        history.selectWorkflow(cardId, workflow.data, source, typeof args.motivo === 'string' ? args.motivo : '', 'user')
        applyWorkflowType(this.deps.board, cardId, workflow.data)
        run.notify({ type: 'card' })
        return { ok: true, text: `Fluxo registrado: ${workflowLabels[workflow.data]}. ${workflowNext[workflow.data]}` }
      }
      if (tool === 'agentboard_registrar_decisao') {
        const kind = decisionKindSchema.safeParse(args.tipo ?? 'other')
        if (!kind.success) return { ok: false, error: `tipo deve ser um destes: ${decisionKindSchema.options.join(', ')}` }
        if (typeof args.decisao !== 'string' || !args.decisao.trim()) return { ok: false, error: 'informe a decisao' }
        if (args.origem !== 'usuario' && args.origem !== 'agente') return { ok: false, error: 'origem deve ser "usuario" (o usuário decidiu no chat) ou "agente" (recomendação sua)' }
        const decision = history.decide(cardId, { kind: kind.data, statement: args.decisao, rationale: typeof args.motivo === 'string' ? args.motivo : '', actor: args.origem === 'usuario' ? 'user' : 'agent', supersedes: Number.isInteger(args.substitui) ? args.substitui as number : null, source })
        run.notify({ type: 'card' })
        return { ok: true, text: `Decisão D${String(decision.number).padStart(3, '0')} registrada (${decision.status === 'approved' ? 'do usuário' : 'recomendação, aguardando o usuário'}).` }
      }
      if (tool === 'agentboard_registrar_entendimento') {
        const readiness = args.prontidao === 'pronto' ? 'pronto' : args.prontidao === 'precisa_esclarecer' ? 'precisa-esclarecer' : null
        if (!readiness || typeof args.objetivo !== 'string' || !args.objetivo.trim()) return { ok: false, error: 'informe objetivo e prontidao ("pronto" ou "precisa_esclarecer")' }
        history.recordDiscovery(cardId, { objetivo: args.objetivo.trim(), motivacao: typeof args.motivacao === 'string' ? args.motivacao : '', escopo: strings(args.escopo), exclusoes: strings(args.exclusoes), criterios: strings(args.criterios), pendencias: strings(args.pendencias), contextoTecnico: typeof args.contexto_tecnico === 'string' ? args.contexto_tecnico : '', prontidao: readiness }, source)
        run.notify({ type: 'card' })
        return { ok: true, text: readiness === 'pronto' ? 'Entendimento registrado. Agora avalie a complexidade com agentboard_avaliar_complexidade.' : 'Entendimento registrado com pendências. Esclareça com o usuário antes de avaliar a complexidade (ou registre uma avaliação preliminar).' }
      }
      if (tool === 'agentboard_registrar_exploracao') {
        if (typeof args.resumo !== 'string' || !args.resumo.trim()) return { ok: false, error: 'informe o resumo da exploração' }
        const saved = history.recordExploration(cardId, { summary: args.resumo.trim().slice(0, 8000), modules: strings(args.modulos), repositories: strings(args.repositorios), evidence: evidence(args.evidencias) }, source)
        run.notify({ type: 'card' })
        return { ok: true, text: `Exploração guardada para a versão atual do código (${Object.keys(saved.codeVersions).join(', ') || 'sem Git'}). Ela aparece no contexto dos próximos turnos; só explore de novo se o código ou a demanda mudarem.` }
      }
      return { ok: false, error: `Ferramenta desconhecida: ${tool}` }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message.slice(0, 2000) : String(error) } }
  }

  /** Commit do agente: a regra da branch (nunca, pedir permissão ou automático) é aplicada pelo GitManager. */
  private async requestCommit(run: RunState, args: Record<string, unknown>): Promise<Reply> {
    if (!this.deps.git) return { ok: false, error: 'O Git do AgentBoard não está disponível' }
    if (run.purpose !== 'execution' || !run.cardId) return { ok: false, error: 'Esta ferramenta é do desenvolvedor (etapa de implementação).' }
    if (typeof args.mensagem !== 'string') return { ok: false, error: 'informe a mensagem do commit' }
    if (args.arquivos !== undefined && (!Array.isArray(args.arquivos) || args.arquivos.some((item) => typeof item !== 'string'))) return { ok: false, error: 'arquivos deve ser uma lista de caminhos' }
    if (args.repositorio !== undefined && typeof args.repositorio !== 'string') return { ok: false, error: 'repositorio deve ser um texto' }
    try {
      const result = await this.deps.git.agentCommit({ cardId: run.cardId, chatId: run.chatId, message: args.mensagem, files: args.arquivos as string[] | undefined, repo: args.repositorio as string | undefined })
      run.notify({ type: 'commit' })
      return { ok: true, text: result.text }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  }

  /** Constituição: todos leem; só o chat dela escreve; os outros chats propõem e o usuário aplica. */
  private constitution(run: RunState, tool: string, args: Record<string, unknown>): Reply {
    const { constitution, conversations } = this.deps
    if (!constitution || !conversations) return { ok: false, error: 'A Constituição não está disponível' }
    const projectId = conversations.projectOf(run.chatId)
    if (tool === 'agentboard_ler_constituicao') {
      const current = constitution.get(projectId)
      return { ok: true, text: current.contentMd.trim() ? `Constituição do projeto (versão ${current.version}):\n\n${current.contentMd}` : 'O projeto ainda não tem Constituição.' }
    }
    if (tool === 'agentboard_escrever_constituicao') {
      if (run.purpose !== 'constitution') return { ok: false, error: 'Só o chat da Constituição a altera. Aqui, use agentboard_propor_constituicao.' }
      if (typeof args.markdown !== 'string' || !args.markdown.trim() || args.markdown.length > 400_000) return { ok: false, error: 'markdown deve ser o texto completo da Constituição (até 400.000 caracteres)' }
      const saved = constitution.write(projectId, args.markdown.trim(), 'agent')
      run.notify({ type: 'constitution' })
      return { ok: true, text: `Constituição gravada (versão ${saved.version}).` }
    }
    if (run.purpose === 'constitution') return { ok: false, error: 'Neste chat, altere direto com agentboard_escrever_constituicao.' }
    if (![args.titulo, args.o_que_muda, args.motivo].every((value) => typeof value === 'string' && value.trim())) return { ok: false, error: 'informe titulo, o_que_muda e motivo' }
    const proposal = constitution.propose({ projectId, cardId: run.cardId, chatId: run.chatId, title: args.titulo as string, details: args.o_que_muda as string, reason: args.motivo as string })
    run.notify({ type: 'constitution' })
    return { ok: true, text: `Mudança C${String(proposal.number).padStart(3, '0')} registrada na aba Constituição do projeto, aguardando o usuário aplicar. Até lá, a Constituição atual continua valendo.` }
  }

  private findColumn(cardId: string, name: string): { id: string; label: string } | undefined {
    const wanted = normalize(name), card = this.deps.board.card(cardId)
    return this.deps.board.get(card.projectId).columns.find((column) => column.id === name || normalize(column.label) === wanted || column.semanticState === wanted)
  }
}

/** Plano B: documentos devolvidos no texto entre marcadores `<!-- agentboard:documento tipo=... -->`. */
export function extractDocuments(text: string): Array<{ kind: CardDocumentKind; markdown: string }> {
  const found: Array<{ kind: CardDocumentKind; markdown: string }> = []
  for (const match of text.matchAll(/<!--\s*agentboard:documento\s+tipo=([a-z]+)\s*-->([\s\S]*?)<!--\s*\/agentboard:documento\s*-->/g)) {
    const kind = match[1] as CardDocumentKind
    if ((cardDocumentKinds as readonly string[]).includes(kind)) found.push({ kind, markdown: match[2]!.trim() })
  }
  return found
}
