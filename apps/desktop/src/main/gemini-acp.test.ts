import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { AgentProfile } from '@gearmod/contracts'
import { GeminiCliAdapter } from './gemini-adapter'
import { acpMcpServers, acpPermissionDetails, acpPermissionOutcome } from './gemini-acp'
import type { ProcessFactory } from './adapters'

type Json = Record<string, unknown>
const profile = { id: '10000000-0000-4000-8000-000000000001', provider: 'gemini', label: 'Gemini', scope: 'w', color: '#7BA7FF', configDir: 'C:\\profiles\\gemini', executablePath: null, enabled: true, billingMode: 'subscription', envPassthrough: [], createdAt: '', updatedAt: '' } as unknown as AgentProfile
const permissionOptions = [{ optionId: 'proceed_always', name: 'Sempre', kind: 'allow_always' }, { optionId: 'proceed_once', name: 'Uma vez', kind: 'allow_once' }, { optionId: 'cancel', name: 'Não', kind: 'reject_once' }]

/** Servidor ACP falso: responde aos pedidos do cliente e deixa o teste empurrar mensagens do agente. */
function fakeAcp(handle: (message: Json, reply: (id: unknown, result: Json) => void, send: (message: Json) => void, log: Json[]) => void, spawned: { args: string[]; log: Json[] }): ProcessFactory {
  return { start(_command, args) {
    spawned.args = args
    const emitter = new EventEmitter() as EventEmitter & Partial<ChildProcessWithoutNullStreams>
    const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough()
    Object.assign(emitter, { stdin, stdout, stderr, killed: false, kill() { return true } })
    const send = (message: Json): void => { stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`) }
    const reply = (id: unknown, result: Json): void => send({ id, result })
    let buffer = ''
    stdin.on('data', (chunk: Buffer) => { buffer += chunk.toString(); const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; for (const line of lines) if (line.trim()) { const message = JSON.parse(line) as Json; spawned.log.push(message); handle(message, reply, send, spawned.log) } })
    return emitter as ChildProcessWithoutNullStreams
  } }
}
const standard = (message: Json, reply: (id: unknown, result: Json) => void, send: (message: Json) => void, extra: { permission?: boolean; loadSession?: boolean } = {}): void => {
  if (message.method === 'initialize') reply(message.id, { protocolVersion: 1, agentCapabilities: { loadSession: extra.loadSession ?? false }, authMethods: [] })
  if (message.method === 'session/new') reply(message.id, { sessionId: 'acp-1' })
  if (message.method === 'session/load') { send({ method: 'session/update', params: { sessionId: 'acp-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'HISTÓRICO ANTIGO' } } } }); reply(message.id, {}) }
  if (message.method === 'session/prompt') {
    send({ method: 'session/update', params: { sessionId: 'acp-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Pronto' } } } })
    if (extra.permission) send({ id: 900, method: 'session/request_permission', params: { sessionId: 'acp-1', toolCall: { toolCallId: 't1', title: 'rm -rf build', kind: 'execute', status: 'pending', rawInput: { command: 'rm -rf build', description: 'Limpar a pasta build' } }, options: permissionOptions } })
    else reply(message.id, { stopReason: 'end_turn' })
  }
}
const adapter = (factory: ProcessFactory) => new GeminiCliAdapter(factory)
const base = { cwd: 'C:\\repo', prompt: 'faça X', sessionId: null, planning: false, mode: 'manual', profile, onEvent: () => undefined } as const

describe('Gemini in ACP mode (per-action approval)', () => {
  it('talks over ACP: initialize, session/new with MCP in ACP format, prompt and agent text', async () => {
    const spawned = { args: [] as string[], log: [] as Json[] }
    const events: string[] = []
    const result = await adapter(fakeAcp((m, r, s) => standard(m, r, s), spawned)).run({ ...base, model: 'flash', requestPermission: async () => true, onEvent: (event: { type: string }) => events.push(event.type), mcp: { command: 'node', args: ['a.mjs'], env: { A: '1' } }, mcpServers: [{ name: 'gh', transport: 'stdio', command: 'npx', args: ['x'], env: { T: 't' } }, { name: 'api', transport: 'http', url: 'https://h/mcp', headers: { Authorization: 'z' } }] } as never)
    expect(result).toMatchObject({ sessionId: 'acp-1', text: 'Pronto', status: 'completed', error: null })
    expect(spawned.args).toEqual(['--acp', '--skip-trust', '--model', 'flash'])
    expect(spawned.log.map((m) => m.method)).toEqual(['initialize', 'session/new', 'session/prompt'])
    expect(spawned.log[0]!.params).toMatchObject({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } } })
    const created = spawned.log[1]!.params as { cwd: string; mcpServers: Json[] }
    expect(created.cwd).toBe('C:\\repo')
    expect(created.mcpServers).toEqual([{ name: 'gearmod', command: 'node', args: ['a.mjs'], env: [{ name: 'A', value: '1' }] }, { name: 'gh', command: 'npx', args: ['x'], env: [{ name: 'T', value: 't' }] }, { type: 'http', name: 'api', url: 'https://h/mcp', headers: [{ name: 'Authorization', value: 'z' }] }])
    expect(spawned.log[2]!.params).toMatchObject({ sessionId: 'acp-1', prompt: [{ type: 'text', text: 'faça X' }] })
    expect(events).toContain('item/agentMessage/delta')
  })

  it('approve: asks the user and answers with the "uma vez" option (never "sempre")', async () => {
    const spawned = { args: [] as string[], log: [] as Json[] }
    const asked: Array<{ kind: string; details: Json }> = []
    const handler = (m: Json, r: (id: unknown, result: Json) => void, s: (message: Json) => void): void => {
      standard(m, r, s, { permission: true })
      if (m.id === 900) r(spawned.log.find((x) => x.method === 'session/prompt')!.id, { stopReason: 'end_turn' })
    }
    const result = await adapter(fakeAcp(handler, spawned)).run({ ...base, requestPermission: async (kind: string, details: Json) => { asked.push({ kind, details }); return true } } as never)
    expect(result.status).toBe('completed')
    expect(asked[0]!.kind).toBe('gemini/permission')
    expect(asked[0]!.details).toMatchObject({ title: 'rm -rf build', toolKind: 'execute', command: 'rm -rf build', description: 'Limpar a pasta build' })
    expect(spawned.log.find((m) => m.id === 900)).toMatchObject({ result: { outcome: { outcome: 'selected', optionId: 'proceed_once' } } })
  })

  it('deny: answers "rejeitar" and the refusal reaches the agent', async () => {
    const spawned = { args: [] as string[], log: [] as Json[] }
    const handler = (m: Json, r: (id: unknown, result: Json) => void, s: (message: Json) => void): void => {
      standard(m, r, s, { permission: true })
      if (m.id === 900) r(spawned.log.find((x) => x.method === 'session/prompt')!.id, { stopReason: 'end_turn' })
    }
    await adapter(fakeAcp(handler, spawned)).run({ ...base, requestPermission: async () => false } as never)
    expect(spawned.log.find((m) => m.id === 900)).toMatchObject({ result: { outcome: { outcome: 'selected', optionId: 'cancel' } } })
  })

  it('cancel the run: sends session/cancel and answers pending requests as cancelled', async () => {
    const spawned = { args: [] as string[], log: [] as Json[] }
    const controller = new AbortController()
    const handler = (m: Json, r: (id: unknown, result: Json) => void, s: (message: Json) => void): void => {
      standard(m, r, s, { permission: true })
      if (m.method === 'session/cancel') r(spawned.log.find((x) => x.method === 'session/prompt')!.id, { stopReason: 'cancelled' })
    }
    const pending = adapter(fakeAcp(handler, spawned)).run({ ...base, signal: controller.signal, requestPermission: (_k: string, _d: Json, signal?: AbortSignal) => new Promise<boolean>((resolve) => signal?.addEventListener('abort', () => resolve(false))) } as never)
    await new Promise((resolve) => setTimeout(resolve, 30)); controller.abort()
    expect(await pending).toMatchObject({ status: 'interrupted' })
    expect(spawned.log.some((m) => m.method === 'session/cancel')).toBe(true)
    expect(spawned.log.find((m) => m.id === 900)).toMatchObject({ result: { outcome: { outcome: 'cancelled' } } })
  })

  it('resumes the session with session/load and ignores the resent history', async () => {
    const spawned = { args: [] as string[], log: [] as Json[] }
    const result = await adapter(fakeAcp((m, r, s) => standard(m, r, s, { loadSession: true }), spawned)).run({ ...base, sessionId: 'acp-1', requestPermission: async () => true } as never)
    expect(spawned.log.map((m) => m.method)).toEqual(['initialize', 'session/load', 'session/prompt'])
    expect(result.text).toBe('Pronto')
  })

  it('if Gemini asks for login, authenticates with the first advertised method and retries', async () => {
    const spawned = { args: [] as string[], log: [] as Json[] }
    let authed = false
    const handler = (m: Json, r: (id: unknown, result: Json) => void, s: (message: Json) => void): void => {
      if (m.method === 'initialize') return r(m.id, { protocolVersion: 1, agentCapabilities: {}, authMethods: [{ id: 'oauth-personal', name: 'Login with Google' }] })
      if (m.method === 'session/new' && !authed) return s({ id: m.id, error: { code: -32000, message: 'Authentication required' } })
      if (m.method === 'authenticate') { authed = true; return r(m.id, {}) }
      standard(m, r, s)
    }
    const result = await adapter(fakeAcp(handler, spawned)).run({ ...base, requestPermission: async () => true } as never)
    expect(spawned.log.map((m) => m.method)).toEqual(['initialize', 'session/new', 'authenticate', 'session/new', 'session/prompt'])
    expect(spawned.log[2]!.params).toEqual({ methodId: 'oauth-personal' })
    expect(result.status).toBe('completed')
  })

  it('a protocol error becomes a failure with the message', async () => {
    const spawned = { args: [] as string[], log: [] as Json[] }
    const handler = (m: Json, r: (id: unknown, result: Json) => void, s: (message: Json) => void): void => {
      if (m.method === 'initialize') return r(m.id, { protocolVersion: 1, agentCapabilities: {}, authMethods: [] })
      if (m.method === 'session/new') return s({ id: m.id, error: { code: -32603, message: 'Falha interna' } })
    }
    expect(await adapter(fakeAcp(handler, spawned)).run({ ...base, requestPermission: async () => true } as never)).toMatchObject({ status: 'failed', error: 'Falha interna' })
  })

  it('only Padrão mode uses ACP: automatic and plan go through stream-json', async () => {
    const spawned = { args: [] as string[], log: [] as Json[] }
    const factory: ProcessFactory = { start(_c, args) {
      spawned.args = args
      const emitter = new EventEmitter() as EventEmitter & Partial<ChildProcessWithoutNullStreams>
      const stdin = new PassThrough(), stdout = new PassThrough()
      Object.assign(emitter, { stdin, stdout, stderr: new PassThrough(), killed: false, kill() { return true } })
      stdin.resume(); stdin.on('end', () => stdout.write(`${JSON.stringify({ type: 'result', status: 'success', stats: {} })}\n`))
      return emitter as ChildProcessWithoutNullStreams
    } }
    await new GeminiCliAdapter(factory).run({ ...base, mode: 'auto', requestPermission: async () => true } as never)
    expect(spawned.args).toContain('--output-format')
    expect(spawned.args).not.toContain('--acp')
  })
})

describe('ACP protocol pieces', () => {
  it('picks the right option and cancels when none is compatible', () => {
    expect(acpPermissionOutcome(permissionOptions, true)).toEqual({ outcome: 'selected', optionId: 'proceed_once' })
    expect(acpPermissionOutcome(permissionOptions, false)).toEqual({ outcome: 'selected', optionId: 'cancel' })
    expect(acpPermissionOutcome([{ optionId: 'a', name: 'Sempre', kind: 'allow_always' }], true)).toEqual({ outcome: 'cancelled' })
    expect(acpPermissionOutcome(undefined, false)).toEqual({ outcome: 'cancelled' })
  })
  it('MCP servers without GearMod and details without a path', () => {
    expect(acpMcpServers([])).toEqual([])
    expect(acpPermissionDetails({ toolCall: { title: 'Editar', kind: 'edit', locations: [{ path: 'a.ts' }], rawInput: {} }, options: [] })).toMatchObject({ toolKind: 'edit', path: 'a.ts' })
  })
})
