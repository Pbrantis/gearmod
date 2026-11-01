import { existsSync, watch, type FSWatcher } from 'node:fs'
import { sep } from 'node:path'
import { gc, openStore, type Db } from './store'
import { ignored, indexRoot, updatePaths, type IndexResult, type UpdateResult } from './indexer'
import { langOf } from './languages'
import { Queries } from './query'

export interface RootStatus { root: string; files: number; symbols: number; indexedAt: number | null; ms: number | null }

/**
 * Índice de código de várias pastas (projeto e worktrees dos cards) num banco só. As escritas são feitas uma de cada
 * vez; as consultas podem chegar no meio (o indexador cede a vez de tempos em tempos).
 */
export class CodeIndex {
  readonly db: Db
  private readonly queries = new Map<string, Queries>()
  private readonly watchers = new Map<string, FSWatcher>()
  private busy: Promise<unknown> = Promise.resolve()

  constructor(file: string) {
    this.db = openStore(file)
    // pastas que sumiram (worktrees de cards já removidas) saem do índice ao abrir
    const gone = (this.db.prepare('select root from roots').pluck().all() as string[]).filter((root) => !existsSync(root))
    for (const root of gone) for (const table of ['trees', 'edges', 'file_edges', 'roots']) this.db.prepare(`delete from ${table} where root = ?`).run(root)
    if (gone.length) gc(this.db)
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.busy.then(work, work)
    this.busy = next.catch(() => undefined)
    return next
  }

  index(root: string, options: { exclude?: string[] } = {}): Promise<IndexResult> {
    return this.serial(async () => { const result = await indexRoot(this.db, root, options); this.queries.delete(root); return result })
  }

  update(root: string, paths: string[], options: { exclude?: string[] } = {}): Promise<UpdateResult> {
    return this.serial(async () => { const result = await updatePaths(this.db, root, paths, options); this.queries.delete(root); return result })
  }

  has(root: string): boolean { return this.db.prepare('select 1 from roots where root = ?').get(root) !== undefined }

  q(root: string): Queries {
    let queries = this.queries.get(root)
    if (!queries) { queries = new Queries(this.db, root); this.queries.set(root, queries) }
    return queries
  }

  status(root: string): RootStatus {
    const row = this.db.prepare('select indexed_at, ms from roots where root = ?').get(root) as { indexed_at: number; ms: number } | undefined
    // contado na hora: as atualizações do watcher não mexem no total gravado na indexação completa
    const files = row ? this.db.prepare('select count(*) from trees where root = ?').pluck().get(root) as number : 0
    const symbols = row ? this.db.prepare('select count(*) from symbols s join trees t on t.sha = s.sha and t.root = ? where s.idx > 0').pluck().get(root) as number : 0
    return { root, files, symbols, indexedAt: row?.indexed_at ?? null, ms: row?.ms ?? null }
  }

  /** Observa a pasta e atualiza o índice sozinho (lotes de 300 ms). */
  watch(root: string, { exclude = [], onUpdate }: { exclude?: string[]; onUpdate?: (result: UpdateResult | { error: string }) => void } = {}): void {
    if (this.watchers.has(root)) return
    let pending = new Set<string>()
    let timer: NodeJS.Timeout | undefined
    const flush = (): void => {
      const paths = [...pending]
      pending = new Set()
      timer = undefined
      this.update(root, paths, { exclude }).then((result) => onUpdate?.(result), (error: unknown) => onUpdate?.({ error: String(error) }))
    }
    try {
      const watcher = watch(root, { recursive: true }, (_event, file) => {
        if (!file) return
        const path = String(file).split(sep).join('/')
        if (!langOf(path) || ignored(path, exclude)) return
        pending.add(path)
        clearTimeout(timer)
        timer = setTimeout(flush, 300)
      })
      watcher.on('error', () => this.unwatch(root))
      this.watchers.set(root, watcher)
    } catch { /* pasta sumiu ou o sistema não deixa observar: o índice só atualiza na próxima indexação */ }
  }

  unwatch(root: string): void { this.watchers.get(root)?.close(); this.watchers.delete(root) }

  /** Esquece a pasta (worktree removida) e apaga a análise que ninguém mais usa. */
  forget(root: string): Promise<void> {
    return this.serial(async () => {
      this.unwatch(root)
      for (const table of ['trees', 'edges', 'file_edges', 'roots']) this.db.prepare(`delete from ${table} where root = ?`).run(root)
      gc(this.db)
      this.queries.delete(root)
    })
  }

  close(): void { for (const watcher of this.watchers.values()) watcher.close(); this.watchers.clear(); this.db.close() }
}
