import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ClaudeCliAdapter, CodexAppServerAdapter, codexAccess, listCodexModels, type ProcessFactory } from './adapters'
import type { AgentProfile } from '@agentboard/contracts'

const profile = (provider: 'codex' | 'claude'): AgentProfile => ({ id: '10000000-0000-4000-8000-000000000001', provider, label: provider, scope: 'work', color: '#aeb9ff', configDir: 'C:\\profiles\\work', executablePath: null, enabled: true })

function fakeProcess(onInput?: (value: Record<string, unknown>, child: ChildProcessWithoutNullStreams) => void): ChildProcessWithoutNullStreams {
  const emitter = new EventEmitter() as EventEmitter & Partial<ChildProcessWithoutNullStreams>
  const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough()
  Object.assign(emitter, { stdin, stdout, stderr, killed: false, kill() { return true } })
  const child = emitter as ChildProcessWithoutNullStreams
  let buffer = ''
  stdin.on('data', (chunk: Buffer) => { buffer += chunk.toString(); const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; for (const line of lines) if (line) onInput?.(JSON.parse(line) as Record<string, unknown>, child) })
  return child
}
function send(child: ChildProcessWithoutNullStreams, value: Record<string, unknown>): void { (child.stdout as PassThrough).write(`${JSON.stringify(value)}\n`) }

