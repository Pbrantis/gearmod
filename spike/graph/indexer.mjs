// Descobre os arquivos de uma pasta, extrai os blobs que ainda não estão no banco (em workers) e liga tudo.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'
import { langOf } from './langs.mjs'
import { extract } from './extract.mjs'
import { writer, gc } from './store.mjs'
import { link, LINKER_VERSION } from './resolve.mjs'

export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.next', '.nuxt', '.turbo', '.cache', '.codegraph', 'target', 'bin', 'obj', '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', 'vendor', '.idea', '.vscode', '.gradle', 'Pods', '.dart_tool'])
const MANIFEST = /(^|\/)(package\.json|[jt]sconfig[^/]*\.json|go\.mod|Cargo\.toml|composer\.json|pyproject\.toml)$/
const MAX_BYTES = 1_000_000

export const gitSha = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')
const toPosix = (p) => p.split(sep).join('/')

export function ignored(path, exclude = []) {
  const parts = path.split('/')
  for (let i = 0; i < parts.length - 1; i++) if (IGNORED_DIRS.has(parts[i])) return true
  return exclude.some((e) => path === e || path.startsWith(e.endsWith('/') ? e : e + '/'))
}

function isGit(root) {
  try { return execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0 } catch { return false }
}

// path -> sha (null = precisa calcular a partir do disco)
// pastas geradas por ferramentas conhecidas, só na raiz do projeto delas
function generatedRoots(root) {
  const has = (p) => existsSync(join(root, p))
  const out = []
  if (has('Assets') && has('ProjectSettings')) out.push('Library', 'Temp', 'Logs', 'UserSettings', 'Build', 'Builds', 'MemoryCaptures') // Unity
  if (has('project.godot')) out.push('.godot', '.import') // Godot
  if (existsSync(root) && readdirSync(root).some((f) => f.endsWith('.uproject'))) out.push('Binaries', 'Intermediate', 'Saved', 'DerivedDataCache') // Unreal
  return out
}

export function listFiles(root, exclude = []) {
  exclude = [...exclude, ...generatedRoots(root)]
  const files = new Map()
  const manifests = []
  const keep = (p) => !ignored(p, exclude)
  // pasta dentro de um repositório que a ignora: o Git não lista nada, então percorre as pastas
  let useGit = isGit(root)
  if (useGit) { try { useGit = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 1 << 30 }).length > 0 } catch { useGit = false } }
  if (useGit) {
    const git = (args) => execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 1 << 30 }).split('\0').filter(Boolean)
    for (const line of git(['ls-files', '-s', '-z'])) {
      const tab = line.indexOf('\t')
      const [mode, sha] = line.slice(0, tab).split(' ')
      const p = line.slice(tab + 1)
      if (mode === '160000' || !keep(p)) continue
      if (MANIFEST.test(p)) manifests.push(p)
      if (langOf(p)) files.set(p, sha)
    }
    for (const p of git(['ls-files', '-d', '-z'])) files.delete(p)
    for (const p of git(['ls-files', '-m', '-o', '--exclude-standard', '-z'])) {
      if (!keep(p)) continue
      if (MANIFEST.test(p) && !manifests.includes(p)) manifests.push(p)
      if (langOf(p) && existsSync(join(root, p))) files.set(p, null)
    }
  } else {
    const walk = (dir) => {
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.isDirectory()) { if (!IGNORED_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name)) }
        else {
          const p = toPosix(relative(root, join(dir, e.name)))
          if (!keep(p)) continue
          if (MANIFEST.test(p)) manifests.push(p)
          if (langOf(p)) files.set(p, null)
        }
      }
    }
    walk(root)
  }
  return { files, manifests }
}

// ---- pool de workers ---------------------------------------------------------------------------------------------

class Pool {
  constructor(size) {
    this.workers = Array.from({ length: size }, () => new Worker(new URL('./worker.mjs', import.meta.url)))
    this.free = [...this.workers]
    this.queue = []
    this.seq = 0
    this.waiting = new Map()
    for (const w of this.workers) w.on('message', ({ id, out }) => { const done = this.waiting.get(id); this.waiting.delete(id); this.free.push(w); done(out); this.pump() })
  }
  run(jobs) { return new Promise((resolve) => { this.queue.push({ jobs, resolve }); this.pump() }) }
  pump() {
    while (this.free.length && this.queue.length) {
      const w = this.free.pop()
      const { jobs, resolve } = this.queue.shift()
      const id = ++this.seq
      this.waiting.set(id, resolve)
      w.postMessage({ id, jobs })
    }
  }
  close() { for (const w of this.workers) w.terminate() }
}

async function parseAll(jobs, onResult, { workers } = {}) {
  if (!jobs.length) return
  const size = Math.max(1, Math.min(workers ?? Math.max(1, cpus().length - 1), 8, Math.ceil(jobs.length / 40)))
  if (size === 1 || jobs.length < 40) {
    for (const j of jobs) {
      try { onResult({ sha: j.sha, lang: j.lang, x: await extract(j.lang, j.src ?? readFileSync(j.file, 'utf8')) }) } catch (e) { onResult({ sha: j.sha, lang: j.lang, error: String(e) }) }
    }
    return
  }
  const pool = new Pool(size)
  const batch = 20
  const tasks = []
  for (let i = 0; i < jobs.length; i += batch) tasks.push(pool.run(jobs.slice(i, i + batch)).then((out) => out.forEach(onResult)))
  await Promise.all(tasks)
  pool.close()
}

