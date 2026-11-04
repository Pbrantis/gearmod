import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { HostMessage, HostRequest } from './protocol'
import type { SymbolHit } from './query'
import type { RootStatus } from './code-index'
import { codeToolNames } from './tools'

/** The part of Electron's `utilityProcess` the service uses (lets tests swap it). */
export interface HostProcess { postMessage(message: unknown): void; on(event: 'message', listener: (message: HostMessage) => void): unknown; on(event: 'exit', listener: (code: number) => void): unknown; kill(): boolean }

/**
 * Main-side of the code index. Opens the utility process on first use, indexes each folder once per session
 * (afterwards the watcher keeps it up to date) and answers the agents' tools and the editor's queries.
 */
export class CodeIndexService {
  private child?: HostProcess
  private seq = 0
  private readonly waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  private readonly ready = new Map<string, Promise<void>>()
  private readonly listeners = new Set<(root: string) => void>()

  constructor(private readonly options: { dataDir: string; fork: () => HostProcess; enabled?: () => boolean }) {}

  get enabled(): boolean { return this.options.enabled?.() ?? true }
  isTool(name: string): boolean { return name in codeToolNames }
  onUpdated(listener: (root: string) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  private host(): HostProcess {
    if (this.child) return this.child
    const dir = join(this.options.dataDir, 'code-index')
    mkdirSync(dir, { recursive: true })
    const child = this.options.fork()
    child.on('message', (message) => {
      if ('event' in message) { for (const listener of this.listeners) listener(message.root); return }
      const pending = this.waiting.get(message.id)
      if (!pending) return
      this.waiting.delete(message.id)
      if (message.ok) pending.resolve(message.value); else pending.reject(new Error(message.error))
    })
    child.on('exit', () => {
      // it crashed: whoever was waiting gets an error and the next use opens another process and indexes again
      if (this.child === child) { this.child = undefined; this.ready.clear() }
      for (const pending of this.waiting.values()) pending.reject(new Error('The code index process stopped'))
      this.waiting.clear()
    })
    this.child = child
    void this.send({ op: 'init', dbFile: join(dir, 'index.sqlite') })
    return child
  }

  private send<T>(request: HostRequest): Promise<T> {
    const child = this.host()
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: (value) => resolve(value as T), reject })
      child.postMessage({ id, request })
    })
  }

  /** Ensures the folder is indexed and watched; the first time in a session it indexes (fast when nothing changed). */
  ensure(root: string): Promise<void> {
    let ready = this.ready.get(root)
    if (!ready) {
      ready = (async () => { await this.send({ op: 'index', root }); await this.send({ op: 'watch', root }) })()
      ready.catch(() => this.ready.delete(root))
      this.ready.set(root, ready)
    }
    return ready
  }

  /** Starts indexing in the background (when opening the project, when creating the card's worktree). */
  prewarm(roots: string[]): void { if (this.enabled) for (const root of roots) if (existsSync(root)) void this.ensure(root).catch(() => undefined) }

  /** MCP tool (gearmod_code_*) over the run's folders; with several folders, one section per folder. */
  async tool(name: string, args: Record<string, unknown>, roots: string[]): Promise<string> {
    const tool = codeToolNames[name]
    if (!tool) throw new Error(`Unknown code tool: ${name}`)
    if (!this.enabled) throw new Error('The code index is turned off for this project.')
    const usable = roots.filter((root) => existsSync(root))
    if (!usable.length) throw new Error('This conversation has no project folder to index.')
    const parts: string[] = []
    for (const root of usable) {
      await this.ensure(root)
      const text = await this.send<string>({ op: 'tool', root, tool, args })
      parts.push(usable.length > 1 ? `# ${basename(root)} (${root})\n\n${text}` : text)
    }
    return parts.join('\n\n')
  }

  async status(root: string): Promise<RootStatus> { return this.send<RootStatus>({ op: 'status', root }) }
  async symbols(root: string, query: string, limit?: number): Promise<SymbolHit[]> { await this.ensure(root); return this.send({ op: 'symbols', root, query, limit }) }
  async outline(root: string, file: string): Promise<Array<SymbolHit & { depth: number }>> { await this.ensure(root); return this.send({ op: 'outline', root, file }) }
  async definitions(root: string, name: string, from?: string): Promise<SymbolHit[]> { await this.ensure(root); return this.send({ op: 'definitions', root, name, from }) }
  async references(root: string, name: string, from?: string): Promise<Array<{ path: string; line: number; caller: string }>> { await this.ensure(root); return this.send({ op: 'references', root, name, from }) }

  /** Indexes again now (project screen button); reuses what did not change, so it is usually fast. */
  async reindex(root: string): Promise<RootStatus> {
    this.ready.delete(root)
    await this.ensure(root)
    return this.status(root)
  }

  /** The folder left (worktree removed): stops watching and deletes what only it used. */
  async forget(root: string): Promise<void> {
    this.ready.delete(root)
    if (this.child) await this.send({ op: 'forget', root })
  }

  dispose(): void { this.child?.kill(); this.child = undefined; this.ready.clear() }
}