describe('real provider protocol adapters', () => {
  it('drives Codex initialize, thread and turn over JSONL and captures deltas', async () => {
    const methods: string[] = []
    const factory: ProcessFactory = { start() { return fakeProcess((request, child) => {
      methods.push(String(request.method)); const id = request.id
      if (request.method === 'initialize') send(child, { id, result: {} })
      if (request.method === 'thread/start') send(child, { id, result: { thread: { id: 'thread-1' } } })
      if (request.method === 'turn/start') { send(child, { id, result: { turn: { id: 'turn-1' } } }); send(child, { method: 'item/agentMessage/delta', params: { delta: 'Olá', threadId: 'thread-1', turnId: 'turn-1', itemId: 'i' } }); send(child, { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } } }) }
    }) } }
    const events: string[] = []
    const result = await new CodexAppServerAdapter(factory).run({ cwd: 'C:\\repo', prompt: 'planeje', sessionId: null, planning: true, profile: profile('codex'), onEvent: (event) => events.push(event.type) })
    expect(methods).toEqual(['initialize', 'initialized', 'thread/start', 'turn/start'])
    expect(result).toMatchObject({ sessionId: 'thread-1', turnId: 'turn-1', text: 'Olá', status: 'completed' })
    expect(events).toContain('item/agentMessage/delta')
  })

  it('parses Claude stream-json and preserves its session id', async () => {
    let child: ChildProcessWithoutNullStreams
    const factory: ProcessFactory = { start() { child = fakeProcess(); queueMicrotask(() => { send(child, { type: 'system', session_id: 'session-1' }); send(child, { type: 'stream_event', session_id: 'session-1', event: { delta: { type: 'text_delta', text: 'Plano' } } }); send(child, { type: 'result', session_id: 'session-1', is_error: false }) }); return child } }
    const result = await new ClaudeCliAdapter(factory).run({ cwd: 'C:\\repo', prompt: 'planeje', sessionId: null, planning: true, profile: profile('claude'), onEvent: () => undefined })
    expect(result).toMatchObject({ sessionId: 'session-1', text: 'Plano', status: 'completed' })
  })

  it('passes the system skills to Codex as developerInstructions and to Claude as --plugin-dir', async () => {
    const started: Record<string, unknown>[] = []
    const codex: ProcessFactory = { start() { return fakeProcess((request, child) => {
      const id = request.id
      if (request.method === 'initialize') send(child, { id, result: {} })
      if (request.method === 'thread/start') { started.push(request.params as Record<string, unknown>); send(child, { id, result: { thread: { id: 'thread-1' } } }) }
      if (request.method === 'turn/start') { send(child, { id, result: { turn: { id: 'turn-1' } } }); send(child, { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } }) }
    }) } }
    await new CodexAppServerAdapter(codex).run({ cwd: 'C:\\repo', prompt: 'x', sessionId: null, planning: true, profile: profile('codex'), developerInstructions: 'SKILLS', mcp: { command: 'node', args: ['s.mjs'], env: { AGENTBOARD_TOKEN: 't' } }, onEvent: () => undefined })
    expect(started[0]).toMatchObject({ developerInstructions: 'SKILLS', sandbox: 'read-only', config: { mcp_servers: { agentboard: { command: 'node', args: ['s.mjs'] } } } })

    let args: string[] = []
    let child: ChildProcessWithoutNullStreams
    const claude: ProcessFactory = { start(_command, received) { args = received; child = fakeProcess(); queueMicrotask(() => send(child, { type: 'result', session_id: 's', result: 'ok' })); return child } }
    await new ClaudeCliAdapter(claude).run({ cwd: 'C:\\repo', prompt: 'x', sessionId: null, planning: true, profile: profile('claude'), pluginDir: 'C:\\plugin', onEvent: () => undefined })
    expect(args).toContain('--plugin-dir'); expect(args[args.indexOf('--plugin-dir') + 1]).toBe('C:\\plugin')
    expect(args.slice(-2)).toEqual(['--', 'x'])
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('plan')
    expect(args).not.toContain('--mcp-config')

    const withMcp: ProcessFactory = { start(_command, received) { args = received; child = fakeProcess(); queueMicrotask(() => send(child, { type: 'result', session_id: 's', result: 'ok' })); return child } }
    const mcp = { command: 'node', args: ['server.mjs'], env: { AGENTBOARD_TOKEN: 't' } }
    await new ClaudeCliAdapter(withMcp).run({ cwd: 'C:\\repo', prompt: 'x', sessionId: null, planning: true, profile: profile('claude'), mcp, onEvent: () => undefined })
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('default'); expect(args[args.indexOf('--tools') + 1]).not.toMatch(/Edit|Write|Bash/)
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__agentboard'); expect(JSON.parse(args[args.indexOf('--mcp-config') + 1]!).mcpServers.agentboard.env.AGENTBOARD_TOKEN).toBe('t')
    await new ClaudeCliAdapter(withMcp).run({ cwd: 'C:\\repo', prompt: 'x', sessionId: null, planning: false, profile: profile('claude'), mcp, onEvent: () => undefined })
    expect(args).not.toContain('--tools')
  })

  it('maps permission modes, model and effort to Claude flags', async () => {
    let args: string[] = []
    let child: ChildProcessWithoutNullStreams
    const factory: ProcessFactory = { start(_command, received) { args = received; child = fakeProcess(); queueMicrotask(() => send(child, { type: 'result', session_id: 's', result: 'ok' })); return child } }
    const run = (mode: 'accept_edits' | 'auto' | 'bypass' | 'manual') => new ClaudeCliAdapter(factory).run({ cwd: 'C:\\repo', prompt: 'x', sessionId: null, planning: false, profile: profile('claude'), model: 'sonnet', effort: 'medium', mode, onEvent: () => undefined })
    await run('accept_edits'); expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits'); expect(args[args.indexOf('--model') + 1]).toBe('sonnet'); expect(args[args.indexOf('--effort') + 1]).toBe('medium')
    await run('auto'); expect(args[args.indexOf('--permission-mode') + 1]).toBe('auto')
    await run('bypass'); expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions')
    await expect(run('manual').then(() => 'ran')).resolves.toBe('ran')
  })

  it('maps permission modes to Codex sandbox, approvals and reviewer, and sends model and effort', async () => {
    expect(codexAccess('plan')).toEqual({ sandbox: 'read-only', approvalPolicy: 'never' })
    expect(codexAccess('auto')).toEqual({ sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' })
    expect(codexAccess('bypass')).toEqual({ sandbox: 'danger-full-access', approvalPolicy: 'never' })
    expect(() => codexAccess('accept_edits')).toThrow('Codex')
    const params: Record<string, Record<string, unknown>> = {}
    const factory: ProcessFactory = { start() { return fakeProcess((request, child) => {
      const id = request.id
      if (request.method === 'initialize') send(child, { id, result: {} })
      if (request.method === 'thread/start') { params.thread = request.params as Record<string, unknown>; send(child, { id, result: { thread: { id: 't' } } }) }
      if (request.method === 'turn/start') { params.turn = request.params as Record<string, unknown>; send(child, { id, result: { turn: { id: 'u' } } }); send(child, { method: 'turn/completed', params: { threadId: 't', turn: { id: 'u', status: 'completed' } } }) }
    }) } }
    await new CodexAppServerAdapter(factory).run({ cwd: 'C:\\repo', prompt: 'x', sessionId: null, planning: false, profile: profile('codex'), model: 'gpt-x', effort: 'high', mode: 'auto', onEvent: () => undefined })
    expect(params.thread).toMatchObject({ sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', model: 'gpt-x' })
    expect(params.turn).toMatchObject({ approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', model: 'gpt-x', effort: 'high' })
  })

  it('lists Codex models from the app-server and hides hidden ones', async () => {
    const factory: ProcessFactory = { start() { return fakeProcess((request, child) => {
      const id = request.id
      if (request.method === 'initialize') send(child, { id, result: {} })
      if (request.method === 'model/list') send(child, { id, result: { data: [
        { model: 'gpt-a', displayName: 'GPT A', description: 'A', hidden: false, isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] },
        { model: 'gpt-h', displayName: 'Hidden', description: '', hidden: true, isDefault: false, defaultReasoningEffort: 'low', supportedReasoningEfforts: [] }] } })
    }) } }
    expect(await listCodexModels(profile('codex'), factory)).toEqual([{ id: 'gpt-a', label: 'GPT A', description: 'A', efforts: ['low', 'medium'], recommendedFor: ['planning', 'execution'], defaultEffort: 'medium' }])
  })
})
