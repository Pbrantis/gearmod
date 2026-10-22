import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { resolveCommand } from './agents'
import type { AgentProfile, Effort, ModelOption, PermissionMode } from '@agentboard/contracts'
import type { McpEndpoint } from './mcp-bridge'
import type { ServerNotification } from './generated/codex-app-server/ServerNotification'
import type { ThreadStartParams } from './generated/codex-app-server/v2/ThreadStartParams'
import type { ReasoningEffort } from './generated/codex-app-server/ReasoningEffort'
import type { SandboxMode } from './generated/codex-app-server/v2/SandboxMode'
import type { AskForApproval } from './generated/codex-app-server/v2/AskForApproval'
import type { ApprovalsReviewer } from './generated/codex-app-server/v2/ApprovalsReviewer'
import type { TurnStartParams } from './generated/codex-app-server/v2/TurnStartParams'

export type AgentEvent = { type: string; payload: Record<string, unknown> }
export type AgentRunOptions = { cwd: string; prompt: string; sessionId: string | null; planning: boolean; profile: AgentProfile; pluginDir?: string | null; mcp?: McpEndpoint; model?: string | null; effort?: Effort | null; mode?: PermissionMode; developerInstructions?: string; signal?: AbortSignal; onEvent(event: AgentEvent): void }
export type AgentRunResult = { sessionId: string; turnId: string | null; text: string; status: 'completed' | 'failed' | 'interrupted'; error: string | null }
export interface AgentAdapter { run(options: AgentRunOptions): Promise<AgentRunResult> }

type JsonObject = Record<string, unknown>
export interface ProcessFactory { start(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcessWithoutNullStreams }
const nodeProcesses: ProcessFactory = { start(command, args, options) {
  const executable = safeExecutable(command)
  if (process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(executable).toLowerCase())) {
    const commandLine = [executable, ...args].map((value) => `"${value.replace(/"/g, '""')}"`).join(' ')
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], { ...options, windowsHide: true, shell: false })
  }
  return spawn(executable, args, { ...options, windowsHide: true, shell: false })
} }

class JsonLineRpc {
  private nextId = 1
  private readonly pending = new Map<number, { resolve(value: JsonObject): void; reject(error: Error): void }>()
  private readonly listeners: Array<(message: JsonObject) => void> = []
  private stderr = ''
  constructor(readonly process: ChildProcessWithoutNullStreams) {
    createInterface({ input: process.stdout }).on('line', (line) => this.receive(line))
    process.stderr.on('data', (chunk: Buffer) => { this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4000) })
    process.on('exit', (code) => {
      const error = new Error(`Agent process exited (${code}): ${sanitize(this.stderr)}`)
      this.failAll(error)
      this.listeners.forEach((listener) => listener({ method: 'error', params: { message: error.message } }))
    })
  }
  onMessage(listener: (message: JsonObject) => void): void { this.listeners.push(listener) }
  notify(method: string, params?: JsonObject): void { this.write(params ? { method, params } : { method }) }
  request(method: string, params: JsonObject): Promise<JsonObject> {
    const id = this.nextId++
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.write({ id, method, params }) })
  }
  stop(): void { if (!this.process.killed) this.process.kill() }
  private write(value: JsonObject): void { this.process.stdin.write(`${JSON.stringify(value)}\n`) }
  private receive(line: string): void {
    let message: JsonObject
    try { message = JSON.parse(line) as JsonObject } catch { return }
    if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(sanitize(JSON.stringify(message.error))))
      else pending.resolve(message.result as JsonObject)
      return
    }
    this.listeners.forEach((listener) => listener(message))
  }
  private failAll(error: Error): void { for (const pending of this.pending.values()) pending.reject(error); this.pending.clear() }
}

const codexEfforts = new Set<string>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

