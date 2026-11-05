// Shared helpers for the benchmark scripts.
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BENCH = dirname(dirname(fileURLToPath(import.meta.url)))
export const REPO = dirname(BENCH)
// Data (clones of other repositories, indexes, transcripts, answer keys) lives outside the Git repository, so it is
// never committed by accident. Default: <repo>/../bench-data. Override with BENCH_DATA.
export const DATA = process.env.BENCH_DATA ? resolve(process.env.BENCH_DATA) : join(dirname(REPO), 'bench-data')
export const WORK = join(DATA, 'work')
export const RESULTS = join(DATA, 'results')
export const QUESTIONS = join(DATA, 'questions')
export const DESKTOP = join(REPO, 'apps', 'desktop')
export const ELECTRON = join(DESKTOP, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
export const SERVER = join(DESKTOP, '.bench', 'gearmod-index.mjs')

export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
export const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`) }
export const appendJsonl = (file, value) => { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${JSON.stringify(value)}\n`) }
export function readJsonl(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
}

/** Simple flags: --name value, --flag (true), the rest are positional. */
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i]
    if (!item.startsWith('--')) { out._.push(item); continue }
    const key = item.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}
export const list = (value) => (value === undefined || value === true ? [] : String(value).split(',').map((item) => item.trim()).filter(Boolean))

/** Seeded random (mulberry32), so the run order is the same for a given seed. */
export function rng(seed) {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
export function shuffle(items, seed) { const random = rng(seed); const out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] } return out }

/**
 * Environment for the agent CLIs. Inside the GearMod or Claude desktop apps the terminal inherits session variables
 * (CLAUDE_CODE_*, ANTHROPIC_BASE_URL) that make the child CLI try an auth that only works there; without them it
 * uses the user's normal login. BENCH_KEEP_ENV=1 keeps everything (e.g. to use ANTHROPIC_API_KEY).
 */
export function agentEnv(extra = {}) {
  const env = { ...process.env }
  if (process.env.BENCH_KEEP_ENV !== '1') for (const key of Object.keys(env)) if (/^(CLAUDE|ANTHROPIC)/.test(key) && key !== 'ANTHROPIC_API_KEY') delete env[key]
  return { ...env, ...extra }
}

/** Runs a program without a shell (arguments go as they are, no quoting problems), with a timeout. */
export function run(command, argv, { cwd, env, timeoutMs = 0, onLine, input, verbatim = false } = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(command, argv, { cwd, env, windowsHide: true, windowsVerbatimArguments: verbatim, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', buffer = '', timedOut = false
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; kill(child) }, timeoutMs) : null
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8')
      stdout += text
      if (!onLine) return
      buffer += text
      let cut
      while ((cut = buffer.indexOf('\n')) >= 0) { onLine(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1) }
    })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    if (input !== undefined) { child.stdin.write(input); child.stdin.end() }
    child.on('error', (error) => { if (timer) clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}${error.message}`, ms: Date.now() - started, timedOut }) })
    child.on('close', (code) => { if (timer) clearTimeout(timer); if (onLine && buffer) onLine(buffer); resolve({ code, stdout, stderr, ms: Date.now() - started, timedOut }) })
  })
}

function kill(child) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
  else child.kill('SIGKILL')
}

/** On Windows, npm-style shims (.cmd) cannot be spawned without a shell; this finds the real file to run. */
export function resolveCommand(command) {
  if (process.platform !== 'win32' || /[\\/]/.test(command)) return command
  for (const dir of (process.env.PATH ?? '').split(';')) {
    for (const ext of ['.exe', '.cmd', '.bat', '']) {
      const file = join(dir, command + ext)
      if (existsSync(file)) return file
    }
  }
  return command
}

/** Runs a .cmd shim through cmd.exe when needed; other commands run directly. */
export function runResolved(command, argv, options) {
  const file = resolveCommand(command)
  if (/\.(cmd|bat)$/i.test(file)) {
    // cmd.exe needs the whole line quoted once more ("/s /c ""C:\Program Files\...\npx.cmd" args""), so it is built by hand
    const quote = (arg) => (/[\s"&|<>^()]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg)
    return run('cmd.exe', ['/d', '/s', '/c', `"${[file, ...argv].map(quote).join(' ')}"`], { ...options, verbatim: true })
  }
  return run(file, argv, options)
}

// instruction files for coding agents: they change how each agent works, so no condition gets them
const AGENT_FILES = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'GEMINI.md', '.claude', '.serena', '.cursor', '.cursorrules', '.windsurf', '.windsurfrules', '.clinerules', '.codex', 'copilot-instructions.md', '.mcp.json'])

/**
 * Deletes the paths in repo.strip (e.g. the answer key) and every agent instruction file from a checkout or worktree.
 * Git sees them as deleted files, so the index leaves them out too. Returns what was removed.
 */
export function stripCheckout(repo, dir) {
  for (const path of repo.strip ?? []) rmSync(join(dir, path), { recursive: true, force: true })
  const removed = []
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const path = join(folder, entry.name)
      if (AGENT_FILES.has(entry.name)) { rmSync(path, { recursive: true, force: true }); removed.push(path.slice(dir.length + 1)) }
      else if (entry.isDirectory()) walk(path)
    }
  }
  walk(dir)
  return removed
}

export const slug = (value) => String(value).replace(/[^A-Za-z0-9._-]+/g, '_')
