// Runs one question with one agent CLI and turns its event stream into a run record.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { agentEnv, readJson, run, BENCH } from './util.mjs'

const prices = () => { const file = join(BENCH, 'config', 'prices.json'); return existsSync(file) ? readJson(file) : { models: {} } }

/**
 * job: { cli, model, effort, root, prompt, mcp ({ command, args, env } | null), extraTools, explorer, appendSystem,
 *        edit (allow edits), allowBash (list of command prefixes the agent may run), maxTurns, timeoutMs, transcript }
 * Returns { ok, error, answer, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, costUsd, costSource,
 *           turns, toolCalls: string[], mcpStatus, sec }
 */
export function runAgent(job) { return job.cli === 'codex' ? runCodex(job) : runClaude(job) }

async function runClaude(job) {
  const dir = dirname(job.transcript)
  mkdirSync(dir, { recursive: true })
  const mcpFile = `${job.transcript}.mcp.json`
  writeFileSync(mcpFile, JSON.stringify({ mcpServers: job.mcp ? { graph: job.mcp } : {} }))
  const tools = ['Read', 'Grep', 'Glob', ...(job.explorer ? ['Agent'] : []), ...(job.edit ? ['Edit', 'Write', 'Bash'] : [])]
  const allowed = [...tools.filter((tool) => tool !== 'Bash'), 'mcp__graph', ...(job.allowBash ?? []).map((prefix) => `Bash(${prefix}:*)`)]
  const argv = ['-p', '--output-format', 'stream-json', '--verbose', '--model', job.model,
    '--strict-mcp-config', '--mcp-config', mcpFile, '--tools', tools.join(','), '--allowedTools', allowed.join(','),
    '--max-turns', String(job.maxTurns ?? 60), '--no-session-persistence', '--disable-slash-commands', '--setting-sources', 'project']
  if (job.edit) argv.push('--permission-mode', 'acceptEdits')
  if (job.explorer) argv.push('--agents', readFileSync(join(BENCH, 'config', 'explorer.json'), 'utf8'))
  if (job.appendSystem) argv.push('--append-system-prompt', job.appendSystem)
  if (process.env.BENCH_CLAUDE_BARE === '1') argv.push('--bare')

  const events = []
  const res = await run(process.env.BENCH_CLAUDE ?? 'claude', argv, { cwd: job.root, env: agentEnv(), timeoutMs: job.timeoutMs, input: job.prompt, onLine: (line) => { if (line.trim()) events.push(line) } })
  writeFileSync(job.transcript, `${events.join('\n')}\n${res.stderr ? JSON.stringify({ type: 'bench_stderr', text: res.stderr.slice(-4000) }) + '\n' : ''}`)
  return parseClaude(events.map(safeJson).filter(Boolean), res)
}

export function parseClaude(events, res = {}) {
  const out = { ok: false, error: null, answer: '', inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd: null, costSource: 'reported', turns: 0, toolCalls: [], mcpStatus: null, sec: (res.ms ?? 0) / 1000 }
  for (const event of events) {
    if (event.type === 'system' && event.subtype === 'init') out.mcpStatus = (event.mcp_servers ?? []).map((server) => `${server.name}:${server.status}`).join(',') || 'none'
    if (event.type === 'assistant') for (const item of event.message?.content ?? []) if (item.type === 'tool_use') out.toolCalls.push(item.name)
    if (event.type === 'result') {
      const usage = event.usage ?? {}
      out.inputTokens = usage.input_tokens ?? 0
      out.cacheReadTokens = usage.cache_read_input_tokens ?? 0
      out.cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
      out.outputTokens = usage.output_tokens ?? 0
      out.costUsd = event.total_cost_usd ?? null
      out.turns = event.num_turns ?? 0
      out.answer = typeof event.result === 'string' ? event.result : ''
      out.ok = !event.is_error && event.subtype === 'success'
      if (!out.ok) out.error = event.subtype ?? 'error'
      if (event.duration_ms) out.sec = event.duration_ms / 1000
    }
  }
  if (res.timedOut) { out.ok = false; out.error = 'timeout' }
  else if (!events.some((event) => event.type === 'result')) { out.ok = false; out.error = `no result (exit ${res.code}): ${(res.stderr ?? '').trim().slice(-300)}` }
  if (out.mcpStatus && /:(failed|error)/.test(out.mcpStatus)) { out.ok = false; out.error = `mcp failed (${out.mcpStatus})` }
  return out
}

