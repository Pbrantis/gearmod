// Runs an experiment: every question × configuration × agent × repetition, in a seeded random order, several at a
// time. Each finished run is appended to bench-data/results/<experiment>/runs.jsonl, so the run can stop and resume.
//
//   node bench/run.mjs experiments/pilot.json                 run (skips what is already done)
//   node bench/run.mjs experiments/pilot.json --dry           only list what would run and the estimate
//   node bench/run.mjs experiments/pilot.json --check         check that every tool and agent starts
//   options: --concurrency 4  --max-usd 50  --retry-errors  --checked (include machine-checked questions)
//            --drafts (include every question)  --only-repo a,b  --only-agent codex
//   A run cut by the usage limit stops the whole experiment; running the same command later resumes it.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runAgent } from './lib/agents.mjs'
import { BENCH, QUESTIONS, ELECTRON, RESULTS, SERVER, WORK, appendJsonl, args, list, readJson, readJsonl, run, runResolved, shuffle, slug, stripCheckout } from './lib/util.mjs'

const opt = args()
if (!opt._[0]) { console.error('usage: node bench/run.mjs <experiment.json> [--dry|--check] [--concurrency N] [--max-usd X]'); process.exit(1) }
const expFile = resolve(BENCH, opt._[0])
const exp = readJson(expFile)
const repos = Object.fromEntries(readJson(join(BENCH, 'config', 'repos.json')).repos.map((repo) => [repo.id, repo]))
const tools = readJson(join(BENCH, 'config', 'tools.json')).tools
const agents = Object.fromEntries(readJson(join(BENCH, 'config', 'agents.json')).agents.map((agent) => [agent.id, agent]))
const prompts = readJson(join(BENCH, 'config', 'prompts.json'))
const outDir = join(RESULTS, exp.id)
const runsFile = join(outDir, 'runs.jsonl')

// ---------- folders ----------
const repoRoot = (repo, tool) => (tool?.copy ? join(WORK, 'copies', slug(tool.id), repo.id) : join(WORK, 'repos', repo.id))
const fill = (value, ctx) => (typeof value === 'string' ? value.replaceAll('{root}', ctx.root).replaceAll('{work}', WORK).replaceAll('{repo}', ctx.repo) : value)

// ---------- the job list ----------
function catalog(repoId) {
  const file = join(QUESTIONS, `${repoId}.json`)
  if (!existsSync(file)) return []
  // reviewed = read by a person; checked = only machine-checked (run with --checked, e.g. for a pilot)
  return readJson(file).questions.filter((q) => opt.drafts || q.status === 'reviewed' || (opt.checked && q.status === 'checked'))
}

function jobs() {
  const out = []
  const repoIds = list(opt['only-repo']).length ? list(opt['only-repo']) : exp.repos
  for (const repoId of repoIds) {
    const repo = repos[repoId]
    if (!repo) throw new Error(`repository not in config/repos.json: ${repoId}`)
    let questions = catalog(repoId).filter((q) => !exp.types || exp.types.includes(q.type)).filter((q) => !exp.questions || exp.questions.includes(q.id))
    if (exp.perRepo && questions.length > exp.perRepo) questions = shuffle(questions, (exp.seed ?? 1) + repoId.length).slice(0, exp.perRepo)
    for (const q of questions) {
      const variants = (q.variants ?? []).filter((v) => !exp.langs || exp.langs.includes(v.lang))
      for (const variant of exp.variants === 'all' ? variants : variants.slice(0, 1)) {
        for (const toolId of exp.configs) {
          const tool = tools[toolId]
          if (!tool) throw new Error(`configuration not in config/tools.json: ${toolId}`)
          for (const agentId of list(opt['only-agent']).length ? exp.agents.filter((id) => list(opt['only-agent']).includes(id)) : exp.agents) {
            const agent = agents[agentId]
            if (!agent) throw new Error(`agent not in config/agents.json: ${agentId}`)
            if (tool.agents && !tool.agents.includes(agent.cli)) continue
            for (let rep = 1; rep <= (exp.repeats ?? 1); rep++) out.push({ key: [repoId, q.id, variant.id, toolId, agentId, `r${rep}`].join('.'), repo, q, variant, toolId, tool: { ...tool, id: toolId }, agent, rep })
          }
        }
      }
    }
  }
  return out
}

