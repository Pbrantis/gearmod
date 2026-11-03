import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname } from 'node:path'
import { applyEnvPolicy } from './env-policy'
import { redact, redactObject } from './redaction'
import type { McpRunServer } from './mcp-registry'
import type { AgentRunOptions, AgentRunResult, ProcessFactory } from './adapters'
import { tm } from './i18n'

/**
 * Gemini CLI em modo ACP (Agent Client Protocol, JSON-RPC 2.0 em linhas por stdio), usado no modo "Padrão" para que cada ação
 * pendente apareça na tela de permissões do GearMod. Formatos: docs/GEMINI-ACP.md (esquema v1 do protocolo).
 * Fluxo: initialize → (authenticate se pedir) → session/new ou session/load → session/prompt; o agente manda `session/update`
 * (notificação) e `session/request_permission` (requisição que o app responde com a opção escolhida pelo usuário).
 */
type Json = Record<string, unknown>
const asObject = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {})

/** Servidores MCP no formato do `session/new`: stdio não tem `type`; http leva `type: "http"`; env e cabeçalhos são listas nome/valor. */
export function acpMcpServers(servers: McpRunServer[], gearmod?: { command: string; args: string[]; env: Record<string, string> }): Json[] {
  const pairs = (record: Record<string, string>): Array<{ name: string; value: string }> => Object.entries(record).map(([name, value]) => ({ name, value }))
  const all: Json[] = servers.map((server) => server.transport === 'stdio'
    ? { name: server.name, command: server.command, args: server.args, env: pairs(server.env) }
    : { type: 'http', name: server.name, url: server.url, headers: pairs(server.headers) })
  if (gearmod) all.unshift({ name: 'gearmod', command: gearmod.command, args: gearmod.args, env: pairs(gearmod.env) })
  return all
}

/** Escolhe a opção do pedido: aprovar usa "uma vez" (nunca "sempre"); negar usa "rejeitar uma vez". Sem opção compatível, cancela. */
export function acpPermissionOutcome(options: unknown, allow: boolean): Json {
  const list = (Array.isArray(options) ? options : []).map(asObject)
  const pick = (...kinds: string[]): Json | undefined => kinds.map((kind) => list.find((item) => item.kind === kind)).find(Boolean)
  const chosen = allow ? pick('allow_once') : pick('reject_once', 'reject_always')
  return chosen && typeof chosen.optionId === 'string' ? { outcome: 'selected', optionId: chosen.optionId } : { outcome: 'cancelled' }
}

/** Detalhes do pedido no formato que a tela de permissões já entende (comando, descrição, arquivos). */
export function acpPermissionDetails(params: Json): Json {
  const call = asObject(params.toolCall), input = asObject(call.rawInput)
  const locations = (Array.isArray(call.locations) ? call.locations : []).map(asObject).map((item) => item.path).filter((value): value is string => typeof value === 'string')
  return redactObject({ title: call.title, toolKind: call.kind, input, command: input.command, description: input.description ?? call.title, ...(locations.length ? { path: locations[0] } : {}), options: params.options })
}

