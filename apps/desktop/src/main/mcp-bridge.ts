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
import type { ApprovalService } from './approvals'
import type { PolicyEngine } from './policy'
import type { SddResolver } from './sdd/sdd-resolver'
import type { SddWriter } from './sdd/sdd-writer'
import type { CodeIndexService } from './code-index/service'
import { findCardType } from '@agentboard/contracts'
import { assessmentTriggerSchema, complexityDimensions, decisionKindSchema, dimensionScoresSchema, evidenceSchema, levelLabels, workflowKindSchema, workflowLabels, type Evidence, type WorkflowKind } from '@agentboard/contracts'

export interface McpEndpoint { command: string; args: string[]; env: Record<string, string> }
export type CardChange = { type: 'document'; kind: CardDocumentKind } | { type: 'task' } | { type: 'moved'; column: string } | { type: 'card' } | { type: 'converted'; cardId: string; chatId: string } | { type: 'constitution' } | { type: 'checklist' } | { type: 'commit' }
interface RunState { runId: string; cardId: string | null; chatId: string; purpose: ChatPurpose; written: Set<CardDocumentKind>; pendingMove: string | null; notify(change: CardChange): void }
export interface RunReport { written: CardDocumentKind[]; pendingMove: string | null }
type Reply = { ok: true; text: string } | { ok: false; error: string }

const historyTools = new Set(['agentboard_avaliar_complexidade', 'agentboard_escolher_fluxo', 'agentboard_registrar_decisao', 'agentboard_registrar_entendimento', 'agentboard_registrar_exploracao'])
/** O que o planejador faz depois de cada fluxo escolhido. */
const workflowNext: Record<WorkflowKind, string> = {
  light: 'The card is now in the short workflow: write the description of what to do with agentboard_atualizar_card (descricao) and call agentboard_concluir_planejamento.',
  spec: 'Follow the agentboard-planejamento skill: an objective Specification, Plan and Tasks; then agentboard_concluir_planejamento.',
  sdd: 'Follow the project\'s configured method (it comes in the context under "metodo") and save the Specification, Plan and Tasks on the card; then agentboard_concluir_planejamento.'
}

const cardTypeError = (types: Array<{ id: string; name: string }>): string => `tipo must be one of the project's card types: ${types.map((item) => `${item.id} (${item.name})`).join(', ')}. The short workflow is not a type: choose it with agentboard_escolher_fluxo (fluxo light).`

const normalize = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Canal local entre o servidor MCP (processo filho do agente) e o app. Usa socket Unix / named pipe, nunca porta de rede,
 * e cada execução tem um token próprio, válido só enquanto ela roda. Toda escrita passa pelas mesmas validações do IPC.
 */
export class McpBridge {
  usesSpecKit(cardId: string): boolean { return this.deps.history?.sddMethod(cardId) === 'speckit' }
  private server?: Server
  private readonly runs = new Map<string, RunState>()
  private readonly dir: string
  readonly socketPath: string

