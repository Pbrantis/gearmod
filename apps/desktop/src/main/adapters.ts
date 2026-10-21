import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { AgentProfile } from '@agentboard/contracts'
import type { ServerNotification } from './generated/codex-app-server/ServerNotification'
import type { ThreadStartParams } from './generated/codex-app-server/v2/ThreadStartParams'
import type { TurnStartParams } from './generated/codex-app-server/v2/TurnStartParams'

export type AgentEvent = { type: string; payload: Record<string, unknown> }
export type AgentRunOptions = { cwd: string; prompt: string; sessionId: string | null; planning: boolean; profile: AgentProfile; signal?: AbortSignal; onEvent(event: AgentEvent): void }
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
      const policy = { cwd: options.cwd, approvalPolicy: 'never', sandbox: options.planning ? 'read-only' : 'workspace-write' } satisfies ThreadStartParams
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
      const turnParams: TurnStartParams = { threadId: thread.id, input: [{ type: 'text', text: options.prompt, text_elements: [] }], approvalPolicy: 'never' }
      const started = await rpc.request('turn/start', turnParams as unknown as JsonObject)
      turnId = (started.turn as { id?: string } | undefined)?.id ?? null
      return await completed
    } finally { options.signal?.removeEventListener('abort', abort); rpc.stop() }
  }
}

export class ClaudeCliAdapter implements AgentAdapter {
  constructor(private readonly processes: ProcessFactory = nodeProcesses) {}
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    const args = ['--print', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', options.planning ? 'plan' : 'default']
    if (options.sessionId) args.push('--resume', options.sessionId)
    args.push(options.prompt)
    const child = this.processes.start(options.profile.executablePath || 'claude', args, { cwd: options.cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: options.profile.configDir } })
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