const EMPTY = { lines: 0, symbols: [{ name: '', qname: '', kind: 'file', parent: -1, line: 1, end: 1, signature: '', doc: null, exported: 1 }], imports: [], refs: [], binds: [], heritage: [], defaultExport: null }

function readable(root, path) {
  const full = join(root, path)
  try {
    const st = statSync(full)
    if (!st.isFile() || st.size > MAX_BYTES) return null
    const buf = readFileSync(full)
    // minificado: linhas enormes
    const head = buf.subarray(0, 4096).toString('utf8')
    if (head.length >= 4096 && !head.includes('\n')) return null
    return buf
  } catch { return null }
}

// Indexa a pasta inteira (só o que mudou é processado de novo).
export async function indexRoot(db, root, { exclude = [], workers, log = () => {} } = {}) {
  const t0 = Date.now()
  const { files, manifests } = listFiles(root, exclude)
  const t1 = Date.now()
  const known = new Set(db.prepare('select sha from blobs').all().map((r) => r.sha))
  const jobs = []
  const final = new Map()
  for (let [path, sha] of files) {
    let src = null
    if (!sha) { const buf = readable(root, path); if (!buf) continue; sha = gitSha(buf); src = buf.toString('utf8') }
    final.set(path, sha)
    if (known.has(sha)) continue
    known.add(sha)
    jobs.push({ sha, lang: langOf(path), file: join(root, path), src })
  }
  const write = writer(db)
  let errors = 0
  let writeMs = 0
  db.exec('begin')
  await parseAll(jobs, (r) => { if (r.error) errors++; const w = performance.now(); write(r.sha, r.lang, r.x ?? EMPTY); writeMs += performance.now() - w }, { workers })
  const t2 = Date.now()
  if (process.env.GRAPH_DEBUG) console.error('[indexer] parse+escrita', t2 - t1, 'ms, só escrita', Math.round(writeMs), 'ms')
  const before = new Map(db.prepare('select path, sha from trees where root = ?').all(root).map((r) => [r.path, r.sha]))
  const linkerOk = db.prepare(`select value from meta where key = 'linker'`).get()?.value === String(LINKER_VERSION)
  const same = linkerOk && before.size === final.size && [...final].every(([p, s]) => before.get(p) === s) && db.prepare('select 1 from edges where root = ? limit 1').get(root)
  if (same) {
    db.exec('commit')
    db.prepare('update roots set indexed_at = ? where root = ?').run(Date.now(), root)
    const r = { files: final.size, parsed: 0, reused: final.size, errors, edges: null, listMs: t1 - t0, parseMs: t2 - t1, linkMs: 0, unchanged: true, ms: Date.now() - t0 }
    log(r)
    return r
  }
  db.prepare('delete from trees where root = ?').run(root)
  const insT = db.prepare('insert into trees(root, path, sha, lang) values (?,?,?,?)')
  for (const [p, sha] of final) insT.run(root, p, sha, langOf(p))
  db.prepare('insert or replace into roots(root, indexed_at, manifests, files, ms) values (?,?,?,?,?)').run(root, Date.now(), JSON.stringify(manifests), final.size, 0)
  db.exec('commit')
  const linked = link(db, root)
  db.prepare(`insert or replace into meta(key, value) values ('linker', ?)`).run(String(LINKER_VERSION))
  const removed = gc(db)
  const ms = Date.now() - t0
  db.prepare('update roots set ms = ? where root = ?').run(ms, root)
  const r = { files: final.size, parsed: jobs.length, reused: final.size - jobs.length, errors, edges: linked.edges, listMs: t1 - t0, parseMs: t2 - t1, linkMs: linked.ms, gcBlobs: removed, ms }
  log(r)
  return r
}

// Atualiza caminhos específicos (vindos do watcher). Caminhos relativos à pasta, com '/'.
export async function updatePaths(db, root, paths, { exclude = [] } = {}) {
  const t0 = Date.now()
  const getT = db.prepare('select sha from trees where root = ? and path = ?')
  const known = db.prepare('select 1 from blobs where sha = ?')
  const oldNames = []
  const changed = []
  const jobs = []
  const upserts = []
  const deletes = []
  for (const path of new Set(paths)) {
    if (!langOf(path) || ignored(path, exclude)) continue
    const before = getT.get(root, path)?.sha ?? null
    const buf = existsSync(join(root, path)) ? readable(root, path) : null
    const sha = buf ? gitSha(buf) : null
    if (sha === before) continue
    if (before) for (const s of db.prepare('select name from symbols where sha = ? and idx > 0').all(before)) oldNames.push(s.name)
    changed.push(path)
    if (!sha) { deletes.push(path); continue }
    upserts.push([path, sha])
    if (!known.get(sha) && !jobs.some((j) => j.sha === sha)) jobs.push({ sha, lang: langOf(path), src: buf.toString('utf8') })
  }
  if (!changed.length) return { changed: 0, ms: Date.now() - t0 }
  const write = writer(db)
  db.exec('begin')
  await parseAll(jobs, (r) => write(r.sha, r.lang, r.x ?? EMPTY))
  const ins = db.prepare('insert or replace into trees(root, path, sha, lang) values (?,?,?,?)')
  for (const [p, sha] of upserts) ins.run(root, p, sha, langOf(p))
  const del = db.prepare('delete from trees where root = ? and path = ?')
  for (const p of deletes) del.run(root, p)
  db.exec('commit')
  const linked = link(db, root, { changed, oldNames })
  return { changed: changed.length, parsed: jobs.length, relinkedFiles: linked.files, edges: linked.edges, ms: Date.now() - t0 }
}
