import { describe, expect, it, vi } from 'vitest'
import type { AgentAdapter, AgentRunOptions } from './adapters'
import type { ConversationRepository } from './conversations'
import { AgentOrchestrator } from './orchestrator'
import type { WorktreeService } from './worktrees'

describe('worktree no planejamento', () => {
  it('prepara a worktree antes do agente e a associa à execução, mantendo modo de planejamento', async () => {
    const calls: AgentRunOptions[] = []
    const tree = { id: 'tree', path: 'C:\\worktrees\\card' }
    const conversations = {
      context: () => ({ cardId: 'card', projectPath: 'C:\\project', chat: { id: 'chat', projectId: 'project', purpose: 'planning', skill: null, providerSessionId: null }, profile: { id: 'profile', enabled: true, provider: 'codex', label: 'Codex' } }),
      addMessage: vi.fn(), createRun: () => ({ id: 'run' }), attachWorktree: vi.fn(), updateRun: vi.fn(), updateSession: vi.fn(), recordRunMeta: vi.fn(), recordEffectiveModel: vi.fn(), recordUsage: vi.fn(), savePlan: vi.fn(), appendEvent: (_id: string, type: string, payload: unknown) => ({ eventType: type, payload })
    }
    const worktrees = { prepare: vi.fn(async () => tree), repositories: () => [], foreignOwner: () => null }
    const adapter = { run: async (options: AgentRunOptions) => { calls.push(options); return { status: 'completed', text: '', sessionId: 'session', turnId: null, error: null } } }
    let completed!: () => void
    const done = new Promise<void>((resolve) => { completed = resolve })
    const orchestrator = new AgentOrchestrator(conversations as unknown as ConversationRepository, { codex: adapter as AgentAdapter, claude: adapter as AgentAdapter, gemini: adapter as AgentAdapter }, (event) => { if (event.eventType === 'gearmod/run-completed') completed() }, worktrees as unknown as WorktreeService)
    orchestrator.start({ chatId: 'chat', prompt: 'Planeje', planning: true })
    await done
    expect(worktrees.prepare).toHaveBeenCalledWith('card')
    expect(conversations.attachWorktree).toHaveBeenCalledWith('run', 'tree')
    expect(calls[0]).toMatchObject({ cwd: tree.path, planning: true, mode: 'plan' })
  })
})

describe('run que termina em erro (B3, B8)', () => {
  it('o harness e o encadeamento rodam também quando o adaptador lança, e turno de planejamento não grava versão de plano', async () => {
    const conversations = {
      context: () => ({ cardId: 'card', projectPath: 'C:/project', chat: { id: 'chat', projectId: 'project', purpose: 'execution', skill: null, providerSessionId: null }, profile: { id: 'profile', enabled: true, provider: 'claude', label: 'Claude' } }),
      addMessage: vi.fn(), createRun: () => ({ id: 'run' }), attachWorktree: vi.fn(), updateRun: vi.fn(), updateSession: vi.fn(), recordRunMeta: vi.fn(), recordEffectiveModel: vi.fn(), recordUsage: vi.fn(), savePlan: vi.fn(), appendEvent: (_id: string, type: string, payload: unknown) => ({ eventType: type, payload })
    }
    const worktrees = { prepare: vi.fn(async () => ({ id: 'tree', path: 'C:/worktrees/card' })), repositories: () => [], foreignOwner: () => null }
    const adapter = { run: async () => { throw new Error('Claude encerrou sem resultado (1): boom') } }
    const harness = { before: () => null, after: vi.fn(async () => ['aviso do harness']), timeoutMs: () => null, snapshotRepos: async () => undefined }
    const collab = { afterRun: vi.fn() }
    let completed!: () => void
    const done = new Promise<void>((resolve) => { completed = resolve })
    const orchestrator = new AgentOrchestrator(conversations as unknown as ConversationRepository, { codex: adapter as unknown as AgentAdapter, claude: adapter as unknown as AgentAdapter, gemini: adapter as unknown as AgentAdapter }, (event) => { if (event.eventType === 'gearmod/run-completed') completed() }, worktrees as unknown as WorktreeService, 2, undefined, undefined, undefined, undefined, collab)
    orchestrator.setHarness(harness as never)
    orchestrator.start({ chatId: 'chat', prompt: 'Execute', planning: false })
    await done
    await vi.waitFor(() => expect(collab.afterRun).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'card', status: 'failed' })))
    expect(harness.after).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'card', status: 'failed' }))
    expect(conversations.addMessage).toHaveBeenCalledWith(expect.objectContaining({ body: 'aviso do harness' }))
    expect(conversations.savePlan).not.toHaveBeenCalled()
  })
})
