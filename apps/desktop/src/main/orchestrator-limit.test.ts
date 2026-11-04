import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter } from './adapters'
import type { ConversationRepository } from './conversations'
import { AgentOrchestrator } from './orchestrator'
import type { WorktreeService } from './worktrees'

/** Adapter that only finishes when the test releases it, to keep the runs "running". */
function setup(limit: { value: number }) {
  let counter = 0
  const conversations = {
    context: () => ({ cardId: null, projectPath: 'C:\\project', chat: { id: 'chat', projectId: 'project', purpose: 'free', skill: null, providerSessionId: null }, profile: { id: 'profile', enabled: true, provider: 'codex', label: 'Codex' } }),
    addMessage: vi.fn(), createRun: () => ({ id: `run-${++counter}` }), attachWorktree: vi.fn(), updateRun: vi.fn(), updateSession: vi.fn(), setTitleIfEmpty: vi.fn(), recordRunMeta: vi.fn(), recordEffectiveModel: vi.fn(), recordUsage: vi.fn(), appendEvent: (_id: string, type: string, payload: unknown) => ({ eventType: type, payload })
  }
  const releases: Array<() => void> = []
  const started: string[] = []
  const adapter = { run: () => new Promise((resolve) => { started.push('x'); releases.push(() => resolve({ status: 'completed', text: '', sessionId: 's', turnId: null, error: null })) }) }
  const events: Array<{ runId: string; eventType: string; payload: Record<string, unknown> }> = []
  const orchestrator = new AgentOrchestrator(conversations as unknown as ConversationRepository, { codex: adapter as unknown as AgentAdapter, claude: adapter as unknown as AgentAdapter, gemini: adapter as unknown as AgentAdapter }, (event) => events.push(event), {} as WorktreeService, () => limit.value)
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))
  return { orchestrator, releases, started, events, settle }
}

describe('limite de execuções simultâneas', () => {
  it('segura o que passa do limite na fila e avisa só pedidos do usuário', async () => {
    const { orchestrator, started, events, settle } = setup({ value: 1 })
    orchestrator.start({ chatId: 'chat', prompt: 'a', planning: false })
    orchestrator.start({ chatId: 'chat', prompt: 'b', planning: false })
    orchestrator.start({ chatId: 'chat', prompt: 'c', planning: false, automatic: true })
    await settle()
    expect(started).toHaveLength(1)
    expect(orchestrator.capacity()).toEqual({ active: 1, queued: 2, limit: 1 })
    expect(events.filter((event) => event.eventType === 'gearmod/run-queued').map((event) => event.runId)).toEqual(['run-2'])
  })

  it('runNow ultrapassa o limite e refill aproveita um limite maior', async () => {
    const limit = { value: 1 }
    const { orchestrator, started, settle } = setup(limit)
    orchestrator.start({ chatId: 'chat', prompt: 'a', planning: false })
    const second = orchestrator.start({ chatId: 'chat', prompt: 'b', planning: false })
    orchestrator.start({ chatId: 'chat', prompt: 'c', planning: false })
    await settle()
    expect(orchestrator.runNow(second.id)).toBe(true)
    expect(orchestrator.runNow(second.id)).toBe(false)
    await settle()
    expect(started).toHaveLength(2)
    limit.value = 3
    orchestrator.refill()
    await settle()
    expect(started).toHaveLength(3)
    expect(orchestrator.capacity()).toMatchObject({ active: 3, queued: 0 })
  })
})
