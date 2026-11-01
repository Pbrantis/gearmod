import type { CardDocumentKind, ChatPurpose } from '@agentboard/contracts'
import { extractDocuments, type McpBridge, type McpEndpoint } from './mcp-bridge'
import type { BoardRepository } from './projects'

type Publish = (type: string, payload: Record<string, unknown>) => void

/** Liga uma execução ao card: entrega o servidor MCP ao agente e, no fim, aplica o que o agente devolveu (marcadores, plano, movimento adiado). */
/** Título de reserva a partir do primeiro pedido: primeira frase, sem Markdown, até 60 caracteres. */
export function titleFromPrompt(prompt: string): string {
  const plain = prompt.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`[\]]/g, '').replace(/\s+/g, ' ').trim()
  const sentence = plain.split(/(?<=[.!?])\s/)[0] ?? plain
  if (!sentence) return ''
  const text = sentence.replace(/[.!?]+$/, '')
  const cut = text.length <= 60 ? text : `${text.slice(0, 60).replace(/\s+\S*$/, '')}…`
  return cut.charAt(0).toUpperCase() + cut.slice(1)
}

export class AgentWriteback {
  constructor(private readonly board: BoardRepository, private readonly bridge: McpBridge) {}

  begin(runId: string, cardId: string | null, publish: Publish, chat?: { id: string; purpose: ChatPurpose }): McpEndpoint {
    return this.bridge.register(runId, cardId, (change) => publish('agentboard/card-updated', { cardId, ...change }), chat)
  }

  /** Devolve avisos (em português) para mostrar no chat quando algo não pôde ser aplicado. */
  finish(input: { runId: string; cardId: string | null; planning: boolean; completed: boolean; text: string; prompt?: string; publish: Publish }): { notices: string[]; wroteDocuments: boolean } {
    const report = this.bridge.finish(input.runId), notices: string[] = []
    if (!input.cardId) return { notices, wroteDocuments: false }
    const written = new Set<CardDocumentKind>(report.written)
    const specKit = this.bridge.usesSpecKit(input.cardId)
    if (input.completed) {
      for (const document of extractDocuments(input.text)) {
        if (specKit && (document.kind === 'especificacao' || document.kind === 'plano' || document.kind === 'tasks')) { notices.push('Os artefatos do Spec Kit devem ser produzidos pelas skills nativas; o documento paralelo não foi gravado.'); continue }
        try { this.board.documents.write(input.cardId, document.kind, document.markdown, 'agent'); written.add(document.kind) }
        catch (error) { notices.push(`O documento ${document.kind} não foi gravado: ${error instanceof Error ? error.message : String(error)}`) }
      }
      if (input.planning && !specKit && /<!--\s*agentboard:planejamento-concluido\s*-->/.test(input.text)) {
        const missing = this.board.markPlanReady(input.cardId)
        if (missing.length) notices.push(`O planejamento não foi dado como concluído: faltam ${missing.join(', ')}.`)
      }
      if (report.pendingMove) {
        try { const moved = this.board.move(input.cardId, report.pendingMove, null, 'agent'); input.publish('agentboard/card-updated', { cardId: input.cardId, type: 'moved', column: this.board.get(moved.projectId).columns.find((column) => column.id === moved.columnId)?.label ?? '' }) }
        catch (error) { notices.push(`O card não foi movido: ${error instanceof Error ? error.message : String(error)}`) }
      }
    }
    if (input.planning && input.prompt) {
      // Se o agente não deu título ao card (sem MCP, por exemplo), usa o início do primeiro pedido para o card não ficar anônimo.
      const card = this.board.card(input.cardId)
      const title = card.title.trim() ? '' : titleFromPrompt(input.prompt)
      if (title) {
        this.board.update({ cardId: input.cardId, type: card.type, title, description: card.description, priority: card.priority, acceptanceCriteria: card.acceptanceCriteria.map(({ body, checked }) => ({ body, checked })) })
        input.publish('agentboard/card-updated', { cardId: input.cardId, type: 'card' })
      }
    }
    if (written.size) input.publish('agentboard/card-updated', { cardId: input.cardId, type: 'document' })
    return { notices, wroteDocuments: written.size > 0 }
  }
}
