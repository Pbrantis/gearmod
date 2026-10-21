import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ClaudeCliAdapter, CodexAppServerAdapter, type ProcessFactory } from './adapters'
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
})
