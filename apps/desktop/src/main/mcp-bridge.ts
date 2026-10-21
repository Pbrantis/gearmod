import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CardDocumentKind } from '@agentboard/contracts'
import { cardDocumentKinds } from '@agentboard/contracts'
import type { AgentContextService } from './agent-context'
import type { BoardRepository } from './projects'

export interface McpEndpoint { command: string; args: string[]; env: Record<string, string> }
export type CardChange = { type: 'document'; kind: CardDocumentKind } | { type: 'task' } | { type: 'moved'; column: string } | { type: 'card' }
interface RunState { runId: string; cardId: string; written: Set<CardDocumentKind>; pendingMove: string | null; notify(change: CardChange): void }
export interface RunReport { written: CardDocumentKind[]; pendingMove: string | null }
type Reply = { ok: true; text: string } | { ok: false; error: string }

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

  constructor(private readonly deps: { board: BoardRepository; context: Pick<AgentContextService, 'block'>; serverScript: string; runtime?: string }) {
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
        let reply: Reply
        try { const request = JSON.parse(buffer.slice(0, end)) as { token?: string; tool?: string; args?: Record<string, unknown> }; reply = this.handle(request.token ?? '', request.tool ?? '', request.args ?? {}) }
        catch (error) { reply = { ok: false, error: error instanceof Error ? error.message : String(error) } }
        socket.end(`${JSON.stringify(reply)}\n`)
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

  register(runId: string, cardId: string, notify: (change: CardChange) => void): McpEndpoint {
    const token = randomBytes(24).toString('hex')
    this.runs.set(token, { runId, cardId, written: new Set(), pendingMove: null, notify })
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

  private handle(token: string, tool: string, args: Record<string, unknown>): Reply {
    const run = this.runs.get(token)
    if (!run) return { ok: false, error: 'Execução desconhecida ou já encerrada.' }
    const { board, context } = this.deps
    try {
      if (tool === 'agentboard_contexto_do_card') return { ok: true, text: context.block(run.cardId) }
      if (tool === 'agentboard_escrever_documento') {
        const kind = args.tipo, markdown = args.markdown
        if (typeof kind !== 'string' || !(cardDocumentKinds as readonly string[]).includes(kind)) return { ok: false, error: `tipo deve ser um destes: ${cardDocumentKinds.join(', ')}` }
        if (typeof markdown !== 'string' || markdown.length > 200_000) return { ok: false, error: 'markdown deve ser um texto de até 200.000 caracteres' }
        board.documents.write(run.cardId, kind as CardDocumentKind, markdown, 'agent')
        run.written.add(kind as CardDocumentKind); run.notify({ type: 'document', kind: kind as CardDocumentKind })
        return { ok: true, text: `Documento ${kind} gravado.` }
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
        if (!['feature', 'bug', 'improvement', 'task'].includes(String(type))) return { ok: false, error: 'tipo deve ser feature, bug, improvement ou task' }
        if (!['low', 'medium', 'high', 'urgent'].includes(String(priority))) return { ok: false, error: 'prioridade deve ser low, medium, high ou urgent' }
        board.update({ cardId: run.cardId, type: String(type), title: title.trim(), description: current.description, priority: String(priority), acceptanceCriteria: current.acceptanceCriteria.map(({ body, checked }) => ({ body, checked })) })
        run.notify({ type: 'card' })
        return { ok: true, text: `Card atualizado: ${title.trim()} (${String(type)}, ${String(priority)}).` }
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