// ---------- what each configuration gives the agent ----------
const indexDb = (repo, tool) => join(WORK, 'index', `${repo.id}.${slug(tool.ablate ?? 'full')}.sqlite`)

function mcpFor(item, root) {
  const { tool, repo } = item
  if (tool.kind === 'gearmod') {
    const env = { ELECTRON_RUN_AS_NODE: '1', BENCH_ROOT: root, BENCH_DB: indexDb(repo, tool), BENCH_EXCLUDE: (repo.exclude ?? []).join(','), GEARMOD_INDEX_ABLATE: tool.ablate ?? '' }
    if (tool.detail === 'resumo') env.BENCH_DETAIL = 'resumo'
    if (tool.toolset === 'all') env.BENCH_TOOLS = 'all'
    if (item.q.type === 'edit') env.BENCH_WATCH = '1'
    return { command: ELECTRON, args: [SERVER, 'serve'], env }
  }
  if (tool.kind === 'mcp') {
    const ctx = { root, repo: repo.id }
    const command = fill(tool.command, ctx)
    const argv = (tool.args ?? []).map((arg) => fill(arg, ctx))
    // npx, uvx and other .cmd shims need cmd.exe on Windows when the agent starts the server
    const shim = process.platform === 'win32' && ['npx', 'npm', 'pnpm', 'yarn'].includes(command)
    return { command: shim ? 'cmd' : command, args: shim ? ['/d', '/c', command, ...argv] : argv, env: Object.fromEntries(Object.entries(tool.env ?? {}).map(([key, value]) => [key, fill(value, ctx)])) }
  }
  return null
}

function mapText(item, root) {
  if (item.tool.kind !== 'map') return null
  const file = join(WORK, 'maps', item.toolId, `${item.repo.id}.txt`)
  if (!existsSync(file)) throw new Error(`map missing: ${file} (run the experiment once with --prepare-maps)`)
  return (prompts[item.variant.lang]?.map ?? '') + readFileSync(file, 'utf8')
}

function promptFor(item) {
  const text = prompts[item.variant.lang] ?? prompts.en
  let prompt = item.variant.text.trim() + (item.q.type === 'edit' ? text.edit : text.answer)
  if (item.tool.hint === 'explorer') prompt += text.explorer
  else if (item.tool.hint) prompt += text.hint + (item.agent.cli === 'codex' ? text.hintCodex ?? '' : '')
  return prompt
}

