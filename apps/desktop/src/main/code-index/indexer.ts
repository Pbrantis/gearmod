import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { langOf } from './languages'
import { extract, type Extraction } from './extract'
import { gc, writer, type Db } from './store'
import { link, LINKER_VERSION } from './resolve'

/** Pastas que nunca entram no índice, em qualquer nível. */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.next', '.nuxt', '.turbo', '.cache', '.codegraph', 'target', 'bin', 'obj', '__pycache__', '.venv', 'venv', 'env', '.tox', '.mypy_cache', '.pytest_cache', 'vendor', '.idea', '.vscode', '.gradle', 'Pods', '.dart_tool'])
const MANIFEST = /(^|\/)(package\.json|[jt]sconfig[^/]*\.json|go\.mod|Cargo\.toml|composer\.json|pyproject\.toml)$/
const MAX_BYTES = 1_000_000

/** O mesmo sha do Git para o conteúdo (`git hash-object`), então arquivos iguais em worktrees diferentes batem. */
export const gitSha = (content: Buffer): string => createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
const toPosix = (path: string): string => path.split(sep).join('/')
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

export function ignored(path: string, exclude: string[] = []): boolean {
  const parts = path.split('/')
  for (let i = 0; i < parts.length - 1; i++) if (IGNORED_DIRS.has(parts[i]!)) return true
  return exclude.some((item) => path === item || path.startsWith(item.endsWith('/') ? item : `${item}/`))
}

function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
}

/** Pastas geradas por ferramentas conhecidas, na raiz do projeto delas (valem mesmo sem Git). */
function generatedRoots(root: string): string[] {
  const has = (path: string): boolean => existsSync(join(root, path))
  const out: string[] = []
  if (has('Assets') && has('ProjectSettings')) out.push('Library', 'Temp', 'Logs', 'UserSettings', 'Build', 'Builds', 'MemoryCaptures') // Unity
  if (has('project.godot')) out.push('.godot', '.import') // Godot
  try { if (readdirSync(root).some((file) => file.endsWith('.uproject'))) out.push('Binaries', 'Intermediate', 'Saved', 'DerivedDataCache') } catch { /* pasta sumiu */ } // Unreal
  return out
}

/** Arquivos da pasta com o sha do Git quando ele já é conhecido (null = calcular a partir do disco). */
export function listFiles(root: string, exclude: string[] = []): { files: Map<string, string | null>; manifests: string[] } {
  const excluded = [...exclude, ...generatedRoots(root)]
  const files = new Map<string, string | null>()
  const manifests = new Set<string>()
  const keep = (path: string): boolean => !ignored(path, excluded)
  // pasta dentro de um repositório que a ignora: o Git não lista nada, então percorre as pastas
  let useGit = false
  try { useGit = git(root, ['ls-files', '-co', '--exclude-standard', '-z']).length > 0 } catch { useGit = false }
  if (useGit) {
    const list = (args: string[]): string[] => git(root, args).split('\0').filter(Boolean)
    for (const line of list(['ls-files', '-s', '-z'])) {
      const tab = line.indexOf('\t')
      const [mode, sha] = line.slice(0, tab).split(' ')
      const path = line.slice(tab + 1)
      if (mode === '160000' || !keep(path)) continue
      if (MANIFEST.test(path)) manifests.add(path)
      if (langOf(path) && sha) files.set(path, sha)
    }
    for (const path of list(['ls-files', '-d', '-z'])) files.delete(path)
    for (const path of list(['ls-files', '-m', '-o', '--exclude-standard', '-z'])) {
      if (!keep(path)) continue
      if (MANIFEST.test(path)) manifests.add(path)
      if (langOf(path) && existsSync(join(root, path))) files.set(path, null)
    }
  } else {
    const walk = (dir: string): void => {
      let entries
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const path = toPosix(relative(root, join(dir, entry.name)))
        if (entry.isDirectory()) { if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith('.') && keep(`${path}/x`)) walk(join(dir, entry.name)) }
        else if (keep(path)) {
          if (MANIFEST.test(path)) manifests.add(path)
          if (langOf(path)) files.set(path, null)
        }
      }
    }
    walk(root)
  }
  return { files, manifests: [...manifests] }
}

function readable(root: string, path: string): Buffer | null {
  try {
    const full = join(root, path)
    const info = statSync(full)
    if (!info.isFile() || info.size > MAX_BYTES) return null
    const content = readFileSync(full)
    // minificado: a primeira linha já tem mais de 4 KB
    const head = content.subarray(0, 4096).toString('utf8')
    if (head.length >= 4096 && !head.includes('\n')) return null
    return content
  } catch { return null }
}

const EMPTY: Extraction = { lines: 0, symbols: [{ name: '', qname: '', kind: 'file', parent: -1, line: 1, end: 1, signature: '', doc: null, exported: true, owner: null }], imports: [], refs: [], binds: [], heritage: [], defaultExport: null }

interface Job { sha: string; lang: string; path: string; src: string | null }

/** Parse um a um, cedendo a vez de tempos em tempos para o processo responder consultas no meio. */
async function parseAll(root: string, jobs: Job[], onResult: (job: Job, extraction: Extraction, failed: boolean) => void): Promise<void> {
  for (const [i, job] of jobs.entries()) {
    let extraction = EMPTY, failed = false
    try { extraction = await extract(job.lang, job.src ?? readFileSync(join(root, job.path), 'utf8')) } catch { failed = true }
    onResult(job, extraction, failed)
    if (i % 20 === 19) await tick()
  }
}

