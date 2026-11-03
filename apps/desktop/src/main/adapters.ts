import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { delimiter, dirname, extname, isAbsolute, join } from 'node:path'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { resolveCommand } from './agents'
import type { AgentProfile, Effort, ModelOption, PermissionMode } from '@agentboard/contracts'
import { effortSchema } from '@agentboard/contracts'
import type { McpEndpoint } from './mcp-bridge'
import { claudeMcpServers, codexMcpServers, type McpRunServer } from './mcp-registry'
import type { ServerNotification } from './generated/codex-app-server/ServerNotification'
import type { ThreadStartParams } from './generated/codex-app-server/v2/ThreadStartParams'
import type { ReasoningEffort } from './generated/codex-app-server/ReasoningEffort'
import type { SandboxMode } from './generated/codex-app-server/v2/SandboxMode'
import type { AskForApproval } from './generated/codex-app-server/v2/AskForApproval'
import type { ApprovalsReviewer } from './generated/codex-app-server/v2/ApprovalsReviewer'
import type { TurnStartParams } from './generated/codex-app-server/v2/TurnStartParams'
import { redact, redactObject } from './redaction'
import { applyEnvPolicy } from './env-policy'
import { tm } from './i18n'

export type AgentEvent = { type: string; payload: Record<string, unknown> }
export type AgentRunOptions = { cwd: string; addDirs?: string[]; prompt: string; sessionId: string | null; planning: boolean; profile: AgentProfile; pluginDir?: string | null; env?: Record<string, string>; mcpServers?: McpRunServer[]; mcp?: McpEndpoint; model?: string | null; effort?: Effort | null; mode?: PermissionMode; developerInstructions?: string; attachments?: string[]; signal?: AbortSignal; requestPermission?(kind: string, details: Record<string, unknown>, signal?: AbortSignal): Promise<boolean>; onEvent(event: AgentEvent): void }
/** `costUsd`: só quando o próprio agente informa (Claude: `total_cost_usd` do result); nunca estimado aqui. */
export type RunTokens = { input: number; cached: number; output: number; costUsd?: number }
export type AgentRunResult = { sessionId: string; turnId: string | null; text: string; status: 'completed' | 'failed' | 'interrupted'; error: string | null; usage?: RunTokens; modelEffective?: string; apiKeySource?: string }
export interface AgentAdapter { run(options: AgentRunOptions): Promise<AgentRunResult> }