/** Modos de permissão do AgentBoard → sandbox, política de aprovação e revisor do Codex (plano 08, seção 6). */
export function codexAccess(mode: PermissionMode): { sandbox: SandboxMode; approvalPolicy: AskForApproval; approvalsReviewer?: ApprovalsReviewer } {
  switch (mode) {
    case 'plan': return { sandbox: 'read-only', approvalPolicy: 'never' }
    case 'auto': return { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' }
    case 'on_request': return { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' }
    case 'read_only': return { sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' }
    case 'bypass': return { sandbox: 'danger-full-access', approvalPolicy: 'never' }
    default: throw new Error(`Modo não suportado pelo Codex: ${mode}`)
  }
}

/** Modos do AgentBoard → `--permission-mode` do Claude. */
export const claudePermissionMode: Record<PermissionMode, string | null> = { plan: 'plan', auto: 'auto', accept_edits: 'acceptEdits', manual: 'manual', on_request: null, read_only: null, bypass: 'bypassPermissions' }

export class CodexAppServerAdapter implements AgentAdapter {
  constructor(private readonly processes: ProcessFactory = nodeProcesses) {}
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const child = this.processes.start(options.profile.executablePath || 'codex', ['app-server', '--listen', 'stdio://'], { cwd: options.cwd, env: { ...process.env, CODEX_HOME: options.profile.configDir } })
    const rpc = new JsonLineRpc(child)
    const abort = () => rpc.stop(); options.signal?.addEventListener('abort', abort, { once: true })
    let text = '', turnId: string | null = null
    try {
      await rpc.request('initialize', { clientInfo: { name: 'agentboard', title: 'AgentBoard', version: '0.1.0' }, capabilities: null })
      rpc.notify('initialized')
      const access = codexAccess(options.planning ? 'plan' : options.mode ?? 'auto')
      const policy = { cwd: options.cwd, ...access, ...(options.model ? { model: options.model } : {}), ...(options.developerInstructions ? { developerInstructions: options.developerInstructions } : {}), ...(options.mcp ? { config: { mcp_servers: { agentboard: { command: options.mcp.command, args: options.mcp.args, env: options.mcp.env } } } } : {}) } satisfies ThreadStartParams
      const threadResult = options.sessionId
        ? await rpc.request('thread/resume', { threadId: options.sessionId, ...policy })
        : await rpc.request('thread/start', policy)
      const thread = threadResult.thread as { id: string }
      const completed = new Promise<AgentRunResult>((resolve, reject) => {
        const onAbort = () => resolve({ sessionId: thread.id, turnId, text, status: 'interrupted', error: 'Interrompido pelo usuário' })
        options.signal?.addEventListener('abort', onAbort, { once: true })
        rpc.onMessage((raw) => {
          const event = raw as unknown as ServerNotification
          if (!('method' in event)) return
          const params = event.params as unknown as Record<string, unknown>
          if (event.method === 'item/agentMessage/delta') { const delta = String(params.delta ?? ''); text += delta; options.onEvent({ type: event.method, payload: { delta } }) }
          else options.onEvent({ type: event.method, payload: redactObject(params) })
          if (event.method === 'turn/completed') {
            const turn = params.turn as { id?: string; status?: string; error?: unknown }; turnId = turn.id ?? turnId
            const status = turn.status === 'completed' ? 'completed' : turn.status === 'interrupted' ? 'interrupted' : 'failed'
            resolve({ sessionId: thread.id, turnId, text, status, error: status === 'failed' ? sanitize(JSON.stringify(turn.error ?? 'Turn failed')) : null })
          }
          if (event.method === 'error') reject(new Error(sanitize(JSON.stringify(params))))
        })
      })
      const turnParams: TurnStartParams = { threadId: thread.id, input: [{ type: 'text', text: options.prompt, text_elements: [] }], approvalPolicy: access.approvalPolicy, ...(access.approvalsReviewer ? { approvalsReviewer: access.approvalsReviewer } : {}), ...(options.model ? { model: options.model } : {}), ...(options.effort && codexEfforts.has(options.effort) ? { effort: options.effort as ReasoningEffort } : {}) }
      const started = await rpc.request('turn/start', turnParams as unknown as JsonObject)
      turnId = (started.turn as { id?: string } | undefined)?.id ?? null
      return await completed
    } finally { options.signal?.removeEventListener('abort', abort); rpc.stop() }
  }
}

/** Lista os modelos do Codex pelo app-server (`model/list`); falha ou demora devolvem lista vazia. */
export async function listCodexModels(profile: AgentProfile, processes: ProcessFactory = nodeProcesses, timeoutMs = 30_000): Promise<ModelOption[]> {
  try {
    const live = await listCodexModelsLive(profile, processes, timeoutMs)
    if (live.length) return live
  } catch (error) {
    const cached = readCodexModelsCache(profile)
    if (cached.length) return cached
    throw error
  }
  const cached = readCodexModelsCache(profile)
  if (cached.length) return cached
  throw new Error('O Codex não devolveu nenhum modelo.')
}

/** Plano B: o Codex guarda o último catálogo em `models_cache.json` dentro do CODEX_HOME. */
export function readCodexModelsCache(profile: AgentProfile): ModelOption[] {
  try {
    const raw = JSON.parse(readFileSync(join(profile.configDir || join(homedir(), '.codex'), 'models_cache.json'), 'utf8')) as { models?: Array<Record<string, unknown>> }
    return (raw.models ?? []).filter((item) => typeof item.slug === 'string' && item.visibility !== 'hide' && item.visibility !== 'none').map((item) => {
      const levels = (Array.isArray(item.supported_reasoning_levels) ? item.supported_reasoning_levels : []) as Array<{ effort?: string } | string>
      const efforts = levels.map((level) => (typeof level === 'string' ? level : level.effort)).filter((effort): effort is Effort => typeof effort === 'string')
      return { id: item.slug as string, label: typeof item.display_name === 'string' ? item.display_name : (item.slug as string), description: typeof item.description === 'string' ? item.description : '', efforts, recommendedFor: [] as Array<'planning' | 'execution' | 'test'>, defaultEffort: (typeof item.default_reasoning_level === 'string' ? item.default_reasoning_level : efforts[0] ?? null) as Effort | null }
    }).map((model, index) => ({ ...model, recommendedFor: index === 0 ? ['planning' as const, 'execution' as const] : [] }))
  } catch { return [] }
}

async function listCodexModelsLive(profile: AgentProfile, processes: ProcessFactory, timeoutMs: number): Promise<ModelOption[]> {
  const child = processes.start(profile.executablePath || 'codex', ['app-server', '--listen', 'stdio://'], { cwd: process.cwd(), env: { ...process.env, CODEX_HOME: profile.configDir } })
  const rpc = new JsonLineRpc(child)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; rpc.stop() }, timeoutMs)
  try {
    await rpc.request('initialize', { clientInfo: { name: 'agentboard', title: 'AgentBoard', version: '0.1.0' }, capabilities: null })
    rpc.notify('initialized')
    const result = await rpc.request('model/list', {}) as unknown as { data?: Array<{ model: string; displayName: string; description: string; hidden: boolean; isDefault: boolean; defaultReasoningEffort: Effort; supportedReasoningEfforts: Array<{ reasoningEffort: Effort }> }> }
    return (result.data ?? []).filter((model) => !model.hidden).map((model) => ({ id: model.model, label: model.displayName, description: model.description, efforts: model.supportedReasoningEfforts.map((item) => item.reasoningEffort), recommendedFor: model.isDefault ? ['planning', 'execution'] as const : [], defaultEffort: model.defaultReasoningEffort })).map((model) => ({ ...model, recommendedFor: [...model.recommendedFor] }))
  } catch (error) {
    throw timedOut ? new Error('O Codex não respondeu a tempo ao listar os modelos.') : error
  } finally { clearTimeout(timer); rpc.stop() }
}

