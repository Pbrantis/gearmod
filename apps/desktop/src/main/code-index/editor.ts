import { isAbsolute, join, relative, resolve } from 'node:path'
import type { CodeSymbol } from '@gearmod/contracts'
import type { CodeIndexService } from './service'
import type { SymbolHit } from './query'
import type { RootStatus } from './code-index'

/** The part of the service the editor uses (lets tests swap it). */
export type EditorCodeIndex = Pick<CodeIndexService, 'enabled' | 'symbols' | 'outline' | 'definitions' | 'references' | 'status' | 'reindex' | 'forget'>
interface Context { projectId: string; cardId: string | null }

/** Indexed folder that contains the file (the deepest one, if one is inside another) and the path relative to it, with `/`. */
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
 * Editor queries (go to symbol, structure, definition, who uses) over the project's or the card worktree's folders.
 * Paths come in and go out absolute; with the index turned off everything returns empty.
 */
export function editorCodeQueries(index: EditorCodeIndex | undefined, codeRoots: (context: Context) => string[], settings?: { enabled(projectId: string): boolean; setEnabled(projectId: string, enabled: boolean): void }) {
  const on = (context: Context): boolean => Boolean(index?.enabled) && (settings?.enabled(context.projectId) ?? true)
  /** Folders in order: the one of the file being asked from comes first. */
  const ordered = (context: Context, path?: string): { roots: string[]; from: { root: string; relative: string } | null } => {
    const roots = codeRoots(context), from = path ? rootOf(roots, path) : null
    return { roots: from ? [from.root, ...roots.filter((root) => root !== from.root)] : roots, from }
  }
  return {
    async symbols(input: Context & { query: string; limit?: number | undefined }): Promise<CodeSymbol[]> {
      if (!on(input)) return []
      const limit = input.limit ?? 50, out: CodeSymbol[] = []
      for (const root of codeRoots(input)) for (const hit of await index!.symbols(root, input.query, limit)) out.push(absolute(root, hit))
      return out.slice(0, limit)
    },
    async outline(input: Context & { path: string }): Promise<Array<CodeSymbol & { depth: number }>> {
      if (!on(input)) return []
      const from = rootOf(codeRoots(input), input.path)
      if (!from) return []
      return (await index!.outline(from.root, from.relative)).map((hit) => ({ ...absolute(from.root, hit), depth: hit.depth }))
    },
    async definition(input: Context & { name: string; path?: string | undefined }): Promise<CodeSymbol[]> {
      if (!on(input)) return []
      const { roots, from } = ordered(input, input.path), out: CodeSymbol[] = []
      for (const root of roots) for (const hit of await index!.definitions(root, input.name, root === from?.root ? from.relative : undefined)) out.push(absolute(root, hit))
      return out.slice(0, 50)
    },
    async references(input: Context & { name: string; path?: string | undefined }): Promise<Array<{ path: string; relative: string; line: number; caller: string }>> {
      if (!on(input)) return []
      const { roots, from } = ordered(input, input.path), out: Array<{ path: string; relative: string; line: number; caller: string }> = []
      for (const root of roots) for (const hit of await index!.references(root, input.name, root === from?.root ? from.relative : undefined)) out.push({ path: join(root, hit.path), relative: hit.path, line: hit.line, caller: hit.caller })
      return out.slice(0, 500)
    },
    async status(input: Context): Promise<{ enabled: boolean; roots: RootStatus[] }> {
      if (!on(input)) return { enabled: false, roots: [] }
      return { enabled: true, roots: await Promise.all(codeRoots(input).map((root) => index!.status(root))) }
    },
    /** Turns it on or off for the project. Turning off stops watching the folders and deletes their index; turning on indexes again. */
    async setEnabled(input: { projectId: string; enabled: boolean }): Promise<{ enabled: boolean; roots: RootStatus[] }> {
      if (!settings) throw new Error('The code index settings are not available.')
      const context = { projectId: input.projectId, cardId: null }, roots = codeRoots(context)
      settings.setEnabled(input.projectId, input.enabled)
      if (!index) return { enabled: false, roots: [] }
      if (!input.enabled) { for (const root of roots) await index.forget(root); return { enabled: false, roots: [] } }
      return { enabled: true, roots: await Promise.all(roots.map((root) => index.reindex(root))) }
    },
    /** Indexes the project folders now (what did not change is reused); with `root`, only that folder, and the screen calls one at a time to show progress. */
    async reindex(input: { projectId: string; root?: string | undefined }): Promise<{ enabled: boolean; roots: RootStatus[] }> {
      const context = { projectId: input.projectId, cardId: null }
      if (!on(context)) return { enabled: false, roots: [] }
      const all = codeRoots(context)
      if (input.root !== undefined) {
        if (!all.includes(input.root)) throw new Error('This folder does not belong to the project.')
        await index!.reindex(input.root)
        return { enabled: true, roots: await Promise.all(all.map((root) => index!.status(root))) }
      }
      const out: RootStatus[] = []
      for (const root of all) out.push(await index!.reindex(root))
      return { enabled: true, roots: out }
    }
  }
}