// ---------- preparation ----------
async function prepare(list) {
  if (list.some((item) => item.tool.kind === 'gearmod') && !existsSync(SERVER)) {
    console.log('building the index server (bench/build.mjs)…')
    const res = await run(process.execPath, [join(BENCH, 'build.mjs')])
    if (res.code !== 0) throw new Error(res.stderr)
  }
  const done = new Set()
  for (const item of list) {
    const root = repoRoot(item.repo, item.tool)
    if (!existsSync(root)) throw new Error(`folder missing: ${root} (run node bench/prepare.mjs ${item.repo.id})`)
    if (item.tool.kind === 'gearmod') {
      const key = `idx:${indexDb(item.repo, item.tool)}`
      if (done.has(key)) continue
      done.add(key)
      mkdirSync(join(WORK, 'index'), { recursive: true })
      const res = await run(ELECTRON, [SERVER, 'index'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BENCH_ROOT: root, BENCH_DB: indexDb(item.repo, item.tool), BENCH_EXCLUDE: (item.repo.exclude ?? []).join(','), GEARMOD_INDEX_ABLATE: item.tool.ablate ?? '' } })
      if (res.code !== 0) throw new Error(`index failed for ${item.repo.id}: ${res.stderr}`)
      console.log(`index ${item.repo.id} ${item.tool.ablate ?? 'full'}: ${res.stdout.trim()}`)
      appendJsonl(join(outDir, 'index.jsonl'), { at: new Date().toISOString(), repo: item.repo.id, ablate: item.tool.ablate ?? '', ...safe(res.stdout) })
    }
    if (item.tool.setup) {
      const key = `setup:${item.toolId}:${root}`
      const marker = join(root, `.bench-setup-${slug(item.toolId)}`)
      if (done.has(key) || existsSync(marker)) continue
      done.add(key)
      const [command, ...argv] = item.tool.setup.map((arg) => fill(arg, { root, repo: item.repo.id }))
      console.log(`setup ${item.toolId} ${item.repo.id}…`)
      const res = await runResolved(command, argv, { cwd: root, env: { ...process.env, ...(item.tool.env ?? {}) }, timeoutMs: 60 * 60 * 1000 })
      if (res.code !== 0) throw new Error(`setup ${item.toolId} failed for ${item.repo.id}: ${res.stderr.slice(-500)}`)
      writeFileSync(marker, new Date().toISOString())
      appendJsonl(join(outDir, 'index.jsonl'), { at: new Date().toISOString(), repo: item.repo.id, tool: item.toolId, ms: res.ms })
    }
    if (item.tool.kind === 'map') {
      const file = join(WORK, 'maps', item.toolId, `${item.repo.id}.txt`)
      if (existsSync(file) || done.has(file)) continue
      done.add(file)
      // a project split in parts (back/, front/) is not one Git repository: map each part with its share of the budget
      const parts = item.repo.parts ? Object.keys(item.repo.parts) : ['']
      const maps = []
      for (const part of parts) {
        const [command, ...argv] = item.tool.map.map((arg, i, all) => (all[i - 1] === '--map-tokens' ? String(Math.floor(Number(arg) / parts.length)) : arg))
        const res = await runResolved(command, argv, { cwd: part ? join(root, part) : root, env: { ...process.env, ...(item.tool.env ?? {}) }, timeoutMs: 30 * 60 * 1000 })
        if (res.code !== 0 || !res.stdout.trim()) throw new Error(`map ${item.toolId} failed for ${item.repo.id}/${part}: ${res.stderr.slice(-500)}`)
        // keep the map only: drop the tool's banner and chat instructions before the first file entry
        const lines = res.stdout.split(/\r?\n/)
        const start = lines.findIndex((line) => /^\S[^:]*\.\w+:\s*$/.test(line))
        maps.push((start >= 0 ? lines.slice(start) : lines).map((line) => (part && /^\S[^:]*\.\w+:\s*$/.test(line) ? `${part}/${line.replaceAll('\\', '/')}` : line.replaceAll('\\', '/'))).join('\n'))
      }
      mkdirSync(join(WORK, 'maps', item.toolId), { recursive: true })
      writeFileSync(file, maps.join('\n\n'))
    }
  }
}
const safe = (text) => { try { return JSON.parse(text.trim().split('\n').at(-1)) } catch { return { raw: text.trim() } } }

/** `git status --porcelain` of a checkout, or of each part (back/, front/) when the project is split. */
async function gitStatus(root) {
  const dirs = existsSync(join(root, '.git')) ? [['', root]] : readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, '.git'))).map((entry) => [`${entry.name}/`, join(root, entry.name)])
  const out = []
  for (const [prefix, dir] of dirs) out.push(...(await run('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=all'])).stdout.split('\n').filter(Boolean).map((line) => `${line.slice(0, 3)}${prefix}${line.slice(3)}`))
  return out
}