  constructor(private readonly deps: { board: BoardRepository; context: Pick<AgentContextService, 'block' | 'skillInstructions'>; serverScript: string; runtime?: string; collab?: CollaborationService; conversations?: Pick<ConversationRepository, 'projectOf' | 'convertToPlanning'>; constitution?: Pick<ConstitutionRepository, 'get' | 'write' | 'propose'>; checklists?: Pick<ChecklistRepository, 'write'>; git?: Pick<GitManager, 'agentCommit'>; history?: CardHistoryService; approvals?: ApprovalService; policy?: PolicyEngine; sddResolver?: Pick<SddResolver, 'constitution' | 'locate'>; sddWriter?: Pick<SddWriter, 'write'>; planReady?: (cardId: string) => { notices: string[] }; prepareWorktree?: (cardId: string) => Promise<unknown>; repositories?: (cardId: string) => Array<{ path: string; status: string }>; agentMoveApproval?: boolean; codeIndex?: Pick<CodeIndexService, 'tool' | 'isTool' | 'prewarm'>; codeRoots?: (run: { cardId: string | null; chatId: string }) => string[] }) {
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
    // o índice de código das pastas desta conversa começa a ficar pronto enquanto o agente sobe
    if (chat.purpose !== 'constitution') { try { this.deps.codeIndex?.prewarm(this.deps.codeRoots?.({ cardId, chatId: chat.id }) ?? []) } catch { /* sem pastas ainda */ } }
    return { command: this.deps.runtime ?? process.execPath, args: [this.deps.serverScript], env: { ELECTRON_RUN_AS_NODE: '1', AGENTBOARD_SOCKET: this.socketPath, AGENTBOARD_TOKEN: token, AGENTBOARD_PURPOSE: chat.purpose } }
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
    if (!run) return { ok: false, error: 'Unknown run, or it has already ended.' }
    const { board, context } = this.deps
    try {
      if (tool === 'agentboard_ler_skill') {
        if (typeof args.nome !== 'string' || !args.nome.trim()) return { ok: false, error: 'nome must be a skill from the catalog' }
        const instructions = context.skillInstructions(args.nome.trim())
        return instructions ? { ok: true, text: instructions } : { ok: false, error: `Unknown skill: ${args.nome}` }
      }
      if (tool === 'agentboard_criar_card') {
        // Chat da Constituição também pode criar um card (ex.: para gravar uma mudança de verdade, G09); a conversa passa a ser a dele.
        if ((run.purpose !== 'free' && run.purpose !== 'constitution') || run.cardId) return { ok: false, error: 'This conversation already has a card.' }
        if (!this.deps.conversations) return { ok: false, error: 'Free chat is not available' }
        const constitutionChat = run.purpose === 'constitution'
        const title = args.titulo, priority = args.prioridade ?? 'medium', summary = args.resumo ?? ''
        if (typeof title !== 'string' || !title.trim() || title.length > 240) return { ok: false, error: 'titulo must be a text of 1 to 240 characters' }
        if (!['low', 'medium', 'high', 'urgent'].includes(String(priority))) return { ok: false, error: 'prioridade must be low, medium, high or urgent' }
        if (typeof summary !== 'string') return { ok: false, error: 'resumo must be a text' }
        const projectId = this.deps.conversations.projectOf(run.chatId), types = board.cardTypes(projectId)
        // Sem tipo: o primeiro da lista do projeto. Com tipo: id ou nome de um dos tipos do projeto.
        const type = args.tipo === undefined ? types[0]!.id : findCardType(types, String(args.tipo))?.id
        if (!type) return { ok: false, error: cardTypeError(types) }
        const columns = board.get(projectId).columns
        const column = columns.find((item) => item.semanticState === 'backlog') ?? columns[0]
        if (!column) return { ok: false, error: 'The project has no columns' }
        const card = board.create({ projectId, columnId: column.id, type: String(type), title: title.trim(), description: summary, priority: String(priority), acceptanceCriteria: [] })
        this.deps.conversations.convertToPlanning(run.chatId, card.id)
        run.cardId = card.id; run.purpose = 'planning'
        run.notify({ type: 'converted', cardId: card.id, chatId: run.chatId })
        return { ok: true, text: constitutionChat ? `Card "${card.title}" created in ${column.label}. Send the complete text with agentboard_escrever_constituicao for review and approval on the card.` : `Card "${card.title}" created in ${column.label}. This chat is now its planning chat: load agentboard-planejamento with agentboard_ler_skill, follow the skill, save the Specification, Plan and Tasks with agentboard_escrever_documento and call agentboard_concluir_planejamento when done.` }
      }
      if (tool === 'agentboard_ler_constituicao' || tool === 'agentboard_escrever_constituicao' || tool === 'agentboard_propor_constituicao') return this.constitution(run, tool, args)
      // índice de código: só leitura, nas pastas desta conversa (worktree do card ou pastas do projeto); vale também no chat livre
      if (tool.startsWith('agentboard_code_')) return this.codeTool(run, tool, args)
      if (!run.cardId) return { ok: false, error: 'This conversation has no card yet. If the user asks to plan something, call agentboard_criar_card first.' }
      if (tool === 'agentboard_pedir_commit') return this.requestCommit(run, args)
      if (historyTools.has(tool)) return this.history(run, tool, args)
      if (tool === 'agentboard_definir_repositorios') return this.setRepositories(run, args)
      if (tool === 'agentboard_contexto_do_card') return context.block(run.cardId, run.purpose === 'planning').then((text) => ({ ok: true as const, text }))
      if (tool === 'agentboard_escrever_documento') {
        const kind = args.tipo, markdown = args.markdown
        if (this.deps.history?.sddMethod(run.cardId) === 'speckit' && (kind === 'especificacao' || kind === 'plano' || kind === 'tasks')) return { ok: false, error: 'Spec Kit artifacts must be created by the native skills (speckit-specify, speckit-plan, speckit-tasks) in the card worktree; do not use this tool.' }
        if (typeof kind !== 'string' || !(cardDocumentKinds as readonly string[]).includes(kind) || (systemDocumentKinds as readonly string[]).includes(kind)) return { ok: false, error: `tipo must be one of: ${cardDocumentKinds.filter((item) => !(systemDocumentKinds as readonly string[]).includes(item)).join(', ')}` }
        if (typeof markdown !== 'string' || markdown.length > 200_000) return { ok: false, error: 'markdown must be a text of up to 200,000 characters' }
        board.documents.write(run.cardId, kind as CardDocumentKind, markdown, 'agent')
        run.written.add(kind as CardDocumentKind); run.notify({ type: 'document', kind: kind as CardDocumentKind })
        return { ok: true, text: `Document ${kind} saved.` }
      }
      if (tool === 'agentboard_checklist_teste') {
        if (run.purpose !== 'test') return { ok: false, error: 'This tool is for the tester.' }
        if (!this.deps.checklists) return { ok: false, error: 'The test checklist is not available' }
        if (typeof args.markdown !== 'string' || args.markdown.length > 50_000) return { ok: false, error: 'markdown must be the complete checklist (up to 50,000 characters)' }
        this.deps.checklists.write(run.cardId, args.markdown); run.notify({ type: 'checklist' })
        return { ok: true, text: 'Test checklist saved.' }
      }
      if (tool === 'agentboard_concluir_planejamento') {
        if (run.purpose !== 'planning') return { ok: false, error: 'This tool is for the planner.' }
        if (this.deps.history?.sddMethod(run.cardId) === 'speckit') return { ok: false, error: 'In Spec Kit, planning is ready when the specification, plan and tasks of the card feature exist in the worktree; AgentBoard checks this on its own after each stage.' }
        const missing = board.markPlanReady(run.cardId)
        if (missing.length) return { ok: false, error: `Documents still missing: ${missing.join(', ')}. Save them and call again.` }
        run.notify({ type: 'card' })
        // Artefatos do plano (pasta do card e, no fluxo SDD, a pasta central do método) são gravados pelo app, nunca pelo planejador.
        let notices: string[] = []; try { notices = this.deps.planReady?.(run.cardId).notices ?? [] } catch (error) { notices = [error instanceof Error ? error.message : String(error)] }
        return { ok: true, text: `Planning concluded; the card now shows as "Plan ready".${notices.length ? ` Notices: ${notices.join(' ')}` : ''}` }
      }
      if (tool === 'agentboard_marcar_task') {
        if (!Number.isInteger(args.linha) || (args.linha as number) < 1 || typeof args.feito !== 'boolean') return { ok: false, error: 'linha must be an integer from 1 and feito a boolean' }
        board.documents.setTask(run.cardId, (args.linha as number) - 1, args.feito, 'agent'); run.notify({ type: 'task' })
        return { ok: true, text: `Line ${String(args.linha)} ${args.feito ? 'checked' : 'unchecked'}.` }
      }
      if (tool === 'agentboard_atualizar_card') {
        const current = board.card(run.cardId)
        const title = args.titulo === undefined ? current.title : args.titulo, type = args.tipo === undefined ? current.type : args.tipo, priority = args.prioridade === undefined ? current.priority : args.prioridade
        if (typeof title !== 'string' || !title.trim() || title.length > 240) return { ok: false, error: 'titulo must be a text of 1 to 240 characters' }
        // Tipo novo precisa ser um dos tipos do projeto; o atual (mesmo que tenha saído da lista) continua aceito.
        const resolvedType = args.tipo === undefined || args.tipo === current.type ? current.type : findCardType(board.cardTypes(current.projectId), String(type))?.id
        if (!resolvedType) return { ok: false, error: cardTypeError(board.cardTypes(current.projectId)) }
        if (!['low', 'medium', 'high', 'urgent'].includes(String(priority))) return { ok: false, error: 'prioridade must be low, medium, high or urgent' }
        if (args.descricao !== undefined && (typeof args.descricao !== 'string' || args.descricao.length > 20_000)) return { ok: false, error: 'descricao must be a text of up to 20,000 characters' }
        board.update({ cardId: run.cardId, type: resolvedType, title: title.trim(), description: typeof args.descricao === 'string' ? args.descricao.trim() : current.description, priority: String(priority), acceptanceCriteria: current.acceptanceCriteria.map(({ body, checked }) => ({ body, checked })) })
        run.notify({ type: 'card' })
        return { ok: true, text: `Card updated: ${title.trim()} (${resolvedType}, ${String(priority)}).` }
      }
      if (tool === 'agentboard_propor_mudanca' || tool === 'agentboard_perguntar_ao_planejador') {
        if (!this.deps.collab) return { ok: false, error: 'Collaboration between stages is not available' }
        if (run.purpose !== 'execution' && run.purpose !== 'test') return { ok: false, error: 'This tool is for the developer and the tester; the planner changes the documents directly.' }
        if (tool === 'agentboard_perguntar_ao_planejador') {
          if (typeof args.pergunta !== 'string' || !args.pergunta.trim()) return { ok: false, error: 'provide the pergunta' }
          const question = this.deps.collab.askQuestion({ cardId: run.cardId, chatId: run.chatId, purpose: run.purpose, question: args.pergunta })
          run.notify({ type: 'card' })
          return { ok: true, text: `Question D${String(question.number).padStart(3, '0')} registered. Continue only with what does not depend on it and END this run: the app takes the question to the planner and resumes you with the answer.` }
        }
        if (![args.titulo, args.o_que_muda, args.motivo].every((value) => typeof value === 'string' && value.trim())) return { ok: false, error: 'provide titulo, o_que_muda and motivo' }
        const change = this.deps.collab.proposeChange({ cardId: run.cardId, chatId: run.chatId, purpose: run.purpose, title: args.titulo as string, details: args.o_que_muda as string, reason: args.motivo as string })
        run.notify({ type: 'card' })
        return { ok: true, text: `Proposal M${String(change.number).padStart(3, '0')} registered and awaiting the user's authorization. Do NOT implement this change. Continue only with what is in the documents and end this run; the app resumes you when there is a decision.` }
      }
      if (tool === 'agentboard_responder_duvida' || tool === 'agentboard_pedir_ao_usuario') {
        if (!this.deps.collab) return { ok: false, error: 'Collaboration between stages is not available' }
        if (run.purpose !== 'planning') return { ok: false, error: 'This tool is for the planner.' }
        if (!Number.isInteger(args.numero) || typeof (tool === 'agentboard_responder_duvida' ? args.resposta : args.pergunta) !== 'string') return { ok: false, error: 'provide numero (integer) and ' + (tool === 'agentboard_responder_duvida' ? 'resposta' : 'pergunta') }
        if (tool === 'agentboard_responder_duvida') this.deps.collab.answerFromPlanner(run.cardId, args.numero as number, args.resposta as string)
        else this.deps.collab.escalateToUser(run.cardId, args.numero as number, args.pergunta as string)
        run.notify({ type: 'card' })
        return { ok: true, text: tool === 'agentboard_responder_duvida' ? `Question ${String(args.numero)} answered; the app returns the answer to whoever asked.` : `Question ${String(args.numero)} sent to the user; the app resumes whoever asked when the user answers.` }
      }
      if (tool === 'agentboard_mover_card') {
        if (typeof args.coluna !== 'string' || (args.quando !== 'agora' && args.quando !== 'ao_terminar')) return { ok: false, error: 'provide coluna and quando ("agora" or "ao_terminar")' }
        const column = this.findColumn(run.cardId, args.coluna)
        if (!column) return { ok: false, error: `Column not found: ${args.coluna}` }
        if (args.quando === 'ao_terminar') { run.pendingMove = column.id; return { ok: true, text: `The card will move to ${column.label} when this run ends.` } }
        const movePolicyDenied = this.policyDenied(run, 'move'); if (movePolicyDenied) return { ok: false, error: movePolicyDenied }
        // S05 (atrás da flag): o movimento imediato vira pedido pendente; a Done continua sujeita ao gate quando o usuário aprovar.
        if (this.deps.agentMoveApproval && this.deps.approvals) {
          const card = board.card(run.cardId)
          const approval = this.deps.approvals.request({ kind: 'agent-move', subjectRef: run.cardId, payload: { columnId: column.id, columnLabel: column.label }, requestedActor: 'agent', runId: run.runId, cardId: run.cardId, projectId: card.projectId })
          run.notify({ type: 'card' })
          return { ok: true, text: `Request to move to ${column.label} registered (${approval.id}), awaiting the user's approval on the card.` }
        }
        board.move(run.cardId, column.id, null, 'agent'); run.notify({ type: 'moved', column: column.label })
        return { ok: true, text: `Card moved to ${column.label}.` }
      }
      return { ok: false, error: `Unknown tool: ${tool}` }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  }

  /** Repositórios do card: só eles ganham worktree. Na execução, o repositório novo é preparado na hora (os outros continuam como estão). */
  private async codeTool(run: RunState, tool: string, args: Record<string, unknown>): Promise<Reply> {
    const { codeIndex, codeRoots } = this.deps
    if (!codeIndex || !codeRoots || !codeIndex.isTool(tool)) return { ok: false, error: `Unknown tool: ${tool}` }
    if (run.purpose === 'constitution') return { ok: false, error: 'The code tools are not available in the Constitution chat.' }
    return { ok: true, text: await codeIndex.tool(tool, args, codeRoots({ cardId: run.cardId, chatId: run.chatId })) }
  }

  private async setRepositories(run: RunState, args: Record<string, unknown>): Promise<Reply> {
    if (!run.cardId) return { ok: false, error: 'This conversation has no card yet.' }
    if (!Array.isArray(args.repositorios) || args.repositorios.some((item) => typeof item !== 'string')) return { ok: false, error: 'repositorios must be a list of names' }
    const { board } = this.deps, card = board.card(run.cardId)
    const sources = board.get(card.projectId).project.sources.filter((source) => source.isGitRepository)
    const names = (args.repositorios as string[]).map((name) => name.trim()).filter(Boolean)
    const chosen = names.map((name) => sources.find((source) => normalize(source.name) === normalize(name)))
    const missing = names.filter((_, index) => !chosen[index])
    if (missing.length) return { ok: false, error: `Unknown repository: ${missing.join(', ')}. Available: ${sources.map((source) => source.name).join(', ')}` }
    board.setRepos(run.cardId, chosen.length ? chosen.map((source) => source!.id) : null)
    try { this.deps.history?.decide(run.cardId, { kind: 'scope', statement: `Repositórios do card: ${chosen.length ? chosen.map((source) => source!.name).join(', ') : 'todos'}`, rationale: typeof args.motivo === 'string' ? args.motivo : '', actor: 'agent', source: { actor: 'agent', runId: run.runId, chatId: run.chatId } }) } catch { /* decisão é registro, não bloqueia */ }
    let prepared = ''
    if (run.purpose === 'execution' || run.purpose === 'test') {
      const worktree = await this.deps.prepareWorktree?.(run.cardId).catch((error: unknown) => { prepared = ` Could not prepare: ${error instanceof Error ? error.message : String(error)}`; return null })
      if (worktree) prepared = ` Worktree updated; folders: ${(this.deps.repositories?.(run.cardId) ?? []).map((repo) => `${repo.path} (${repo.status})`).join(', ')}.`
    }
    run.notify({ type: 'card' })
    return { ok: true, text: `The card works in: ${chosen.length ? chosen.map((source) => source!.name).join(', ') : 'all repositories'}.${prepared}` }
  }

  /** Complexity Engine, decisões, entendimento e exploração: tudo vira evento versionado do card (docs/09). */
  private history(run: RunState, tool: string, args: Record<string, unknown>): Reply {
    const history = this.deps.history
    const cardId = run.cardId
    if (!cardId) return { ok: false, error: 'This conversation has no card yet.' }
    if (!history) return { ok: false, error: 'The card history is not available' }
    const source = { actor: 'agent' as const, runId: run.runId, chatId: run.chatId }
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : []
    const evidence = (value: unknown): Evidence[] => (Array.isArray(value) ? value : []).map((item: Record<string, unknown>) => evidenceSchema.parse({ kind: item?.tipo, ref: item?.referencia, detail: typeof item?.detalhe === 'string' ? item.detalhe : '', line: Number.isInteger(item?.linha) ? item.linha : null, commit: typeof item?.commit === 'string' ? item.commit : null }))
    try {
      if (tool === 'agentboard_avaliar_complexidade') {
        const notes = (args.notas ?? {}) as Record<string, unknown>
        const scores = dimensionScoresSchema.safeParse(Object.fromEntries(complexityDimensions.map((dimension) => [dimension, notes[dimension]])))
        if (!scores.success) return { ok: false, error: `notas must have ${complexityDimensions.join(', ')}, each from 0 to 3` }
        const confidence = ({ baixa: 'low', media: 'medium', alta: 'high' } as const)[String(args.confianca) as 'baixa']
        if (!confidence) return { ok: false, error: 'confianca must be baixa, media or alta' }
        const trigger = assessmentTriggerSchema.safeParse(args.gatilho ?? 'initial')
        if (!trigger.success) return { ok: false, error: `gatilho must be one of: ${assessmentTriggerSchema.options.filter((item) => item !== 'user-correction').join(', ')}` }
        if (trigger.data === 'user-correction') return { ok: false, error: 'The user\'s correction is made by the user, on the card assessment screen.' }
        if (typeof args.motivo !== 'string' || !args.motivo.trim()) return { ok: false, error: 'provide the motivo (why assess now)' }
        const justifications = Object.fromEntries(Object.entries((args.justificativas ?? {}) as Record<string, unknown>).filter(([key, value]) => (complexityDimensions as readonly string[]).includes(key) && typeof value === 'string').map(([key, value]) => [key, (value as string).trim()]))
        const { assessment, previous } = history.assess({ cardId: cardId, scores: scores.data, justifications, confidence, preliminary: args.preliminar === true, criticalRisks: strings(args.riscos_criticos), evidence: evidence(args.evidencias), trigger: trigger.data, reason: args.motivo, source })
        run.notify({ type: 'card' })
        const delta = previous ? ` (before ${previous.total}; ${assessment.total - previous.total >= 0 ? '+' : ''}${assessment.total - previous.total})` : ''
        return { ok: true, text: `Assessment v${assessment.version} registered: ${assessment.total} points${delta}, ${levelLabels[assessment.level]} task${assessment.preliminary ? ' (preliminary)' : ''}. Recommended workflow: ${workflowLabels[assessment.workflow]}. Present the recommendation to the user; when they confirm (or choose another), call agentboard_escolher_fluxo.` }
      }
      if (tool === 'agentboard_escolher_fluxo') {
        const workflow = workflowKindSchema.safeParse(args.fluxo)
        if (!workflow.success) return { ok: false, error: 'fluxo must be light, spec or sdd' }
        const method = args.metodo === 'native' || args.metodo === 'speckit' ? args.metodo : undefined
        if (workflow.data === 'sdd' && (!method || typeof args.motivo !== 'string' || !args.motivo.trim())) return { ok: false, error: 'For SDD, recommend metodo native or speckit and explain in motivo why it suits this card.' }
        const flowPolicyDenied = this.policyDenied(run, 'choose-workflow'); if (flowPolicyDenied) return { ok: false, error: flowPolicyDenied }
        if (!this.deps.approvals) return { ok: false, error: 'Approvals are not available' }
        if (workflow.data === 'sdd' && method) history.recommendSddMethod(cardId, method, String(args.motivo), source)
        const card = this.deps.board.card(cardId), approval = this.deps.approvals.request({ kind: 'workflow-choice', subjectRef: cardId, payload: { workflow: workflow.data, method: method ?? null, reason: typeof args.motivo === 'string' ? args.motivo : '' }, requestedActor: 'agent', runId: run.runId, cardId, projectId: card.projectId })
        run.notify({ type: 'card' })
        return { ok: true, text: `Workflow proposal ${workflowLabels[workflow.data]}${method ? ` — ${method === 'native' ? 'AgentBoard SDD' : 'GitHub Spec Kit'}` : ''} registered for the user's approval (${approval.id}). Wait for the decision before continuing in the workflow.` }
      }
      if (tool === 'agentboard_registrar_decisao') {
        const kind = decisionKindSchema.safeParse(args.tipo ?? 'other')
        if (!kind.success) return { ok: false, error: `tipo must be one of: ${decisionKindSchema.options.join(', ')}` }
        if (typeof args.decisao !== 'string' || !args.decisao.trim()) return { ok: false, error: 'provide the decisao' }
        if (args.origem !== 'usuario' && args.origem !== 'agente') return { ok: false, error: 'origem must be "usuario" (the user decided in the chat) or "agente" (your recommendation)' }
        const active = history.decisions(cardId).filter((item) => item.status !== 'superseded')
        const reviewed = Array.isArray(args.decisoes_revisadas) ? args.decisoes_revisadas : []
        if (!Array.isArray(args.decisoes_revisadas) || active.some((item) => !reviewed.includes(item.number))) return { ok: false, error: `Review the current decisions below before registering. If the new one replaces any, give its number in substitui; if it is equivalent, do not duplicate. Send all reviewed numbers in decisoes_revisadas (or [] if there are no decisions):\n${active.map((item) => `D${item.number} [${item.status}]: ${item.statement}`).join('\n') || '(none)'}` }
        // A entrada MCP nunca é prova de uma ação humana; mesmo quando o agente alega que veio do usuário, fica como proposta.
        const decision = history.decide(cardId, { kind: kind.data, statement: args.decisao, rationale: typeof args.motivo === 'string' ? args.motivo : '', actor: 'agent', supersedes: Number.isInteger(args.substitui) ? args.substitui as number : null, source })
        run.notify({ type: 'card' })
        return { ok: true, text: `Decision D${String(decision.number).padStart(3, '0')} registered as a proposal, awaiting the user${args.origem === 'usuario' ? ' (the origin declared by the agent was downgraded)' : ''}.` }
      }
      if (tool === 'agentboard_registrar_entendimento') {
        const readiness = args.prontidao === 'pronto' ? 'pronto' : args.prontidao === 'precisa_esclarecer' ? 'precisa-esclarecer' : null
        if (!readiness || typeof args.objetivo !== 'string' || !args.objetivo.trim()) return { ok: false, error: 'provide objetivo and prontidao ("pronto" or "precisa_esclarecer")' }
        history.recordDiscovery(cardId, { objetivo: args.objetivo.trim(), motivacao: typeof args.motivacao === 'string' ? args.motivacao : '', escopo: strings(args.escopo), exclusoes: strings(args.exclusoes), criterios: strings(args.criterios), pendencias: strings(args.pendencias), contextoTecnico: typeof args.contexto_tecnico === 'string' ? args.contexto_tecnico : '', prontidao: readiness }, source)
        run.notify({ type: 'card' })
        return { ok: true, text: readiness === 'pronto' ? 'Understanding registered. Now assess the complexity with agentboard_avaliar_complexidade.' : 'Understanding registered with open items. Clarify with the user before assessing the complexity (or register a preliminary assessment).' }
      }
      if (tool === 'agentboard_registrar_exploracao') {
        if (typeof args.resumo !== 'string' || !args.resumo.trim()) return { ok: false, error: 'provide the resumo of the exploration' }
        const saved = history.recordExploration(cardId, { summary: args.resumo.trim().slice(0, 8000), modules: strings(args.modulos), repositories: strings(args.repositorios), evidence: evidence(args.evidencias) }, source)
        run.notify({ type: 'card' })
        return { ok: true, text: `Exploration saved for the current version of the code (${Object.keys(saved.codeVersions).join(', ') || 'no Git'}). It appears in the context of the next turns; only explore again if the code or the request changes.` }
      }
      return { ok: false, error: `Unknown tool: ${tool}` }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message.slice(0, 2000) : String(error) } }
  }

