import type { CodeTool } from './protocol'
import type { Queries } from './query'

/**
 * Ferramentas MCP do índice (agentboard_code_*). Os argumentos seguem o padrão das outras ferramentas do AgentBoard
 * (nomes em português); as respostas são em inglês.
 */
export const codeToolNames: Record<string, CodeTool> = {
  agentboard_code_explore: 'explore',
  agentboard_code_node: 'node',
  agentboard_code_search: 'search',
  agentboard_code_impact: 'impact',
  agentboard_code_callers: 'callers',
  agentboard_code_callees: 'callees',
  agentboard_code_affected_tests: 'affected',
  agentboard_code_map: 'map'
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const int = (value: unknown, min: number, max: number): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : undefined)

export function runCodeTool(q: Queries, tool: CodeTool, args: Record<string, unknown>): string {
  switch (tool) {
    case 'explore': {
      const question = text(args.pergunta)
      if (!question) throw new Error('pergunta must be a question or names of symbols/files')
      return q.explore(question, { maxFiles: int(args.max_arquivos, 1, 20) ?? 12, detail: args.detalhe === 'resumo' ? 'summary' : 'full' })
    }
    case 'node': return q.node({ symbol: text(args.simbolo), file: text(args.arquivo), includeCode: args.codigo === true, line: int(args.linha, 1, 1_000_000), offset: int(args.offset, 1, 1_000_000), limit: int(args.limite, 1, 2000), outline: args.estrutura === true })
    case 'search': {
      const query = text(args.consulta)
      if (!query) throw new Error('consulta must be a name or words')
      return q.search(query, { kind: text(args.tipo), limit: int(args.limite, 1, 50) ?? 10 })
    }
    case 'impact': case 'callers': case 'callees': {
      const symbol = text(args.simbolo)
      if (!symbol) throw new Error('simbolo must be the name of a function, method, class or type')
      if (tool === 'impact') return q.impact(symbol, { file: text(args.arquivo), depth: int(args.profundidade, 1, 5) ?? 2 })
      return q.walk(symbol, { file: text(args.arquivo), depth: int(args.profundidade, 1, 4) ?? 1, direction: tool === 'callers' ? 'in' : 'out' })
    }
    case 'affected': return q.affected({ files: Array.isArray(args.arquivos) ? args.arquivos.filter((item): item is string => typeof item === 'string') : undefined })
    case 'map': return q.map({ tokens: int(args.tokens, 200, 6000) ?? 1500, path: text(args.pasta) })
  }
}