// ---------- one run ----------
async function execute(item) {
  const transcript = join(outDir, 'transcripts', `${slug(item.key)}.jsonl`)
  let root = repoRoot(item.repo, item.tool)
  let worktree = null
  const record = { key: item.key, experiment: exp.id, repo: item.repo.id, question: item.q.id, qtype: item.q.type, variant: item.variant.id, lang: item.variant.lang, config: item.toolId, agent: item.agent.id, cli: item.agent.cli, model: item.agent.model, effort: item.agent.effort ?? null, rep: item.rep, startedAt: new Date().toISOString() }
  try {
    if (item.q.type === 'edit') {
      // every edit run starts from a clean worktree of the pinned commit
      worktree = join(WORK, 'edit', slug(item.key))
      const res = await run('git', ['-C', root, 'worktree', 'add', '--detach', '--force', worktree, 'HEAD'])
      if (res.code !== 0) throw new Error(`worktree: ${res.stderr}`)
      stripCheckout(item.repo, worktree)
      root = worktree
      if (item.tool.setup) { const [command, ...argv] = item.tool.setup.map((arg) => fill(arg, { root, repo: item.repo.id })); await runResolved(command, argv, { cwd: root, timeoutMs: 30 * 60 * 1000 }) }
      for (const step of item.q.edit?.setup ?? []) { const [command, ...argv] = step; await runResolved(command, argv, { cwd: root, timeoutMs: 30 * 60 * 1000 }) }
    }
    const before = item.q.type === 'edit' ? null : await gitStatus(root)
    const result = await runAgent({
      cli: item.agent.cli, model: item.agent.model, effort: item.agent.effort, root, prompt: promptFor(item), mcp: mcpFor(item, root),
      explorer: !!item.tool.explorer, appendSystem: mapText(item, root), edit: item.q.type === 'edit', allowBash: item.q.edit?.allow ?? [],
      maxTurns: exp.maxTurns ?? 60, timeoutMs: (exp.timeoutSec ?? 900) * 1000, transcript
    })
    Object.assign(record, result)
    if (before !== null) {
      // questions must not change the code; a run that did is kept but flagged (the next runs would see the change)
      const after = await gitStatus(root)
      const changed = after.filter((line) => !before.includes(line))
      if (changed.length) { record.modifiedFiles = changed; console.log(`  ! ${item.key} changed files: ${changed.join(', ')}`) }
    }
    if (worktree && item.q.edit?.check) {
      const [command, ...argv] = item.q.edit.check
      const check = await runResolved(command, argv, { cwd: worktree, timeoutMs: (item.q.edit.checkTimeoutSec ?? 900) * 1000 })
      const diff = await run('git', ['-C', worktree, 'diff', '--shortstat'])
      Object.assign(record, { checkPassed: check.code === 0, checkSec: check.ms / 1000, diff: diff.stdout.trim() })
      writeFileSync(`${transcript}.check.txt`, `${check.stdout}\n${check.stderr}`.slice(-20000))
    }
  } catch (error) {
    Object.assign(record, { ok: false, error: error instanceof Error ? error.message : String(error) })
  } finally {
    if (worktree) await run('git', ['-C', repoRoot(item.repo, item.tool), 'worktree', 'remove', '--force', worktree])
  }
  record.finishedAt = new Date().toISOString()
  appendJsonl(runsFile, record)
  return record
}

