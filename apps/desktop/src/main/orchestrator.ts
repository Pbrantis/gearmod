import type { AgentPurpose, ChatPurpose, Run } from '@agentboard/contracts'
import type { AgentAdapter, AgentEvent } from './adapters'
import type { ConversationRepository } from './conversations'
import type { WorktreeService } from './worktrees'
import type { AgentContextService } from './agent-context'
import type { AgentWriteback } from './agent-writeback'
import type { AgentConfigRepository } from './agent-config'
import { titleFromPrompt } from './agent-writeback'
import { toolActivities } from './tool-activity'

type Job = { run: Run; chatId: string; prompt: string; planning: boolean; notice?: string }

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
    private readonly agentContext?: Pick<AgentContextService, 'prompt' | 'freePrompt' | 'freeInstructions' | 'developerInstructions' | 'pluginDir'>,
    private readonly writeback?: AgentWriteback,
    private readonly configs?: Pick<AgentConfigRepository, 'resolve' | 'recordUse'>,
    private readonly usage?: { recordClaude(profileId: string, payload: Record<string, unknown>): void },
    private readonly collab?: { afterRun(info: { cardId: string; chatId: string; purpose: AgentPurpose; status: string }): void },
    private readonly onFinished?: (info: { cardId: string | null; chatId: string; purpose: ChatPurpose; status: Run['status']; error: string | null }) => void
  ) {}

  /** `notice` troca o prompt no chat por um aviso curto (instruções internas do app não aparecem como mensagem do usuário). */
  start(input: { chatId: string; prompt: string; planning: boolean; notice?: string }): Run {
    const context = this.conversations.context(input.chatId)
    if (!context.profile.enabled) throw new Error(`O agente ${context.profile.label} foi removido e não pode mais executar. Reinicie o chat com outro agente.`)
    const free = context.chat.purpose === 'free'
    if (input.planning && context.chat.purpose !== 'planning' && !free) throw new Error('Use um chat de planejamento para executar em modo read-only')
    // O chat livre nunca altera arquivos: roda sempre como o planejamento (somente leitura).
    if (free) input = { ...input, planning: true }
    this.conversations.addMessage(input.notice ? { chatId: input.chatId, role: 'system', body: input.notice, status: 'complete' } : { chatId: input.chatId, role: 'user', body: input.prompt, status: 'complete' })
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
    const publish = (event: AgentEvent): void => {
      if (event.type === 'claude/rate_limit_event') { try { this.usage?.recordClaude(context.profile.id, event.payload) } catch { /* uso é informativo */ } }
      const saved = this.conversations.appendEvent(job.run.id, event.type, event.payload); this.emit({ runId: job.run.id, eventType: saved.eventType, payload: saved.payload })
      // Ferramentas usadas viram linhas cinzas no chat (como no Claude Code); a tela recarrega as mensagens ao receber o aviso.
      const tools = toolActivities(event.type, event.payload)
      if (tools.length) {
        for (const tool of tools) this.conversations.addMessage({ chatId: job.chatId, role: 'tool', body: tool.detail ? `${tool.title}\n${tool.detail}` : tool.title, status: 'complete' })
        this.emit({ runId: job.run.id, eventType: 'agentboard/tool-activity', payload: { chatId: job.chatId } })
      }
    }
    try {
      const free = context.chat.purpose === 'free'
      const worktree = job.planning || !context.cardId ? null : await this.worktrees.prepare(context.cardId)
      const cwd = worktree?.path ?? context.projectPath
      if (worktree) this.conversations.attachWorktree(job.run.id, worktree.id)
      this.conversations.updateRun(job.run.id, 'running', null)
      publish({ type: 'agentboard/run-started', payload: { cardId: context.cardId, planning: job.planning } })
      if (free) this.conversations.setTitleIfEmpty(job.chatId, titleFromPrompt(job.prompt))
      const purpose = context.chat.purpose === 'free' ? null : context.chat.purpose
      const config = context.cardId && purpose ? this.configs?.resolve(context.cardId, context.profile.id, purpose) : undefined
      if (config && purpose) this.configs?.recordUse(config, purpose)
      const mcp = this.writeback?.begin(job.run.id, context.cardId, (type, payload) => publish({ type, payload }), { id: context.chat.id, purpose: context.chat.purpose })
      const result = await this.adapters[context.profile.provider].run({ cwd, prompt: this.agentContext ? (free || !context.cardId ? this.agentContext.freePrompt(job.prompt) : this.agentContext.prompt(context.cardId, job.prompt, job.planning, context.chat.skill)) : job.prompt, pluginDir: this.agentContext?.pluginDir, mcp, model: config?.model, effort: config?.effort, mode: job.planning ? 'plan' : config?.mode, developerInstructions: free ? this.agentContext?.freeInstructions(context.profile.provider === 'codex') : this.agentContext?.developerInstructions(job.planning, context.chat.skill), sessionId: context.chat.providerSessionId, planning: job.planning, profile: context.profile, signal: controller.signal, onEvent: publish })
      this.conversations.updateSession(job.chatId, result.sessionId)
      if (result.text) this.conversations.addMessage({ chatId: job.chatId, role: 'assistant', body: result.text, status: result.status === 'completed' ? 'complete' : 'failed' })
      // O chat livre pode ter virado planejamento durante o turno (ferramenta agentboard_criar_card): daqui em diante vale o card novo.
      const after = free ? this.conversations.context(job.chatId) : context
      const applied = this.writeback?.finish({ runId: job.run.id, cardId: after.cardId, planning: job.planning, completed: result.status === 'completed', text: result.text, prompt: job.prompt, publish: (type, payload) => publish({ type, payload }) })
      applied?.notices.forEach((body) => this.conversations.addMessage({ chatId: job.chatId, role: 'system', body, status: 'failed' }))
      if (job.planning && result.status === 'completed' && after.cardId) {
        this.conversations.savePlan(after.cardId, context.profile.id, result.text)
      }
      if (result.status === 'failed' && !result.text && result.error) this.conversations.addMessage({ chatId: job.chatId, role: 'system', body: result.error, status: 'failed' })
      this.conversations.updateRun(job.run.id, result.status, result.error, result.turnId)
      publish({ type: 'agentboard/run-completed', payload: { status: result.status, error: result.error } })
      try { if (after.cardId && after.chat.purpose !== 'free') this.collab?.afterRun({ cardId: after.cardId, chatId: job.chatId, purpose: after.chat.purpose, status: result.status }) } catch { /* encadeamento é best-effort; o chat mostra o aviso */ }
      try { this.onFinished?.({ cardId: after.cardId, chatId: job.chatId, purpose: after.chat.purpose, status: result.status, error: result.error ?? null }) } catch { /* notificação é best-effort */ }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Sem isto o card só ficava Pausado, sem dizer por quê (ex.: a worktree não pôde ser criada).
      if (!controller.signal.aborted) this.conversations.addMessage({ chatId: job.chatId, role: 'system', body: message, status: 'failed' })
      this.conversations.updateRun(job.run.id, controller.signal.aborted ? 'interrupted' : 'failed', message)
      publish({ type: 'agentboard/run-completed', payload: { status: controller.signal.aborted ? 'interrupted' : 'failed', error: message } })
      try { const after = this.conversations.context(job.chatId); this.onFinished?.({ cardId: after.cardId, chatId: job.chatId, purpose: after.chat.purpose, status: controller.signal.aborted ? 'interrupted' : 'failed', error: message }) } catch { /* notificação é best-effort */ }
    } finally { this.controllers.delete(job.run.id) }
  }
}