export async function runGeminiAcp(processes: ProcessFactory, options: AgentRunOptions, flag = '--acp'): Promise<AgentRunResult> {
  const args = [flag, '--skip-trust']
  if (options.model) args.push('--model', options.model)
  for (const dir of new Set((options.attachments ?? []).map((path) => dirname(path)))) args.push('--include-directories', dir)
  const env: NodeJS.ProcessEnv = { ...applyEnvPolicy(options.profile, process.env), GEMINI_CLI_HOME: options.profile.configDir, GEMINI_CLI_TRUST_WORKSPACE: 'true', ...options.env }
  const child: ChildProcessWithoutNullStreams = processes.start(options.profile.executablePath || 'gemini', args, { cwd: options.cwd, env })
  let nextId = 1, stderr = '', text = '', sessionId = options.sessionId ?? '', replaying = false, ended = false
  const pending = new Map<number, { resolve(value: Json): void; reject(error: Error): void }>()
  const write = (message: Json): void => { if (child.stdin.writable && !child.stdin.destroyed) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`) }
  const request = (method: string, params: Json): Promise<Json> => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); write({ id, method, params }) })
  const failAll = (error: Error): void => { for (const item of pending.values()) item.reject(error); pending.clear() }
  child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000) })
  child.stdin.on('error', () => undefined)
  child.on('error', (error) => failAll(error))
  child.on('exit', (code) => { if (!ended) failAll(new Error(tm().adapters.geminiExited(code, redact(stderr)))) })
  // Pedidos de permissão em andamento: ao cancelar, todos são respondidos como "cancelled" (exigência do protocolo).
  const open = new Map<number, AbortController>()
  const abort = (): void => { for (const control of open.values()) control.abort(); if (sessionId) write({ method: 'session/cancel', params: { sessionId } }) }
  options.signal?.addEventListener('abort', abort, { once: true })

  createInterface({ input: child.stdout }).on('line', (line) => {
    let message: Json; try { message = JSON.parse(line) as Json } catch { return }
    const id = message.id, method = message.method
    if (typeof method !== 'string') {
      const waiting = typeof id === 'number' ? pending.get(id) : undefined
      if (!waiting) return
      pending.delete(id as number)
      const error = asObject(message.error)
      if (message.error) waiting.reject(Object.assign(new Error(redact(String(error.message ?? tm().adapters.geminiError))), { code: error.code }))
      else waiting.resolve(asObject(message.result))
      return
    }
    const params = asObject(message.params)
    if (method === 'session/update') {
      const update = asObject(params.update), kind = String(update.sessionUpdate ?? '')
      if (replaying) return
      if (kind === 'agent_message_chunk') {
        const content = asObject(update.content)
        if (content.type === 'text' && typeof content.text === 'string') { text += content.text; options.onEvent({ type: 'item/agentMessage/delta', payload: { delta: content.text } }) }
      } else if (kind === 'tool_call') options.onEvent({ type: 'gemini/tool_use', payload: redactObject({ tool_name: update.title ?? update.kind ?? 'ferramenta', tool_id: update.toolCallId, parameters: asObject(update.rawInput) }) })
      else if (kind === 'tool_call_update' && (update.status === 'completed' || update.status === 'failed')) options.onEvent({ type: 'gemini/tool_result', payload: redactObject({ tool_id: update.toolCallId, status: update.status === 'failed' ? 'error' : 'success' }) })
      return
    }
    if (method === 'session/request_permission' && id !== undefined) {
      const control = new AbortController(), key = typeof id === 'number' ? id : Number(id)
      open.set(key, control)
      const ask = options.requestPermission
      if (!ask) { write({ id, result: { outcome: acpPermissionOutcome(params.options, false) } }); return }
      void ask('gemini/permission', acpPermissionDetails(params), control.signal)
        .then((allow) => write({ id, result: { outcome: control.signal.aborted ? { outcome: 'cancelled' } : acpPermissionOutcome(params.options, allow) } }), () => write({ id, result: { outcome: { outcome: 'cancelled' } } }))
        .finally(() => open.delete(key))
      return
    }
    // Qualquer outro pedido do agente (sistema de arquivos, terminal…) não foi anunciado nas capacidades: recusa clara.
    if (id !== undefined) write({ id, error: { code: -32601, message: 'Method not supported by GearMod' } })
  })

  const finish = (result: AgentRunResult): AgentRunResult => { ended = true; options.signal?.removeEventListener('abort', abort); try { child.stdin.end() } catch { /* já fechado */ } if (!child.killed) child.kill(); return result }
  const servers = acpMcpServers(options.mcpServers ?? [], options.mcp)
  try {
    if (options.signal?.aborted) return finish({ sessionId, turnId: null, text, status: 'interrupted', error: 'Interrompido pelo usuário' })
    const init = await request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } })
    const canLoad = asObject(init.agentCapabilities).loadSession === true
    const authMethod = asObject((Array.isArray(init.authMethods) ? init.authMethods : [])[0]).id
    const open_ = async (): Promise<void> => {
      if (sessionId && canLoad) { replaying = true; try { await request('session/load', { sessionId, cwd: options.cwd, mcpServers: servers }) } finally { replaying = false }; return }
      const created = await request('session/new', { cwd: options.cwd, mcpServers: servers })
      sessionId = String(created.sessionId ?? '')
    }
    try { await open_() } catch (error) {
      // Sem login ativo o Gemini pede `authenticate`; usa o primeiro método que ele anunciou (o login em si é feito pelo usuário no CLI).
      if (typeof authMethod === 'string' && /auth|login|credential/i.test(error instanceof Error ? error.message : '')) { await request('authenticate', { methodId: authMethod }); await open_() } else throw error
    }
    options.onEvent({ type: 'gemini/init', payload: { session_id: sessionId } })
    const prompt = `${options.developerInstructions ? `${options.developerInstructions}\n\n` : ''}${options.prompt}`
    const done = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] })
    const stop = String(done.stopReason ?? 'end_turn')
    if (stop === 'cancelled') return finish({ sessionId, turnId: null, text, status: 'interrupted', error: 'Interrompido pelo usuário' })
    if (stop === 'refusal') return finish({ sessionId, turnId: null, text, status: 'failed', error: 'O Gemini recusou o pedido.' })
    return finish({ sessionId, turnId: null, text, status: 'completed', error: null })
  } catch (error) {
    if (options.signal?.aborted) return finish({ sessionId, turnId: null, text, status: 'interrupted', error: 'Interrompido pelo usuário' })
    const message = redact(error instanceof Error ? error.message : String(error))
    finish({ sessionId, turnId: null, text, status: 'failed', error: message })
    if (/unknown|unrecognized|invalid.*(option|argument)/i.test(`${message} ${stderr}`) && flag === '--acp') return runGeminiAcp(processes, options, '--experimental-acp')
    return { sessionId, turnId: null, text, status: 'failed', error: message }
  }
}