// ---------- check: each tool and agent starts and answers one tiny question ----------
async function check(list) {
  const seen = new Set()
  for (const item of list) {
    const key = `${item.toolId}|${item.agent.id}|${item.repo.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const root = repoRoot(item.repo, item.tool)
    const transcript = join(outDir, 'check', `${slug(key)}.jsonl`)
    const tryTool = item.tool.kind === 'none' || item.tool.kind === 'map' ? '' : ' Use one mcp__graph tool once to list or find a symbol, then answer with its name only.'
    const res = await runAgent({ cli: item.agent.cli, model: item.agent.model, effort: item.agent.effort, root, prompt: `Name one source file in this project.${tryTool}`, mcp: mcpFor(item, root), explorer: !!item.tool.explorer, appendSystem: item.tool.kind === 'map' ? mapText(item, root) : null, maxTurns: 6, timeoutMs: 300000, transcript })
    const usedGraph = res.toolCalls.some((name) => name.startsWith('mcp__'))
    console.log(`${res.ok && (usedGraph || !tryTool) ? 'ok  ' : 'FAIL'} ${key}  mcp=${res.mcpStatus ?? '-'} tools=${res.toolCalls.join(' ') || '-'} ${res.error ?? ''}`)
  }
}

// ---------- main ----------
const all = jobs()
const done = new Map(readJsonl(runsFile).map((record) => [record.key, record]))
// a run cut by the plan's usage limit is not a result: it runs again on the next start
const LIMIT = /usage limit|rate.?limit|limit (reached|exceeded)|quota|429|overloaded|out of (credits|tokens)|hit your (\S+ )?limit|limit · resets/i
const limited = (record) => !record.ok && LIMIT.test(`${record.error ?? ''} ${record.answer ?? ''}`)
const pending = shuffle(all.filter((item) => { const prev = done.get(item.key); return !prev || limited(prev) || (opt['retry-errors'] && !prev.ok) }), exp.seed ?? 1)
const spent = () => [...readJsonl(runsFile)].reduce((sum, record) => sum + (record.costUsd ?? 0), 0)
console.log(`experiment ${exp.id}: ${all.length} runs in the design, ${all.length - pending.length} done, ${pending.length} to run`)

if (opt.dry) {
  const by = (field) => Object.entries(pending.reduce((acc, item) => { const value = field(item); acc[value] = (acc[value] ?? 0) + 1; return acc }, {})).map(([key, value]) => `${key}=${value}`).join(' ')
  console.log(`by repo: ${by((item) => item.repo.id)}\nby config: ${by((item) => item.toolId)}\nby agent: ${by((item) => item.agent.id)}\nby type: ${by((item) => item.q.type)}`)
  const avg = exp.estimateUsdPerRun ?? 0.1
  console.log(`estimate at US$ ${avg}/run: US$ ${(pending.length * avg).toFixed(0)}; at ${opt.concurrency ?? exp.concurrency ?? 4} at a time and ~40 s/run: ${(pending.length * 40 / (opt.concurrency ?? exp.concurrency ?? 4) / 3600).toFixed(1)} h`)
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'experiment.json'), JSON.stringify({ ...exp, file: expFile, startedAt: new Date().toISOString() }, null, 2))
await prepare(opt.check ? [...new Map(all.map((item) => [`${item.toolId}|${item.repo.id}`, item])).values()] : pending)
if (opt.check) { await check(all); process.exit(0) }

const limit = Number(opt.concurrency ?? exp.concurrency ?? 4)
const maxUsd = opt['max-usd'] !== undefined ? Number(opt['max-usd']) : exp.maxUsd ?? Infinity
let next = 0, finished = 0, failed = 0, stop = false
const started = Date.now()
async function worker() {
  while (!stop && next < pending.length) {
    const item = pending[next++]
    const record = await execute(item)
    finished++
    if (!record.ok) failed++
    if (limited(record) && !stop) { stop = true; console.log(`usage limit reached (${(record.error ?? '').slice(0, 120)}); stopping. Start the same command again later: it resumes, and the cut runs are redone.`) }
    const total = spent()
    const eta = ((Date.now() - started) / finished) * (pending.length - finished) / 60000
    console.log(`[${finished}/${pending.length}] ${record.ok ? 'ok ' : 'ERR'} ${item.key}  US$ ${(record.costUsd ?? 0).toFixed(3)}  ${Math.round(record.sec ?? 0)}s${record.error ? `  ${record.error}` : ''}  | total US$ ${total.toFixed(2)}, ~${eta.toFixed(0)} min left`)
    if (total >= maxUsd) { stop = true; console.log(`budget of US$ ${maxUsd} reached; stopping after the runs in progress`) }
  }
}
await Promise.all(Array.from({ length: limit }, worker))
console.log(`done: ${finished} runs, ${failed} with error. Next: node bench/score.mjs ${opt._[0]}`)
