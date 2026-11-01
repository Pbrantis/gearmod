// API do índice de código. Um banco serve várias pastas (checkout principal + worktrees dos cards).
import { watch } from 'node:fs'
import { relative, sep } from 'node:path'
import { openStore, gc } from './store.mjs'
import { indexRoot, updatePaths, ignored } from './indexer.mjs'
import { langOf } from './langs.mjs'
import { Queries } from './query.mjs'

export class CodeIndex {
  constructor(dbFile) {
    this.db = openStore(dbFile)
    this.queries = new Map()
    this.watchers = new Map()
    this.busy = Promise.resolve()
  }

  // serializa escritas (índice completo e atualizações do watcher)
  serial(fn) { const p = this.busy.then(fn, fn); this.busy = p.catch(() => {}); return p }

  index(root, opts = {}) { return this.serial(async () => { const r = await indexRoot(this.db, root, opts); this.queries.delete(root); return r }) }
  update(root, paths, opts = {}) { return this.serial(async () => { const r = await updatePaths(this.db, root, paths, opts); this.queries.delete(root); return r }) }

  q(root) {
    if (!this.queries.has(root)) this.queries.set(root, new Queries(this.db, root))
    return this.queries.get(root)
  }

  // Observa a pasta e atualiza o índice sozinho. onUpdate recebe o resultado de cada lote.
  watch(root, { exclude = [], debounceMs = 300, onUpdate = () => {} } = {}) {
    if (this.watchers.has(root)) return
    let pending = new Set()
    let timer = null
    const flush = () => { const paths = [...pending]; pending = new Set(); timer = null; this.update(root, paths, { exclude }).then(onUpdate, (e) => onUpdate({ error: String(e) })) }
    const w = watch(root, { recursive: true }, (_event, file) => {
      if (!file) return
      const p = String(file).split(sep).join('/')
      if (!langOf(p) || ignored(p, exclude)) return
      pending.add(p)
      clearTimeout(timer)
      timer = setTimeout(flush, debounceMs)
    })
    this.watchers.set(root, w)
  }

  unwatch(root) { this.watchers.get(root)?.close(); this.watchers.delete(root) }
  forget(root) { this.unwatch(root); for (const t of ['trees', 'edges', 'file_edges', 'roots']) this.db.prepare(`delete from ${t} where root = ?`).run(root); gc(this.db); this.queries.delete(root) }
  close() { for (const w of this.watchers.values()) w.close(); this.db.close() }
}

export const relPath = (root, abs) => relative(root, abs).split(sep).join('/')
