import type { CardDocumentKind } from '@agentboard/contracts'
import { extractDocuments, type McpBridge, type McpEndpoint } from './mcp-bridge'
import type { BoardRepository } from './projects'

type Publish = (type: string, payload: Record<string, unknown>) => void

/** Liga uma execução ao card: entrega o servidor MCP ao agente e, no fim, aplica o que o agente devolveu (marcadores, plano, movimento adiado). */
export class AgentWriteback {
  constructor(private readonly board: BoardRepository, private readonly bridge: McpBridge) {}

  begin(runId: string, cardId: string, publish: Publish): McpEndpoint {
    return this.bridge.register(runId, cardId, (change) => publish('agentboard/card-updated', { cardId, ...change }))
  }

  /** Sem MCP nem marcadores, o texto do agente vira o documento Plano (mantém o comportamento anterior do planejamento). */
  writePlan(cardId: string, text: string): void { this.board.documents.write(cardId, 'plano', text, 'agent') }

  /** Devolve avisos (em português) para mostrar no chat quando algo não pôde ser aplicado. */
  finish(input: { runId: string; cardId: string; planning: boolean; completed: boolean; text: string; publish: Publish }): { notices: string[]; wroteDocuments: boolean } {
    const report = this.bridge.finish(input.runId), notices: string[] = []
    const written = new Set<CardDocumentKind>(report.written)
    if (input.completed) {
      for (const document of extractDocuments(input.text)) {
        try { this.board.documents.write(input.cardId, document.kind, document.markdown, 'agent'); written.add(document.kind) }
        catch (error) { notices.push(`O documento ${document.kind} não foi gravado: ${error instanceof Error ? error.message : String(error)}`) }
      }
      if (report.pendingMove) {
        try { const moved = this.board.move(input.cardId, report.pendingMove, null, 'agent'); input.publish('agentboard/card-updated', { cardId: input.cardId, type: 'moved', column: this.board.get(moved.projectId).columns.find((column) => column.id === moved.columnId)?.label ?? '' }) }
        catch (error) { notices.push(`O card não foi movido: ${error instanceof Error ? error.message : String(error)}`) }
      }
    }
    if (written.size) input.publish('agentboard/card-updated', { cardId: input.cardId, type: 'document' })
    return { notices, wroteDocuments: written.size > 0 }
  }
}