type JsonObject = Record<string, unknown>
export interface ProcessFactory { start(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcessWithoutNullStreams }
export const nodeProcesses: ProcessFactory = { start(command, args, options) {
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
  respond(id: string | number, result: JsonObject): void { this.write({ id, result }) }
  unsupported(id: string | number): void { this.write({ id, error: { code: -32601, message: 'Agent request not supported by AgentBoard' } }) }
  stop(): void { if (!this.process.killed) this.process.kill() }
  private write(value: JsonObject): void { if (!this.process.stdin.writable || this.process.stdin.destroyed) return; this.process.stdin.write(`${JSON.stringify(value)}\n`) }
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

const codexEfforts = new Set<string>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
/** Anexos que vão para o Codex como imagem (ele vê o conteúdo), além do caminho no texto. */
const imageExtensions = /\.(png|jpe?g|gif|webp|bmp)$/i
/** Esforços que o AgentBoard conhece; um nível novo do provedor é ignorado em vez de invalidar a lista de modelos inteira. */
const knownEffort = (value: unknown): value is Effort => effortSchema.safeParse(value).success
/**
 * As ferramentas do AgentBoard já checam quem pode chamar o quê (ex.: só o chat da Constituição a grava). Sem isto, no modo só leitura
 * (aprovação "never") o Codex recusa toda ferramenta que escreve, e o planejamento e o chat da Constituição não conseguiam gravar.
 */
export const agentboardToolApproval = { default_tools_approval_mode: 'approve' } as const

/** Modos de permissão do AgentBoard → sandbox, política de aprovação e revisor do Codex (plano 08, seção 6). */
export function codexAccess(mode: PermissionMode): { sandbox: SandboxMode; approvalPolicy: AskForApproval; approvalsReviewer?: ApprovalsReviewer } {
  switch (mode) {
    case 'plan': return { sandbox: 'read-only', approvalPolicy: 'never' }
    case 'auto': return { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' }
    case 'on_request': return { sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' }
    case 'read_only': return { sandbox: 'read-only', approvalPolicy: 'on-request', approvalsReviewer: 'user' }
    case 'bypass': return { sandbox: 'danger-full-access', approvalPolicy: 'never' }
    default: throw new Error(tm().adapters.unsupportedCodexMode(mode))
  }
}

/** Modos do AgentBoard → `--permission-mode` do Claude. */
export const claudePermissionMode: Record<PermissionMode, string | null> = { plan: 'plan', auto: 'auto', accept_edits: 'acceptEdits', manual: 'manual', on_request: null, read_only: null, bypass: 'bypassPermissions' }

export class CodexAppServerAdapter implements AgentAdapter {
  constructor(private readonly processes: ProcessFactory = nodeProcesses, private readonly timing = { graceMs: 60_000, pendingIdleMs: 10 * 60_000 }) {}
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    if (options.signal?.aborted) throw new Error(tm().common.executionCancelled)
    const child = this.processes.start(options.profile.executablePath || 'codex', ['app-server', '--listen', 'stdio://'], { cwd: options.cwd, env: { ...applyEnvPolicy(options.profile, process.env), CODEX_HOME: options.profile.configDir, ...options.env } })
    const rpc = new JsonLineRpc(child)
    const approvals = new ProviderApprovals(options)
    const abort = () => { approvals.close(); rpc.stop() }; options.signal?.addEventListener('abort', abort, { once: true })
    let text = '', turnId: string | null = null, modelEffective: string | undefined
    let turnAbort: (() => void) | undefined
    const items = new Map<string, JsonObject>()
    // O Codex avisa o uso a cada chamada ao modelo (`last`); soma só quando o total do thread muda, para não contar aviso repetido.
    const usage: RunTokens = { input: 0, cached: 0, output: 0 }; let lastTotal = -1
    try {
      await rpc.request('initialize', { clientInfo: { name: 'agentboard', title: 'AgentBoard', version: '0.1.0' }, capabilities: null })
      rpc.notify('initialized')
      const access = codexAccess(options.planning ? 'plan' : options.mode ?? 'auto')
      const policy = { cwd: options.cwd, ...access, ...(options.model ? { model: options.model } : {}), ...(options.developerInstructions ? { developerInstructions: options.developerInstructions } : {}), ...(options.mcp || options.mcpServers?.length ? { config: { mcp_servers: { ...codexMcpServers(options.mcpServers ?? []), ...(options.mcp ? { agentboard: { command: options.mcp.command, args: options.mcp.args, env: options.mcp.env, ...agentboardToolApproval } } : {}) } } } : {}) } satisfies ThreadStartParams
      const threadResult = options.sessionId
        ? await rpc.request('thread/resume', { threadId: options.sessionId, ...policy })
        : await rpc.request('thread/start', policy)
      const thread = threadResult.thread as { id: string }
      if (typeof (threadResult as Record<string, unknown>).model === 'string') modelEffective = (threadResult as Record<string, unknown>).model as string
      const completed = new Promise<AgentRunResult>((resolve, reject) => {
        const onAbort = turnAbort = () => resolve({ sessionId: thread.id, turnId, text, status: 'interrupted', error: 'Interrompido pelo usuário', usage: { ...usage } })
        options.signal?.addEventListener('abort', onAbort, { once: true })
        rpc.onMessage((raw) => {
          if (typeof raw.id === 'string' || typeof raw.id === 'number') {
            const id = raw.id, method = String(raw.method), params = (raw.params ?? {}) as JsonObject
            if ((params.threadId ?? params.conversationId) !== thread.id || (turnId && params.turnId && params.turnId !== turnId)) { rpc.unsupported(id); return }
            const permission = method === 'item/permissions/requestApproval'
            const modern = method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval'
            const legacy = method === 'execCommandApproval' || method === 'applyPatchApproval'
            if (permission || modern || legacy) {
              approvals.ask(JSON.stringify(id), method, { ...params, ...(typeof params.itemId === 'string' && items.has(params.itemId) ? { item: items.get(params.itemId) } : {}) }, (allow) => {
                if (permission) {
                  const requested = (params.permissions ?? {}) as JsonObject
                  rpc.respond(id, { permissions: allow ? Object.fromEntries(Object.entries(requested).filter(([, value]) => value !== null)) : {}, scope: 'turn' })
                } else rpc.respond(id, { decision: modern ? (allow ? 'accept' : 'decline') : (allow ? 'approved' : 'denied') })
              })
            } else rpc.unsupported(id)
            return
          }
          const event = raw as unknown as ServerNotification
          if (!('method' in event)) return
          const params = (event.params ?? {}) as unknown as Record<string, unknown>
          if (params.item && typeof params.item === 'object' && params.threadId === thread.id) { const item = params.item as JsonObject; if (typeof item.id === 'string') items.set(item.id, item) }
          if (event.method === 'item/agentMessage/delta') { const delta = String(params.delta ?? ''); text += delta; options.onEvent({ type: event.method, payload: { delta } }) }
          else options.onEvent({ type: event.method, payload: redactObject(params) })
          if (event.method === 'serverRequest/resolved' && params.threadId === thread.id) approvals.cancel(JSON.stringify(params.requestId))
          if (event.method === 'thread/tokenUsage/updated') {
            const token = params.tokenUsage as { total?: { totalTokens?: number }; last?: { inputTokens?: number; cachedInputTokens?: number; outputTokens?: number } } | undefined
            if (token?.last && token.total?.totalTokens !== lastTotal) {
              lastTotal = token.total?.totalTokens ?? lastTotal
              const cached = token.last.cachedInputTokens ?? 0
              usage.cached += cached; usage.input += Math.max(0, (token.last.inputTokens ?? 0) - cached); usage.output += token.last.outputTokens ?? 0
              options.onEvent({ type: 'tokens.update', payload: { input: Math.max(0, (token.last.inputTokens ?? 0) - cached), cached, output: token.last.outputTokens ?? 0 } })
            }
          }
          if (event.method === 'turn/completed' && params.threadId === thread.id) {
            approvals.close()
            const turn = params.turn as { id?: string; status?: string; error?: unknown }; turnId = turn.id ?? turnId
            const status = turn.status === 'completed' ? 'completed' : turn.status === 'interrupted' ? 'interrupted' : 'failed'
            const turnModel = typeof (turn as Record<string, unknown>).model === 'string' ? (turn as Record<string, unknown>).model as string : undefined
            resolve({ sessionId: thread.id, turnId, text, status, error: status === 'failed' ? sanitize(JSON.stringify(turn.error ?? 'Turn failed')) : null, usage: { ...usage }, ...(turnModel ?? modelEffective ? { modelEffective: turnModel ?? modelEffective } : {}) })
          }
          if (event.method === 'error') reject(new Error(sanitize(JSON.stringify(params))))
        })
      })
      const turnParams: TurnStartParams = { threadId: thread.id, input: [{ type: 'text', text: options.prompt, text_elements: [] }, ...(options.attachments ?? []).filter((path) => imageExtensions.test(path)).map((path) => ({ type: 'localImage' as const, path }))], approvalPolicy: access.approvalPolicy, ...(access.approvalsReviewer ? { approvalsReviewer: access.approvalsReviewer } : {}), ...(options.model ? { model: options.model } : {}), ...(options.effort && codexEfforts.has(options.effort) ? { effort: options.effort as ReasoningEffort } : {}) }
      const started = await rpc.request('turn/start', turnParams as unknown as JsonObject)
      turnId = (started.turn as { id?: string } | undefined)?.id ?? null
      return await completed
    } finally { approvals.close(); if (turnAbort) options.signal?.removeEventListener('abort', turnAbort); options.signal?.removeEventListener('abort', abort); rpc.stop() }
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
  throw new Error(tm().adapters.noCodexModels)
}

/** Leitura oficial de quota do App Server; o chamador mantém fallback nos arquivos de sessão. */
export async function readCodexQuota(profile: AgentProfile, processes: ProcessFactory = nodeProcesses, timeoutMs = 15_000): Promise<Record<string, unknown> | null> {
  const child = processes.start(profile.executablePath || 'codex', ['app-server', '--listen', 'stdio://'], { cwd: process.cwd(), env: { ...applyEnvPolicy(profile, process.env), CODEX_HOME: profile.configDir } })
  const rpc = new JsonLineRpc(child); let timedOut = false
  const timer = setTimeout(() => { timedOut = true; rpc.stop() }, timeoutMs)
  try {
    await rpc.request('initialize', { clientInfo: { name: 'agentboard', title: 'AgentBoard', version: '0.1.0' }, capabilities: null })
    rpc.notify('initialized')
    return await rpc.request('account/rateLimits/read', {})
  } catch (error) { if (timedOut) return null; throw error } finally { clearTimeout(timer); rpc.stop() }
}

/** Plano B: o Codex guarda o último catálogo em `models_cache.json` dentro do CODEX_HOME. */
export function readCodexModelsCache(profile: AgentProfile): ModelOption[] {
  try {
    const raw = JSON.parse(readFileSync(join(profile.configDir || join(homedir(), '.codex'), 'models_cache.json'), 'utf8')) as { models?: Array<Record<string, unknown>> }
    return (raw.models ?? []).filter((item) => typeof item.slug === 'string' && item.visibility !== 'hide' && item.visibility !== 'none').map((item) => {
      const levels = (Array.isArray(item.supported_reasoning_levels) ? item.supported_reasoning_levels : []) as Array<{ effort?: string } | string>
      const efforts = levels.map((level) => (typeof level === 'string' ? level : level.effort)).filter(knownEffort)
      return { id: item.slug as string, label: typeof item.display_name === 'string' ? item.display_name : (item.slug as string), description: typeof item.description === 'string' ? item.description : '', efforts, recommendedFor: [] as Array<'planning' | 'execution' | 'test'>, defaultEffort: knownEffort(item.default_reasoning_level) ? item.default_reasoning_level : efforts[0] ?? null }
    }).map((model, index) => ({ ...model, recommendedFor: index === 0 ? ['planning' as const, 'execution' as const] : [] }))
  } catch { return [] }
}

async function listCodexModelsLive(profile: AgentProfile, processes: ProcessFactory, timeoutMs: number): Promise<ModelOption[]> {
  const child = processes.start(profile.executablePath || 'codex', ['app-server', '--listen', 'stdio://'], { cwd: process.cwd(), env: { ...applyEnvPolicy(profile, process.env), CODEX_HOME: profile.configDir } })
  const rpc = new JsonLineRpc(child)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; rpc.stop() }, timeoutMs)
  try {
    await rpc.request('initialize', { clientInfo: { name: 'agentboard', title: 'AgentBoard', version: '0.1.0' }, capabilities: null })
    rpc.notify('initialized')
    const result = await rpc.request('model/list', {}) as unknown as { data?: Array<{ model: string; displayName: string; description: string; hidden: boolean; isDefault: boolean; defaultReasoningEffort: Effort; supportedReasoningEfforts: Array<{ reasoningEffort: Effort }> }> }
    return (result.data ?? []).filter((model) => !model.hidden).map((model) => ({ id: model.model, label: model.displayName, description: model.description, efforts: model.supportedReasoningEfforts.map((item) => item.reasoningEffort).filter(knownEffort), recommendedFor: model.isDefault ? ['planning', 'execution'] as const : [], defaultEffort: knownEffort(model.defaultReasoningEffort) ? model.defaultReasoningEffort : null })).map((model) => ({ ...model, recommendedFor: [...model.recommendedFor] }))
  } catch (error) {
    throw timedOut ? new Error(tm().adapters.codexModelsTimeout) : error
  } finally { clearTimeout(timer); rpc.stop() }
}

/** Chamada mínima ao Claude só para ler o `rate_limit_event` (limite de uso); encerra o processo assim que o evento chega. */
export async function probeClaudeLimits(profile: AgentProfile, processes: ProcessFactory = nodeProcesses, timeoutMs = 90_000): Promise<Record<string, unknown> | null> {
  const child = processes.start(profile.executablePath || 'claude', ['--print', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--no-session-persistence', '--', 'responda apenas: ok'], { cwd: tmpdir(), env: { ...applyEnvPolicy(profile, process.env), CLAUDE_CONFIG_DIR: profile.configDir } })
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

/** Pede ao Haiku (modelo barato) uma mensagem de commit para as alterações; devolve só o resumo de uma linha. */
export async function suggestCommitMessage(profile: AgentProfile, context: string, processes: ProcessFactory = nodeProcesses, timeoutMs = 60_000): Promise<string> {
  const child = processes.start(profile.executablePath || 'claude', ['--print', '--output-format', 'text', '--model', 'haiku', '--no-session-persistence'], { cwd: tmpdir(), env: { ...applyEnvPolicy(profile, process.env), CLAUDE_CONFIG_DIR: profile.configDir } })
  child.stdin.end(`Escreva a mensagem de commit destas alterações. Responda só com UMA linha (até 72 caracteres), sem aspas, sem ponto final, sem explicação, no mesmo idioma e estilo dos commits recentes.

${context}`)
  return new Promise((resolve, reject) => {
    let out = '', done = false
    const finish = (error?: Error): void => { if (done) return; done = true; clearTimeout(timer); if (!child.killed) child.kill(); const line = out.split(/\r?\n/).map((item) => item.trim()).find(Boolean)?.replace(/^["'`]+|["'`]+$/g, '') ?? ''; if (error) reject(error); else if (line) resolve(line.slice(0, 200)); else reject(new Error(tm().adapters.commitSuggestEmpty)) }
    const timer = setTimeout(() => finish(new Error(tm().adapters.commitSuggestTimeout)), timeoutMs)
    child.stdout.on('data', (chunk: Buffer | string) => { out += chunk.toString() })
    child.on('error', (error: Error) => finish(error)); child.on('exit', (code: number | null) => finish(code ? new Error(out.trim().slice(0, 300) || tm().adapters.commitSuggestEmpty) : undefined))
  })
}

export class ClaudeCliAdapter implements AgentAdapter {
  constructor(private readonly processes: ProcessFactory = nodeProcesses, private readonly timing = { graceMs: 60_000, pendingIdleMs: 10 * 60_000 }) {}
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    if (options.signal?.aborted) throw new Error(tm().common.executionCancelled)
    // Em `plan` o Claude se recusa a chamar ferramentas que gravam (inclusive as do AgentBoard; confirmado em teste real).
    // Com o MCP ligado, o planejamento usa o modo padrão só com ferramentas de leitura + as do AgentBoard; sem MCP, `plan` e documentos por marcadores.
    const readOnlyPlanning = options.planning && Boolean(options.mcp)
    const executionMode = claudePermissionMode[options.mode ?? 'accept_edits']
    if (!options.planning && !executionMode) throw new Error(tm().adapters.unsupportedClaudeMode(String(options.mode)))
    const args = ['--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', options.planning ? (readOnlyPlanning ? 'default' : 'plan') : executionMode!]
    if (options.model) args.push('--model', options.model)
    if (options.effort) args.push('--effort', options.effort)
    if (readOnlyPlanning) args.push('--tools', 'Read,Grep,Glob,WebSearch,WebFetch')
    if (options.pluginDir) args.push('--plugin-dir', options.pluginDir)
    // A config do MCP leva env e headers (segredos): vai por arquivo temporário e não pela linha de comando, que aparece na lista de processos.
    let mcpConfigDir: string | null = null
    if (options.mcp || options.mcpServers?.length) {
      mcpConfigDir = mkdtempSync(join(tmpdir(), 'agentboard-mcp-'))
      const file = join(mcpConfigDir, 'mcp.json')
      writeFileSync(file, JSON.stringify({ mcpServers: { ...claudeMcpServers(options.mcpServers ?? []), ...(options.mcp ? { agentboard: { command: options.mcp.command, args: options.mcp.args, env: options.mcp.env } } : {}) } }), { mode: 0o600 })
      args.push('--mcp-config', file)
    }
    if (options.mcp) args.push('--allowedTools', 'mcp__agentboard')
    if (options.sessionId) args.push('--resume', options.sessionId)
    // Anexos fora da pasta do projeto: libera a leitura da pasta de cada um.
    for (const dir of new Set([...(options.attachments ?? []).map((path) => dirname(path)), ...(options.addDirs ?? [])])) args.push('--add-dir', dir)
    const interactive = Boolean(options.requestPermission)
    if (interactive) args.push('--input-format', 'stream-json', '--permission-prompt-tool', 'stdio')
    else args.push('--', options.prompt)
    const child = this.processes.start(options.profile.executablePath || 'claude', args, { cwd: options.cwd, env: { ...applyEnvPolicy(options.profile, process.env), CLAUDE_CONFIG_DIR: options.profile.configDir, ...options.env } })
    const approvals = new ProviderApprovals(options)
    if (!interactive) child.stdin.end()
    let text = '', sessionId = options.sessionId ?? '', stderr = '', apiKeySource: string | undefined
    const abort = () => { approvals.close(); child.kill() }; options.signal?.addEventListener('abort', abort, { once: true })
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000) })
    return new Promise<AgentRunResult>((resolve, reject) => {
      // Tarefas em segundo plano (subagentes e comandos): o `result` do turno chega com elas ainda rodando. O processo só pode sair quando todas
      // terminarem e o Claude responder à notificação delas (outro `result`); se não responder, vale o último resultado depois de uma folga.
      const pending = new Set<string>(), { graceMs: grace, pendingIdleMs } = this.timing
      let deferred: AgentRunResult | null = null, graceTimer: NodeJS.Timeout | undefined, idleTimer: NodeJS.Timeout | undefined
      const finish = (result: AgentRunResult): void => { if (graceTimer) clearTimeout(graceTimer); if (idleTimer) clearTimeout(idleTimer); resolve(result) }
      // Tarefa em segundo plano que nunca avisa que terminou (task_started sem task_notification): sem nenhuma atividade por `pendingIdleMs`, vale o resultado do turno.
      const armIdle = (): void => { if (!deferred) return; if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (deferred) { const last = deferred; child.kill(); finish(last) } }, pendingIdleMs) }
      const settle = (): void => { if (deferred && !pending.size && !graceTimer) { const last = deferred; graceTimer = setTimeout(() => finish(last), grace) } }
      createInterface({ input: child.stdout }).on('line', (line) => {
        let message: JsonObject; try { message = JSON.parse(line) as JsonObject } catch { return }
        if (message.type === 'control_request' && typeof message.request_id === 'string') {
          const id = message.request_id, request = (message.request ?? {}) as JsonObject
          const respond = (allow: boolean): void => { if (!child.stdin.writable || child.stdin.destroyed) return; child.stdin.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response: allow ? { behavior: 'allow', updatedInput: request.input ?? {} } : { behavior: 'deny', message: 'Permission denied by the user or the run has ended' } } })}\n`) }
          if (request.subtype === 'can_use_tool') approvals.ask(id, String(request.tool_name ?? 'Ferramenta'), request, respond)
          else child.stdin.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: id, error: 'Request not supported' } })}\n`)
          return
        }
        if (message.type === 'control_cancel_request' && typeof message.request_id === 'string') { approvals.cancel(message.request_id); return }
        if (typeof message.session_id === 'string') sessionId = message.session_id
        armIdle()
        if (message.type === 'system' && message.subtype === 'init' && typeof message.apiKeySource === 'string') apiKeySource = message.apiKeySource
        const event = message.event as JsonObject | undefined, delta = event?.delta as JsonObject | undefined
        if (message.type === 'stream_event' && delta?.type === 'text_delta' && typeof delta.text === 'string') { text += delta.text; options.onEvent({ type: 'item/agentMessage/delta', payload: { delta: delta.text } }) }
        else options.onEvent({ type: `claude/${String(message.type ?? 'event')}`, payload: redactObject(message) })
        if (message.type === 'system' && typeof message.task_id === 'string') {
          if (message.subtype === 'task_started') pending.add(message.task_id)
          else if (message.subtype === 'task_notification') { pending.delete(message.task_id); settle() }
        }
        if (message.type === 'result') {
          if (graceTimer) { clearTimeout(graceTimer); graceTimer = undefined }
          approvals.close()
          if (!text && typeof message.result === 'string') text = message.result
          const modelEffective = typeof message.model === 'string' ? message.model : typeof (message.result as JsonObject | undefined)?.model === 'string' ? (message.result as JsonObject).model as string : undefined
          const result: AgentRunResult = { sessionId, turnId: null, text, status: message.is_error ? 'failed' : 'completed', error: message.is_error ? sanitize(String(message.result ?? 'Claude failed')) : null, usage: claudeUsage(message.usage, message.total_cost_usd), ...(modelEffective ? { modelEffective } : {}), ...(apiKeySource ? { apiKeySource } : {}) }
          if (pending.size && !message.is_error) { deferred = result; armIdle() }
          else finish(result)
        }
      })
      child.on('error', (error) => reject(error))
      child.on('exit', (code) => { if (deferred && !options.signal?.aborted) { finish(deferred); return } if (options.signal?.aborted) resolve({ sessionId, turnId: null, text, status: 'interrupted', error: 'Interrompido pelo usuário' }); else reject(new Error(`Claude encerrou sem resultado (${code}): ${sanitize(stderr)}`)) })
      if (interactive) child.stdin.write(`${JSON.stringify({ type: 'user', session_id: '', message: { role: 'user', content: options.prompt }, parent_tool_use_id: null })}\n`)
      if (options.signal?.aborted) abort()
    }).finally(() => { approvals.close(); options.signal?.removeEventListener('abort', abort); if (!child.killed) child.kill(); if (mcpConfigDir) rmSync(mcpConfigDir, { recursive: true, force: true }) })
  }
}

