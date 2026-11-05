// Gets the repositories of config/repos.json at their pinned commit into bench-data/work/repos/, makes the separate copies
// for tools that write into the project (tools.json copy: true) and records size statistics.
//   node bench/prepare.mjs                 all repositories
//   node bench/prepare.mjs gearmod,bit     some of them
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { BENCH, WORK, args, list, readJson, run, slug, stripCheckout, writeJson } from './lib/util.mjs'

const opt = args()
const repos = readJson(join(BENCH, 'config', 'repos.json')).repos
const tools = readJson(join(BENCH, 'config', 'tools.json')).tools
const wanted = list(opt._[0])
const copyTools = Object.entries(tools).filter(([, tool]) => tool.copy).map(([id]) => id)
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'target', 'bin', 'obj', '.venv', 'venv', '__pycache__', 'vendor', '.codegraph'])
const SOURCE = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.java', '.cs', '.rs', '.php', '.rb', '.c', '.h', '.cc', '.cpp', '.hpp'])

async function git(cwd, argv) {
  const res = await run('git', ['-c', 'advice.detachedHead=false', ...argv], { cwd, timeoutMs: 60 * 60 * 1000 })
  if (res.code !== 0) throw new Error(`git ${argv.join(' ')}: ${res.stderr.trim()}`)
  return res.stdout.trim()
}

async function fetchRepo(repo, dir) {
  if (existsSync(join(dir, '.git'))) {
    const head = await git(dir, ['rev-parse', 'HEAD']).catch(() => '')
    if (head && (!repo.commit || head.startsWith(repo.commit))) { strip(repo, dir); return head }
  }
  mkdirSync(dir, { recursive: true })
  await git(dir, ['init', '-q'])
  await git(dir, ['remote', 'remove', 'origin']).catch(() => {})
  await git(dir, ['remote', 'add', 'origin', repo.url])
  const ref = repo.commit ?? repo.tag
  if (!ref) throw new Error(`${repo.id}: give a commit or a tag`)
  try {
    await git(dir, ['fetch', '-q', '--depth', '1', 'origin', repo.commit ? repo.commit : `refs/tags/${repo.tag}`])
    await git(dir, ['checkout', '-q', '--detach', 'FETCH_HEAD'])
  } catch {
    // servers (and local paths) that do not let a shallow fetch ask for a commit by sha: fetch everything
    await git(dir, ['fetch', '-q', '--tags', 'origin'])
    await git(dir, ['checkout', '-q', '--detach', repo.commit ?? `refs/tags/${repo.tag}`])
  }
  strip(repo, dir)
  return git(dir, ['rev-parse', 'HEAD'])
}

function strip(repo, dir) {
  const removed = stripCheckout(repo, dir)
  if (removed.length) console.log(`  removed agent instruction files: ${removed.join(', ')}`)
}

function copyFolder(from, to) {
  cpSync(from, to, { recursive: true, filter: (path) => !SKIP.has(path.split(/[\\/]/).at(-1)) || path === from })
}

async function stats(dir) {
  let files = []
  try { files = (await git(dir, ['ls-files'])).split('\n') } catch {
    const { readdirSync, statSync } = await import('node:fs')
    const walk = (folder, prefix = '') => { for (const name of readdirSync(folder)) { if (SKIP.has(name)) continue; const path = join(folder, name); if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`); else files.push(`${prefix}${name}`) } }
    walk(dir)
  }
  const byExt = {}
  let lines = 0
  for (const file of files) {
    const ext = extname(file).toLowerCase()
    if (!SOURCE.has(ext) || file.split('/').some((part) => SKIP.has(part)) || !existsSync(join(dir, file))) continue
    byExt[ext] = (byExt[ext] ?? 0) + 1
    try { lines += readFileSync(join(dir, file), 'utf8').split('\n').length } catch { /* unreadable */ }
  }
  return { sourceFiles: Object.values(byExt).reduce((a, b) => a + b, 0), sourceLines: lines, byExt }
}

const statsFile = join(WORK, 'repo-stats.json')
const all = existsSync(statsFile) ? readJson(statsFile) : {}
for (const repo of repos.filter((item) => !wanted.length || wanted.includes(item.id))) {
  console.log(`== ${repo.id}`)
  let dir
  let head = null
  if (repo.parts) {
    // a project split in several Git repositories (back + front): each one at its pinned commit, side by side
    dir = join(WORK, 'repos', repo.id)
    const heads = {}
    for (const [name, part] of Object.entries(repo.parts)) {
      const source = resolve(BENCH, part.path)
      if (!existsSync(source)) throw new Error(`${repo.id}: missing ${source}`)
      heads[name] = await fetchRepo({ ...repo, strip: part.strip ?? [], url: source, commit: part.commit ?? await git(source, ['rev-parse', 'HEAD']) }, join(dir, name))
      if (part.commit && !heads[name].startsWith(part.commit)) throw new Error(`${repo.id}/${name}: expected ${part.commit}, got ${heads[name]}`)
    }
    head = null
    console.log(`  parts: ${Object.entries(heads).map(([name, sha]) => `${name}@${sha.slice(0, 12)}`).join(' ')}`)
  } else if (repo.path) {
    // local folders are copied first: nothing is ever deleted from the original
    const source = resolve(BENCH, repo.path)
    if (!existsSync(source)) { console.log(`  missing local folder ${source}; skipped`); continue }
    dir = join(WORK, 'repos', repo.id)
    const sourceHead = await git(source, ['rev-parse', 'HEAD']).catch(() => null)
    if (sourceHead) head = await fetchRepo({ ...repo, url: source, commit: repo.commit ?? sourceHead }, dir)
    else {
      if (!existsSync(dir)) { copyFolder(source, dir); console.log(`  copied from ${source} (no Git)`) }
      strip(repo, dir)
    }
  } else {
    dir = join(WORK, 'repos', repo.id)
    head = await fetchRepo(repo, dir)
  }
  console.log(`  ${dir} @ ${head ?? '(no git)'}`)
  for (const toolId of copyTools) {
    const copy = join(WORK, 'copies', slug(toolId), repo.id)
    if (existsSync(copy)) continue
    mkdirSync(join(WORK, 'copies', slug(toolId)), { recursive: true })
    if (head) { await git(join(WORK, 'copies', slug(toolId)), ['clone', '-q', '--shared', dir, repo.id]); await git(copy, ['checkout', '-q', '--detach', head]); strip(repo, copy) }
    else { copyFolder(dir, copy); strip(repo, copy) }
    console.log(`  copy for ${toolId}: ${copy}`)
  }
  let measured
  if (repo.parts) {
    // each part is its own Git repository: count them one by one and add up
    measured = { sourceFiles: 0, sourceLines: 0, byExt: {} }
    for (const name of Object.keys(repo.parts)) {
      const part = await stats(join(dir, name))
      measured.sourceFiles += part.sourceFiles
      measured.sourceLines += part.sourceLines
      for (const [ext, count] of Object.entries(part.byExt)) measured.byExt[ext] = (measured.byExt[ext] ?? 0) + count
    }
  } else measured = await stats(dir)
  all[repo.id] = { head, ...measured, at: new Date().toISOString() }
  console.log(`  ${all[repo.id].sourceFiles} source files, ${all[repo.id].sourceLines} lines`)
}
writeJson(statsFile, all)
console.log(`stats in ${statsFile}`)
