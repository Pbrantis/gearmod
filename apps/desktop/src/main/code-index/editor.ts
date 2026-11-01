import { isAbsolute, join, relative, resolve } from 'node:path'
import type { CodeSymbol } from '@agentboard/contracts'
import type { CodeIndexService } from './service'
import type { SymbolHit } from './query'
import type { RootStatus } from './code-index'

/** O pedaço do serviço que o editor usa (permite trocar nos testes). */
export type EditorCodeIndex = Pick<CodeIndexService, 'enabled' | 'symbols' | 'outline' | 'definitions' | 'references' | 'status'>
interface Context { projectId: string; cardId: string | null }

/** Pasta indexada que contém o arquivo (a mais funda, se uma estiver dentro da outra) e o caminho relativo a ela, com `/`. */
export function rootOf(roots: string[], file: string): { root: string; relative: string } | null {
  const target = resolve(file)
  let best: { root: string; relative: string } | null = null
  for (const root of roots) {
    const rel = relative(resolve(root), target)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue
    if (!best || root.length > best.root.length) best = { root, relative: rel.replace(/\\/g, '/') }
  }
  return best
}

const absolute = (root: string, hit: SymbolHit): CodeSymbol => ({ name: hit.name, qname: hit.qname, kind: hit.kind, path: join(root, hit.path), relative: hit.path, line: hit.line, endLine: hit.endLine, signature: hit.signature })

/**
 * Consultas do editor (ir para símbolo, estrutura, definição, quem usa) sobre as pastas do projeto ou da worktree do card.
 * Os caminhos entram e saem absolutos; com o índice desligado tudo volta vazio.
 */
export function editorCodeQueries(index: EditorCodeIndex | undefined, codeRoots: (context: Context) => string[]) {
  const on = (): boolean => Boolean(index?.enabled)
  /** Pastas em ordem: a do arquivo de onde se pergunta primeiro. */
  const ordered = (context: Context, path?: string): { roots: string[]; from: { root: string; relative: string } | null } => {
    const roots = codeRoots(context), from = path ? rootOf(roots, path) : null
    return { roots: from ? [from.root, ...roots.filter((root) => root !== from.root)] : roots, from }
  }
  return {
    async symbols(input: Context & { query: string; limit?: number | undefined }): Promise<CodeSymbol[]> {
      if (!on()) return []
      const limit = input.limit ?? 50, out: CodeSymbol[] = []
      for (const root of codeRoots(input)) for (const hit of await index!.symbols(root, input.query, limit)) out.push(absolute(root, hit))
      return out.slice(0, limit)
    },
    async outline(input: Context & { path: string }): Promise<Array<CodeSymbol & { depth: number }>> {
      if (!on()) return []
      const from = rootOf(codeRoots(input), input.path)
      if (!from) return []
      return (await index!.outline(from.root, from.relative)).map((hit) => ({ ...absolute(from.root, hit), depth: hit.depth }))
    },
    async definition(input: Context & { name: string; path?: string | undefined }): Promise<CodeSymbol[]> {
      if (!on()) return []
      const { roots, from } = ordered(input, input.path), out: CodeSymbol[] = []
      for (const root of roots) for (const hit of await index!.definitions(root, input.name, root === from?.root ? from.relative : undefined)) out.push(absolute(root, hit))
      return out.slice(0, 50)
    },
    async references(input: Context & { name: string; path?: string | undefined }): Promise<Array<{ path: string; relative: string; line: number; caller: string }>> {
      if (!on()) return []
      const { roots, from } = ordered(input, input.path), out: Array<{ path: string; relative: string; line: number; caller: string }> = []
      for (const root of roots) for (const hit of await index!.references(root, input.name, root === from?.root ? from.relative : undefined)) out.push({ path: join(root, hit.path), relative: hit.path, line: hit.line, caller: hit.caller })
      return out.slice(0, 500)
    },
    async status(input: Context): Promise<{ enabled: boolean; roots: RootStatus[] }> {
      if (!on()) return { enabled: false, roots: [] }
      return { enabled: true, roots: await Promise.all(codeRoots(input).map((root) => index!.status(root))) }
    }
  }
}
