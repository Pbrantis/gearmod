// Indexing performance per repository (no agents, no cost): the data for the scaling curve and the break-even point.
//   node bench/perf.mjs                  every prepared repository
//   node bench/perf.mjs typedoc,gitea --codegraph --repeat 3
// For each repository, with a fresh database each repetition:
//   cold     index from zero
//   warm     index again with nothing changed
//   worktree index a second Git worktree of the same commit into the same database (the blob cache at work)
//   edit     change one source file in that worktree and index again (what the watcher does after a save)
// --codegraph also times `codegraph init` on a fresh copy (its cold indexing).
// Output: bench-data/results/_perf/perf.jsonl (one line per measure).
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BENCH, ELECTRON, RESULTS, SERVER, WORK, args, appendJsonl, list, readJson, run, runResolved, stripCheckout } from './lib/util.mjs'

const opt = args()
const repos = Object.fromEntries(readJson(join(BENCH, 'config', 'repos.json')).repos.map((repo) => [repo.id, repo]))
const stats = existsSync(join(WORK, 'repo-stats.json')) ? readJson(join(WORK, 'repo-stats.json')) : {}
const ids = list(opt._[0]).length ? list(opt._[0]) : Object.keys(stats)
const repeat = Number(opt.repeat ?? 1)
const out = join(RESULTS, '_perf', 'perf.jsonl')
const tmp = join(WORK, 'perf')
mkdirSync(tmp, { recursive: true })

async function index(root, db) {
  const res = await run(ELECTRON, [SERVER, 'index'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BENCH_ROOT: root, BENCH_DB: db } })
  if (res.code !== 0) throw new Error(res.stderr.slice(-500))
  const value = JSON.parse(res.stdout.trim().split('\n').at(-1))
  return { wallMs: res.ms, ...value }
}

for (const id of ids) {
  const root = join(WORK, 'repos', id)
  if (!existsSync(root)) { console.log(`${id}: not prepared, skipped`); continue }
  for (let rep = 1; rep <= repeat; rep++) {
    const db = join(tmp, `${id}.sqlite`)
    for (const suffix of ['', '-wal', '-shm']) rmSync(db + suffix, { force: true })
    const base = { repo: id, rep, repoFiles: stats[id]?.sourceFiles ?? null, repoLines: stats[id]?.sourceLines ?? null, at: new Date().toISOString() }
    const cold = await index(root, db)
    appendJsonl(out, { ...base, measure: 'cold', ...cold, dbBytes: readFileSync(db).length })
    const warm = await index(root, db)
    appendJsonl(out, { ...base, measure: 'warm', ...warm })
    // a second worktree of the same commit, as GearMod makes for each card
    const wt = join(tmp, `${id}-wt`)
    await run('git', ['-C', root, 'worktree', 'remove', '--force', wt])
    const added = await run('git', ['-C', root, 'worktree', 'add', '--detach', '--force', wt, 'HEAD'])
    if (added.code === 0) {
      stripCheckout(repos[id] ?? {}, wt)
      const second = await index(wt, db)
      appendJsonl(out, { ...base, measure: 'worktree', ...second })
      const files = (await run('git', ['-C', wt, 'ls-files', '*.ts', '*.py', '*.go', '*.java', '*.cs', '*.rs', '*.php', '*.rb'])).stdout.split('\n').filter(Boolean)
      const target = files[Math.floor(files.length / 2)]
      if (target) {
        appendFileSync(join(wt, target), '\n// bench: one edited line\n')
        const edit = await index(wt, db)
        appendJsonl(out, { ...base, measure: 'edit', file: target, ...edit })
      }
      await run('git', ['-C', root, 'worktree', 'remove', '--force', wt])
    }
    if (opt.codegraph) {
      const copy = join(tmp, `${id}-cg`)
      rmSync(copy, { recursive: true, force: true })
      await run('git', ['clone', '-q', '--shared', root, copy])
      const res = await runResolved('npx', ['-y', '@colbymchenry/codegraph@1.6.2', 'init'], { cwd: copy, timeoutMs: 60 * 60 * 1000 })
      appendJsonl(out, { ...base, measure: 'codegraph-cold', wallMs: res.ms, ok: res.code === 0, error: res.code === 0 ? null : res.stderr.slice(-300) })
      rmSync(copy, { recursive: true, force: true })
    }
    console.log(`${id} #${rep}: cold ${cold.ms} ms (${cold.files} files, ${cold.edges} edges)`)
  }
}
console.log(`results in ${out}`)
writeFileSync(join(tmp, '.keep'), '')