async function runCodex(job) {
  mkdirSync(dirname(job.transcript), { recursive: true })
  const toml = (value) => JSON.stringify(value)
  const argv = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules',
    ...codexSandbox(job.edit), '-m', job.model, '-C', job.root, '-o', `${job.transcript}.last.txt`]
  if (job.effort) argv.push('-c', `model_reasoning_effort=${toml(job.effort)}`)
  if (job.mcp) {
    argv.push('-c', `mcp_servers.graph.command=${toml(job.mcp.command)}`, '-c', `mcp_servers.graph.args=[${job.mcp.args.map(toml).join(',')}]`,
      '-c', 'mcp_servers.graph.startup_timeout_sec=120', '-c', 'mcp_servers.graph.tool_timeout_sec=300')
    const env = Object.entries(job.mcp.env ?? {})
    if (env.length) argv.push('-c', `mcp_servers.graph.env={${env.map(([key, value]) => `${key}=${toml(value)}`).join(',')}}`)
  }
  argv.push('-')
  const prompt = job.appendSystem ? `${job.appendSystem}\n\n${job.prompt}` : job.prompt
  const events = []
  const res = await run(process.env.BENCH_CODEX ?? 'codex', argv, { cwd: job.root, env: agentEnv(), timeoutMs: job.timeoutMs, input: prompt, onLine: (line) => { if (line.trim()) events.push(line) } })
  writeFileSync(job.transcript, `${events.join('\n')}\n${res.stderr ? JSON.stringify({ type: 'bench_stderr', text: res.stderr.slice(-4000) }) + '\n' : ''}`)
  const out = parseCodex(events.map(safeJson).filter(Boolean), res, job.model)
  const last = `${job.transcript}.last.txt`
  if (!out.answer && existsSync(last)) out.answer = readFileSync(last, 'utf8')
  return out
}

/**
 * Codex's Windows sandbox refuses even read-only shell commands on some machines, and then the agent cannot read the
 * code at all. BENCH_CODEX_SANDBOX=none (the default on Windows) runs without it, like Codex's own
 * sandbox_mode = "danger-full-access": the checkouts are disposable copies and run.mjs records any file the agent changed.
 * BENCH_CODEX_SANDBOX=on uses read-only (questions) or workspace-write (edit tasks).
 */
export function codexSandbox(edit) {
  const mode = process.env.BENCH_CODEX_SANDBOX ?? (process.platform === 'win32' ? 'none' : 'on')
  if (mode === 'none') return ['--dangerously-bypass-approvals-and-sandbox']
  return ['-s', edit ? 'workspace-write' : 'read-only']
}

export function parseCodex(events, res = {}, model) {
  const out = { ok: false, error: null, answer: '', inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd: null, costSource: 'estimated', turns: 0, toolCalls: [], mcpStatus: null, sec: (res.ms ?? 0) / 1000 }
  let completed = false
  for (const event of events) {
    const item = event.item
    if (event.type === 'item.completed' && item) {
      if (item.type === 'command_execution') out.toolCalls.push('shell')
      else if (item.type === 'mcp_tool_call') out.toolCalls.push(`mcp__${item.server ?? 'graph'}__${item.tool ?? 'tool'}`)
      else if (item.type === 'file_change') out.toolCalls.push('edit')
      else if (item.type === 'web_search') out.toolCalls.push('web_search')
      else if (item.type === 'agent_message' && typeof item.text === 'string') out.answer = item.text
      if (item.type !== 'agent_message' && item.type !== 'reasoning') out.turns++
    }
    if (event.type === 'turn.completed') {
      completed = true
      const usage = event.usage ?? {}
      // Codex reports input including the cached part; keep them apart like Claude does
      out.cacheReadTokens += usage.cached_input_tokens ?? 0
      out.inputTokens += Math.max(0, (usage.input_tokens ?? 0) - (usage.cached_input_tokens ?? 0))
      out.cacheWriteTokens += usage.cache_write_input_tokens ?? 0
      out.outputTokens += usage.output_tokens ?? 0
    }
    if (event.type === 'turn.failed' || event.type === 'error') out.error = event.error?.message ?? event.message ?? 'error'
  }
  out.ok = completed && !out.error && !res.timedOut
  if (res.timedOut) out.error = 'timeout'
  else if (!completed && !out.error) out.error = `no result (exit ${res.code}): ${(res.stderr ?? '').trim().slice(-300)}`
  const price = prices().models?.[model]
  if (price && price.input != null && price.output != null) out.costUsd = (out.inputTokens * price.input + out.cacheReadTokens * (price.cachedInput ?? price.input) + out.outputTokens * price.output) / 1e6
  return out
}

function safeJson(line) { try { return JSON.parse(line) } catch { return null } }