/** Uso informado no `result` do Claude: o que foi criado no cache conta como leitura nova; a leitura do cache fica à parte. */
function claudeUsage(value: unknown, cost?: unknown): RunTokens | undefined {
  if (!value || typeof value !== 'object') return undefined
  const usage = value as Record<string, unknown>, count = (key: string): number => (typeof usage[key] === 'number' && Number.isFinite(usage[key]) ? Math.max(0, Math.round(usage[key] as number)) : 0)
  return { input: count('input_tokens') + count('cache_creation_input_tokens'), cached: count('cache_read_input_tokens'), output: count('output_tokens'), ...(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? { costUsd: cost } : {}) }
}
function sanitize(value: string): string { return redact(value) }

function safeExecutable(command: string): string {
  if (process.platform !== 'win32') return command
  command = resolveCommand(command, process.env)
  if (isAbsolute(command)) {
    if (!['.exe', '.cmd', '.bat'].includes(extname(command).toLowerCase())) throw new Error(tm().adapters.windowsExecutableRequired)
    return command
  }
  const folders = (process.env.PATH ?? '').split(delimiter)
  for (const extension of ['.exe', '.cmd', '.bat']) {
    for (const folder of folders) {
      const candidate = join(folder, `${command}${extension}`)
      if (existsSync(candidate)) return candidate
    }
  }
  throw new Error(tm().adapters.safeExecutableNotFound(command))
}

/** Responses are synchronous on close, before killing the provider process; late UI replies cannot write. */
class ProviderApprovals {
  private readonly pending = new Map<string, (allow: boolean, send?: boolean) => void>()
  private closed = false
  constructor(private readonly options: AgentRunOptions) {}
  ask(id: string, kind: string, details: JsonObject, respond: (allow: boolean) => void): void {
    if (this.closed || this.options.signal?.aborted || !this.options.requestPermission) { respond(false); return }
    if (this.pending.has(id)) return
    const controller = new AbortController()
    const finish = (allow: boolean, send = true): void => { if (!this.pending.delete(id)) return; if (send) respond(allow); controller.abort() }
    this.pending.set(id, finish)
    void this.options.requestPermission(kind, redactObject(details), controller.signal).then(finish, () => finish(false))
  }
  cancel(id: string): void { this.pending.get(id)?.(false, false) }
  close(): void { this.closed = true; for (const finish of this.pending.values()) finish(false) }
}