/** Chamada mínima ao Claude só para ler o `rate_limit_event` (limite de uso); encerra o processo assim que o evento chega. */
export async function probeClaudeLimits(profile: AgentProfile, processes: ProcessFactory = nodeProcesses, timeoutMs = 90_000): Promise<Record<string, unknown> | null> {
  const child = processes.start(profile.executablePath || 'claude', ['--print', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--no-session-persistence', '--', 'responda apenas: ok'], { cwd: tmpdir(), env: { ...process.env, CLAUDE_CONFIG_DIR: profile.configDir } })
  child.stdin.end()
  return new Promise((resolve) => {
    let done = false
    const finish = (value: Record<string, unknown> | null): void => { if (done) return; done = true; clearTimeout(timer); if (!child.killed) child.kill(); resolve(value) }
    const timer = setTimeout(() => finish(null), timeoutMs)
    createInterface({ input: child.stdout }).on('line', (line) => {
      try { const message = JSON.parse(line) as Record<string, unknown>; if (message.type === 'rate_limit_event') finish(message) } catch { /* linha que não é JSON */ }
    })
    child.on('error', () => finish(null)); child.on('exit', () => finish(null))
  })
}

export class ClaudeCliAdapter implements AgentAdapter {
  constructor(private readonly processes: ProcessFactory = nodeProcesses) {}
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    // Em `plan` o Claude se recusa a chamar ferramentas que gravam (inclusive as do AgentBoard; confirmado em teste real).
    // Com o MCP ligado, o planejamento usa o modo padrão só com ferramentas de leitura + as do AgentBoard; sem MCP, `plan` e documentos por marcadores.
    const readOnlyPlanning = options.planning && Boolean(options.mcp)
    const executionMode = claudePermissionMode[options.mode ?? 'accept_edits']
    if (!options.planning && !executionMode) throw new Error(`Modo não suportado pelo Claude: ${String(options.mode)}`)
    const args = ['--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', options.planning ? (readOnlyPlanning ? 'default' : 'plan') : executionMode!]
    if (options.model) args.push('--model', options.model)
    if (options.effort) args.push('--effort', options.effort)
    if (readOnlyPlanning) args.push('--tools', 'Read,Grep,Glob,WebSearch,WebFetch')
    if (options.pluginDir) args.push('--plugin-dir', options.pluginDir)
    if (options.mcp) args.push('--mcp-config', JSON.stringify({ mcpServers: { agentboard: { command: options.mcp.command, args: options.mcp.args, env: options.mcp.env } } }), '--allowedTools', 'mcp__agentboard')
    if (options.sessionId) args.push('--resume', options.sessionId)
    args.push('--', options.prompt)
    const child = this.processes.start(options.profile.executablePath || 'claude', args, { cwd: options.cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: options.profile.configDir } })
    child.stdin.end()
    let text = '', sessionId = options.sessionId ?? '', stderr = ''
    const abort = () => child.kill(); options.signal?.addEventListener('abort', abort, { once: true })
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000) })
    return new Promise<AgentRunResult>((resolve, reject) => {
      createInterface({ input: child.stdout }).on('line', (line) => {
        let message: JsonObject; try { message = JSON.parse(line) as JsonObject } catch { return }
        if (typeof message.session_id === 'string') sessionId = message.session_id
        const event = message.event as JsonObject | undefined, delta = event?.delta as JsonObject | undefined
        if (message.type === 'stream_event' && delta?.type === 'text_delta' && typeof delta.text === 'string') { text += delta.text; options.onEvent({ type: 'item/agentMessage/delta', payload: { delta: delta.text } }) }
        else options.onEvent({ type: `claude/${String(message.type ?? 'event')}`, payload: redactObject(message) })
        if (message.type === 'result') {
          if (!text && typeof message.result === 'string') text = message.result
          resolve({ sessionId, turnId: null, text, status: message.is_error ? 'failed' : 'completed', error: message.is_error ? sanitize(String(message.result ?? 'Claude failed')) : null })
        }
      })
      child.on('error', (error) => reject(error))
      child.on('exit', (code) => { if (options.signal?.aborted) resolve({ sessionId, turnId: null, text, status: 'interrupted', error: 'Interrompido pelo usuário' }); else if (code !== 0) reject(new Error(`Claude exited (${code}): ${sanitize(stderr)}`)) })
    }).finally(() => options.signal?.removeEventListener('abort', abort))
  }
}

function redactObject(value: Record<string, unknown>): Record<string, unknown> { return JSON.parse(sanitize(JSON.stringify(value))) as Record<string, unknown> }
function sanitize(value: string): string { return value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[redacted]').slice(0, 100_000) }

function safeExecutable(command: string): string {
  if (process.platform !== 'win32') return command
  command = resolveCommand(command, process.env)
  if (isAbsolute(command)) {
    if (!['.exe', '.cmd', '.bat'].includes(extname(command).toLowerCase())) throw new Error('No Windows, o agente deve apontar para um arquivo .exe, .cmd ou .bat')
    return command
  }
  const folders = (process.env.PATH ?? '').split(delimiter)
  for (const extension of ['.exe', '.cmd', '.bat']) {
    for (const folder of folders) {
      const candidate = join(folder, `${command}${extension}`)
      if (existsSync(candidate)) return candidate
    }
  }
  throw new Error(`Executável seguro não encontrado no PATH: ${command}`)
}