  /** Commit do agente: a regra da branch (nunca, pedir permissão ou automático) é aplicada pelo GitManager. */
  private async requestCommit(run: RunState, args: Record<string, unknown>): Promise<Reply> {
    if (!this.deps.git) return { ok: false, error: 'AgentBoard Git is not available' }
    if (run.purpose !== 'execution' || !run.cardId) return { ok: false, error: 'This tool is for the developer (implementation stage).' }
    const denied = this.policyDenied(run, 'commit'); if (denied) return { ok: false, error: denied }
    if (typeof args.mensagem !== 'string') return { ok: false, error: 'provide the commit mensagem' }
    if (args.arquivos !== undefined && (!Array.isArray(args.arquivos) || args.arquivos.some((item) => typeof item !== 'string'))) return { ok: false, error: 'arquivos must be a list of paths' }
    if (args.repositorio !== undefined && typeof args.repositorio !== 'string') return { ok: false, error: 'repositorio must be a text' }
    try {
      const result = await this.deps.git.agentCommit({ cardId: run.cardId, chatId: run.chatId, message: args.mensagem, files: args.arquivos as string[] | undefined, repo: args.repositorio as string | undefined })
      run.notify({ type: 'commit' })
      return { ok: true, text: result.text }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) } }
  }

  /**
   * Constituição (G09): todos leem (pelo resolver file-first, com fallback no SQLite legado); só quem tem card grava — na
   * worktree dele, pelo `SddWriter` — e os outros chats propõem (o usuário aplica). O chat da Constituição conversa e
   * entende livremente, mas sem card não grava nada: a instrução (skill) é criar um card quando for de verdade gravar.
   */
  private async constitution(run: RunState, tool: string, args: Record<string, unknown>): Promise<Reply> {
    const { constitution, conversations } = this.deps
    if (!conversations) return { ok: false, error: 'The Constitution is not available' }
    const projectId = conversations.projectOf(run.chatId)
    if (tool === 'agentboard_ler_constituicao') {
      if (this.deps.sddResolver) {
        try {
          const view = await this.deps.sddResolver.constitution({ projectId, cardId: run.cardId ?? undefined })
          if (view.content !== null) return { ok: true, text: `Project Constitution:\n\n${view.content}` }
        } catch { /* repositório do SDD ainda não configurado ou indisponível: cai no legado abaixo */ }
      }
      if (!constitution) return { ok: false, error: 'The Constitution is not available' }
      const current = constitution.get(projectId)
      return { ok: true, text: current.contentMd.trim() ? `Project Constitution (version ${current.version}, not yet migrated to file-first SDD):\n\n${current.contentMd}` : 'The project has no Constitution yet.' }
    }
    if (tool === 'agentboard_escrever_constituicao') {
      if (!run.cardId) return { ok: false, error: 'This tool writes to a card worktree. Create a card (agentboard_criar_card) to make this change.' }
      if (typeof args.markdown !== 'string' || !args.markdown.trim() || args.markdown.length > 400_000) return { ok: false, error: 'markdown must be the complete text of the Constitution (up to 400,000 characters)' }
      if (!this.deps.sddResolver || !this.deps.approvals) return { ok: false, error: 'SDD approval is not available' }
      const [view, location] = await Promise.all([
        this.deps.sddResolver.constitution({ projectId, cardId: run.cardId }),
        this.deps.sddResolver.locate({ projectId, cardId: run.cardId })
      ])
      this.deps.approvals.request({ kind: 'constitution-apply', subjectRef: view.path, cardId: run.cardId, projectId, runId: run.runId, requestedActor: 'agent', payload: { sourceId: location.sourceId, path: view.path, before: view.content, content: args.markdown, expectBlobSha: view.blobSha } })
      run.notify({ type: 'constitution' })
      return { ok: true, text: `Proposal registered for ${view.path}. Wait for the user's review and approval on the card; the file has not been changed yet.` }
    }
    if (!constitution) return { ok: false, error: 'The Constitution is not available' }
    if (run.purpose === 'constitution') return { ok: false, error: 'To actually write it, create a card (agentboard_criar_card) and save with agentboard_escrever_constituicao from it.' }
    if (![args.titulo, args.o_que_muda, args.motivo].every((value) => typeof value === 'string' && value.trim())) return { ok: false, error: 'provide titulo, o_que_muda and motivo' }
    const proposal = constitution.propose({ projectId, cardId: run.cardId, chatId: run.chatId, title: args.titulo as string, details: args.o_que_muda as string, reason: args.motivo as string })
    run.notify({ type: 'constitution' })
    return { ok: true, text: `Change C${String(proposal.number).padStart(3, '0')} registered in the project Constitution tab, awaiting the user to apply it. Until then, the current Constitution remains in force.` }
  }

  private findColumn(cardId: string, name: string): { id: string; label: string } | undefined {
    const wanted = normalize(name), card = this.deps.board.card(cardId)
    return this.deps.board.get(card.projectId).columns.find((column) => column.id === name || normalize(column.label) === wanted || column.semanticState === wanted)
  }

  /** S11: consulta o `PolicyEngine` (regras do projeto); `deny` devolve o motivo e não faz nada. Sem motor, nunca bloqueia. */
  private policyDenied(run: RunState, action: 'commit' | 'move' | 'choose-workflow'): string | null {
    if (!this.deps.policy || !run.cardId) return null
    const card = this.deps.board.card(run.cardId)
    const rules = this.deps.history?.config(card.projectId).policy.rules ?? []
    const decision = this.deps.policy.decide(rules, action, { cardId: run.cardId, projectId: card.projectId, actor: 'agent' })
    return decision === 'deny' ? `Blocked by the project policy (${action}).` : null
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
