import { describe, expect, it } from 'vitest'
import { AgentPermissions } from './agent-permissions'

describe('run-scoped agent permissions', () => {
  const input = { runId: 'run-a', chatId: 'chat-a', provider: 'claude' as const, kind: 'Bash', details: { command: 'test' } }
  it('restores pending prompts when reopening a chat, rejects cross-run and duplicate decisions', async () => {
    const broker = new AgentPermissions(), events: string[] = []
    const pending = broker.request(input, new AbortController().signal, (event) => events.push(event.type))
    const request = broker.list('chat-a')[0]!
    expect(broker.list('other-chat')).toEqual([])
    expect(broker.decide('run-b', request.id, true)).toBe(false)
    expect(broker.decide('run-a', request.id, true)).toBe(true)
    expect(broker.decide('run-a', request.id, false)).toBe(false)
    expect(await pending).toBe(true)
    expect(broker.list('chat-a')).toEqual([])
    expect(events).toEqual(['agentboard/permission-requested', 'agentboard/permission-resolved'])
  })
  it('denies all pending requests on abort or run completion without affecting another run', async () => {
    const broker = new AgentPermissions(), controller = new AbortController()
    const first = broker.request(input, controller.signal, () => {})
    const second = broker.request({ ...input, runId: 'run-b' }, new AbortController().signal, () => {})
    controller.abort(); expect(await first).toBe(false)
    expect(broker.list('chat-a')).toHaveLength(1)
    broker.closeRun('run-b'); expect(await second).toBe(false)
    expect(broker.list('chat-a')).toEqual([])
    expect(await broker.request(input, controller.signal, () => {})).toBe(false)
  })
})