export interface IndexResult { files: number; parsed: number; reused: number; errors: number; edges: number | null; unchanged: boolean; ms: number }

/** Indexa a pasta inteira; só os blobs ainda não vistos são analisados de novo. */
export async function indexRoot(db: Db, root: string, { exclude = [] }: { exclude?: string[] } = {}): Promise<IndexResult> {
  const started = Date.now()
  const { files, manifests } = listFiles(root, exclude)
  const known = new Set(db.prepare('select sha from blobs').pluck().all() as string[])
  const jobs: Job[] = []
  const final = new Map<string, string>()
  for (const [path, listed] of files) {
    let sha = listed, src: string | null = null
    if (!sha) { const content = readable(root, path); if (!content) continue; sha = gitSha(content); src = content.toString('utf8') }
    final.set(path, sha)
    if (known.has(sha)) continue
    known.add(sha)
    jobs.push({ sha, lang: langOf(path)!, path, src })
  }
  const write = writer(db)
  let errors = 0
  // várias transações pequenas: as consultas que chegam no meio não esperam o projeto inteiro
  let pending = 0
  db.exec('begin')
  await parseAll(root, jobs, (job, extraction, failed) => {
    if (failed) errors++
    write(job.sha, job.lang, extraction)
    if (++pending >= 200) { db.exec('commit'); db.exec('begin'); pending = 0 }
  })
  db.exec('commit')
  const before = new Map((db.prepare('select path, sha from trees where root = ?').all(root) as Array<{ path: string; sha: string }>).map((row) => [row.path, row.sha]))
  const linkerOk = db.prepare(`select value from meta where key = 'linker'`).pluck().get() === String(LINKER_VERSION)
  const same = linkerOk && before.size === final.size && [...final].every(([path, sha]) => before.get(path) === sha) && db.prepare('select 1 from edges where root = ? limit 1').get(root) !== undefined
  if (same) {
    db.prepare('update roots set indexed_at = ? where root = ?').run(Date.now(), root)
    return { files: final.size, parsed: 0, reused: final.size, errors, edges: null, unchanged: true, ms: Date.now() - started }
  }
  db.transaction(() => {
    db.prepare('delete from trees where root = ?').run(root)
    const insert = db.prepare('insert into trees(root, path, sha, lang) values (?,?,?,?)')
    for (const [path, sha] of final) insert.run(root, path, sha, langOf(path))
    db.prepare('insert or replace into roots(root, indexed_at, manifests, files, ms) values (?,?,?,?,?)').run(root, Date.now(), JSON.stringify(manifests), final.size, 0)
  })()
  const linked = link(db, root)
  db.prepare(`insert or replace into meta(key, value) values ('linker', ?)`).run(String(LINKER_VERSION))
  gc(db)
  const ms = Date.now() - started
  db.prepare('update roots set ms = ? where root = ?').run(ms, root)
  return { files: final.size, parsed: jobs.length, reused: final.size - jobs.length, errors, edges: linked.edges, unchanged: false, ms }
}

export interface UpdateResult { changed: number; parsed: number; ms: number }

/** Atualiza caminhos específicos (vindos do watcher), relativos à pasta e com '/'. */
export async function updatePaths(db: Db, root: string, paths: Iterable<string>, { exclude = [] }: { exclude?: string[] } = {}): Promise<UpdateResult> {
  const started = Date.now()
  const current = db.prepare('select sha from trees where root = ? and path = ?').pluck()
  const known = db.prepare('select 1 from blobs where sha = ?')
  const namesOf = db.prepare('select name from symbols where sha = ? and idx > 0').pluck()
  const oldNames: string[] = [], changed: string[] = [], jobs: Job[] = [], upserts: Array<[string, string]> = [], deletes: string[] = []
  for (const path of new Set(paths)) {
    const lang = langOf(path)
    if (!lang || ignored(path, exclude)) continue
    const before = (current.get(root, path) as string | undefined) ?? null
    const content = existsSync(join(root, path)) ? readable(root, path) : null
    const sha = content ? gitSha(content) : null
    if (sha === before) continue
    if (before) oldNames.push(...(namesOf.all(before) as string[]))
    changed.push(path)
    if (!sha || !content) { deletes.push(path); continue }
    upserts.push([path, sha])
    if (!known.get(sha) && !jobs.some((job) => job.sha === sha)) jobs.push({ sha, lang, path, src: content.toString('utf8') })
  }
  if (!changed.length) return { changed: 0, parsed: 0, ms: Date.now() - started }
  const write = writer(db)
  const results: Array<[Job, Extraction]> = []
  await parseAll(root, jobs, (job, extraction) => results.push([job, extraction]))
  db.transaction(() => {
    for (const [job, extraction] of results) write(job.sha, job.lang, extraction)
    const insert = db.prepare('insert or replace into trees(root, path, sha, lang) values (?,?,?,?)')
    for (const [path, sha] of upserts) insert.run(root, path, sha, langOf(path))
    const remove = db.prepare('delete from trees where root = ? and path = ?')
    for (const path of deletes) remove.run(root, path)
  })()
  link(db, root, { changed, oldNames })
  return { changed: changed.length, parsed: jobs.length, ms: Date.now() - started }
}
