import type { Run } from '@agentboard/contracts'
import type { AgentAdapter, AgentEvent } from './adapters'
import type { ConversationRepository } from './conversations'
import type { WorktreeService } from './worktrees'
import type { AgentContextService } from './agent-context'
import type { AgentWriteback } from './agent-writeback'
import type { AgentConfigRepository } from './agent-config'

type Job = { run: Run; chatId: string; prompt: string; planning: boolean }

export class AgentOrchestrator {
  private active = 0
  private readonly queue: Job[] = []
  private readonly controllers = new Map<string, AbortController>()
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly adapters: Record<'codex' | 'claude', AgentAdapter>,
    private readonly emit: (event: { runId: string; eventType: string; payload: Record<string, unknown> }) => void,
    private readonly worktrees: WorktreeService,
    private readonly concurrency = 2,
    private readonly agentContext?: Pick<AgentContextService, 'prompt' | 'developerInstructions' | 'pluginDir'>,
    private readonly writeback?: AgentWriteback,
    private readonly configs?: Pick<AgentConfigRepository, 'resolve' | 'recordUse'>
  ) {}

  start(input: { chatId: string; prompt: string; planning: boolean }): Run {
    const context = this.conversations.context(input.chatId)
    if (input.planning && context.chat.purpose !== 'planning') throw new Error('Use um chat de planejamento para executar em modo read-only')
    this.conversations.addMessage({ chatId: input.chatId, role: 'user', body: input.prompt, status: 'complete' })
    const run = this.conversations.createRun({ cardId: context.cardId, chatId: input.chatId, profileId: context.profile.id })
    this.queue.push({ run, ...input }); this.pump()
    return run
  }

  cancel(runId: string): boolean {
    const queued = this.queue.findIndex((job) => job.run.id === runId)
    if (queued >= 0) { this.queue.splice(queued, 1); this.conversations.updateRun(runId, 'cancelled', 'Cancelled before start'); return true }
    const controller = this.controllers.get(runId); if (!controller) return false; controller.abort(); return true
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!; this.active += 1
      void this.execute(job).finally(() => { this.active -= 1; this.pump() })
    }
  }

  private async execute(job: Job): Promise<void> {
    const controller = new AbortController(); this.controllers.set(job.run.id, controller)
    const context = this.conversations.context(job.chatId)
    const publish = (event: AgentEvent): void => { const saved = this.conversations.appendEvent(job.run.id, event.type, event.payload); this.emit({ runId: job.run.id, eventType: saved.eventType, payload: saved.payload }) }
    try {
      const worktree = job.planning ? null : await this.worktrees.prepare(context.cardId)
      const cwd = worktree?.path ?? context.projectPath
      if (worktree) this.conversations.attachWorktree(job.run.id, worktree.id)
      this.conversations.updateRun(job.run.id, 'running', null)
      publish({ type: 'agentboard/run-started', payload: { cardId: context.cardId, planning: job.planning } })
      const purpose = job.planning ? 'planning' : 'execution'
      const config = this.configs?.resolve(context.cardId, context.profile.id, purpose)
      if (config) this.configs?.recordUse(config, purpose)
      const mcp = this.writeback?.begin(job.run.id, context.cardId, (type, payload) => publish({ type, payload }))
      const result = await this.adapters[context.profile.provider].run({ cwd, prompt: this.agentContext ? this.agentContext.prompt(context.cardId, job.prompt, job.planning) : job.prompt, pluginDir: this.agentContext?.pluginDir, mcp, model: config?.model, effort: config?.effort, mode: job.planning ? 'plan' : config?.mode, developerInstructions: this.agentContext?.developerInstructions(job.planning), sessionId: context.chat.providerSessionId, planning: job.planning, profile: context.profile, signal: controller.signal, onEvent: publish })
      this.conversations.updateSession(job.chatId, result.sessionId)
      if (result.text) this.conversations.addMessage({ chatId: job.chatId, role: 'assistant', body: result.text, status: result.status === 'completed' ? 'complete' : 'failed' })
      const applied = this.writeback?.finish({ runId: job.run.id, cardId: context.cardId, planning: job.planning, completed: result.status === 'completed', text: result.text, publish: (type, payload) => publish({ type, payload }) })
      applied?.notices.forEach((body) => this.conversations.addMessage({ chatId: job.chatId, role: 'system', body, status: 'failed' }))
      if (job.planning && result.status === 'completed') {
        if (!applied?.wroteDocuments && result.text.trim()) this.writeback?.writePlan(context.cardId, result.text)
        this.conversations.savePlan(context.cardId, context.profile.id, result.text)
      }
      this.conversations.updateRun(job.run.id, result.status, result.error, result.turnId)
      publish({ type: 'agentboard/run-completed', payload: { status: result.status, error: result.error } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.conversations.updateRun(job.run.id, controller.signal.aborted ? 'interrupted' : 'failed', message)
      publish({ type: 'agentboard/run-completed', payload: { status: controller.signal.aborted ? 'interrupted' : 'failed', error: message } })
    } finally { this.controllers.delete(job.run.id) }
  }
}
