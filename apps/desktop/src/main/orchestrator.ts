import { AgentPermissions } from './agent-permissions'
import type { AgentPurpose, ChatPurpose, Effort, PermissionMode, Run } from '@gearmod/contracts'
import type { AgentAdapter, AgentEvent } from './adapters'
import type { ConversationRepository } from './conversations'
import type { WorktreeService } from './worktrees'
import type { AgentContextService } from './agent-context'
import type { AgentWriteback } from './agent-writeback'
import type { AgentConfigRepository } from './agent-config'
import { titleFromPrompt } from './agent-writeback'
import { toolActivities, toolEditedFiles } from './tool-activity'
import type { RunHarness } from './harness'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { isSpecKitImplementRequest, SpecKitImplementBlocked } from './spec-tools'
import type { SpecKitRuntime } from './speckit'
import type { McpRegistry } from './mcp-registry'
import { tm } from './i18n'
import { ptBR } from './i18n/pt-BR'
import { en } from './i18n/en'

/** Bloco que acompanha a mensagem com anexos: o agente lê esses arquivos como contexto. Fica em português de propósito: o renderer (Attachments.tsx) reconhece este marcador para esconder o bloco. */
export function attachmentNote(paths: string[]): string {
  return `Arquivos anexados (leia antes de responder; são contexto deste pedido):\n${paths.map((path) => `- ${path}`).join('\n')}`
}

type AgentChoice = { model?: string | null; effort?: Effort | null; mode?: PermissionMode }
type Job = { run: Run; chatId: string; prompt: string; planning: boolean; notice?: string; attachments?: string[]; automatic?: boolean; choice?: AgentChoice }

export class AgentOrchestrator {
  readonly permissions = new AgentPermissions()
  private stopping = false
  private active = 0
  private readonly queue: Job[] = []
  private readonly controllers = new Map<string, AbortController>()
  private harness?: RunHarness
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly adapters: Record<'codex' | 'claude' | 'gemini', AgentAdapter>,
    private readonly emit: (event: { runId: string; eventType: string; payload: Record<string, unknown> }) => void,
    private readonly worktrees: WorktreeService,
    /** Limite de execuções simultâneas; função para valer na hora quando o usuário muda a configuração. */
    private readonly concurrency: number | (() => number) = 2,
    private readonly agentContext?: Pick<AgentContextService, 'prompt' | 'freePrompt' | 'constitutionPrompt' | 'freeInstructions' | 'developerInstructions' | 'pluginDir'>,
    private readonly writeback?: AgentWriteback,
    private readonly configs?: Pick<AgentConfigRepository, 'resolve' | 'recordUse'>,
    private readonly usage?: { recordClaude(profileId: string, payload: Record<string, unknown>): void },
    private readonly collab?: { afterRun(info: { cardId: string; chatId: string; purpose: AgentPurpose; status: string }): void },
    private readonly onFinished?: (info: { cardId: string | null; chatId: string; runId: string; purpose: ChatPurpose; status: Run['status']; error: string | null }) => void,
    private readonly ledger?: { recordRun(runId: string, usage: { input: number; cached: number; output: number; costUsd?: number } | undefined, partial?: boolean): void; recordDelta?(runId: string, usage: { input: number; cached: number; output: number }): void },
    private readonly profiles?: { recordBillingHint(id: string, hint: string): void },
    private readonly speckit?: Pick<SpecKitRuntime, 'assertCanStart' | 'prepare' | 'prepareImplementation' | 'afterRun' | 'denies'>,
    private readonly mcpServers?: Pick<McpRegistry, 'effective'>
  ) {}

  /** Limites de execução (tempo, orçamento, tentativas) e avisos depois da run; opcional para os testes. */
  setHarness(harness: RunHarness): void { this.harness = harness }

  /** `notice` troca o prompt no chat por um aviso curto (instruções internas do app não aparecem como mensagem do usuário). */
  start(input: { chatId: string; prompt: string; planning: boolean; notice?: string; attachments?: string[]; automatic?: boolean; choice?: AgentChoice }): Run {
    if (this.stopping) throw new Error(tm().orchestrator.appQuitting)
    const context = this.conversations.context(input.chatId)
    if (context.chat.purpose === 'planning' && isSpecKitImplementRequest(input.prompt, context.chat.skill)) {
      throw new SpecKitImplementBlocked()
    }
    if (context.chat.purpose === 'planning' && context.cardId) this.speckit?.assertCanStart(context.cardId)
    // `automatic`: retomada que o app dispara sozinho (encadeamento entre etapas); só ela é barrada por falhas repetidas.
    const blocked = context.cardId ? this.harness?.before({ cardId: context.cardId, chatId: input.chatId, automatic: Boolean(input.automatic) }) : null
    if (blocked) throw new Error(blocked)
    // Anexos: só os que existem; a lista vai no texto (o usuário vê no chat e o agente lê os arquivos) e segue para o adaptador liberar a leitura.
    const attachments = [...new Set(input.attachments ?? [])].filter((path) => isAbsolute(path) && existsSync(path) && statSync(path).isFile())
    if (input.attachments?.length && !attachments.length) throw new Error(tm().orchestrator.noAttachmentsFound)
    if (attachments.length) input = { ...input, attachments, prompt: `${input.prompt}\n\n${attachmentNote(attachments)}` }
    if (!context.profile.enabled) throw new Error(tm().orchestrator.agentRemoved(context.profile.label))
    const projectChat = context.chat.purpose === 'free' || context.chat.purpose === 'constitution'
    if (input.planning && context.chat.purpose !== 'planning' && !projectChat) throw new Error(tm().orchestrator.usePlanningChat)
    // A Constituição nunca altera arquivos (roda como o planejamento, somente leitura). O chat livre altera quando o modo escolhido não é o de plano.
    if (context.chat.purpose === 'constitution') input = { ...input, planning: true }
    if (context.chat.purpose !== 'free') input = { ...input, choice: undefined }
    this.conversations.addMessage(input.notice ? { chatId: input.chatId, role: 'system', body: input.notice, status: 'complete' } : { chatId: input.chatId, role: 'user', body: input.prompt, status: 'complete' })
    const run = this.conversations.createRun({ cardId: context.cardId, chatId: input.chatId, profileId: context.profile.id })
    const full = this.active >= this.limit()
    this.queue.push({ run, ...input }); this.pump()
    // Pedido do usuário que não coube: ele fica na fila e a tela pergunta se quer rodar mesmo assim ou mudar o limite. Retomadas automáticas esperam em silêncio.
    if (full && !input.automatic) this.emit({ runId: run.id, eventType: 'gearmod/run-queued', payload: { chatId: input.chatId, cardId: context.cardId, active: this.active, limit: this.limit() } })
    return run
  }

  private limit(): number { return Math.max(1, typeof this.concurrency === 'function' ? this.concurrency() : this.concurrency) }

  capacity(): { active: number; queued: number; limit: number } { return { active: this.active, queued: this.queue.length, limit: this.limit() } }

  /** O usuário decidiu ultrapassar o limite: tira a execução da fila e roda agora. */
  runNow(runId: string): boolean {
    const index = this.queue.findIndex((job) => job.run.id === runId)
    if (index < 0) return false
    this.launch(this.queue.splice(index, 1)[0]!)
    return true
  }

  /** Chamar quando o limite mudou: se subiu, o que estava na fila começa. */
  refill(): void { this.pump() }

  /** Execuções rodando ou na fila: o que morre se o app fechar. */
  pendingCount(): number { return this.active + this.queue.length }

  shutdown(): void {
    this.stopping = true
    for (const job of this.queue.splice(0)) this.conversations.updateRun(job.run.id, 'cancelled', 'Aplicativo encerrado')
    for (const controller of this.controllers.values()) controller.abort()
  }

  cancel(runId: string): boolean {
    const queued = this.queue.findIndex((job) => job.run.id === runId)
    if (queued >= 0) { this.queue.splice(queued, 1); this.conversations.updateRun(runId, 'cancelled', 'Cancelled before start'); return true }
    const controller = this.controllers.get(runId); if (!controller) return false; controller.abort(); return true
  }

  private pump(): void {
    while (this.active < this.limit() && this.queue.length) this.launch(this.queue.shift()!)
  }

  private launch(job: Job): void {
    this.active += 1
    void this.execute(job).finally(() => { this.active -= 1; this.pump() })
  }

  private async execute(initial: Job): Promise<void> {
    let job = initial
    const controller = new AbortController(); this.controllers.set(job.run.id, controller)
    const context = this.conversations.context(job.chatId)
    // Tempo limite do projeto: aborta a execução e registra como falha (não como parada do usuário).
    const limit = context.cardId ? this.harness?.timeoutMs(context.cardId) ?? null : null
    let timedOut = false
    const timer = limit ? setTimeout(() => { timedOut = true; controller.abort() }, limit) : null
    const timeoutError = (): string => tm().orchestrator.timeoutReached(Math.round((limit ?? 0) / 60_000))
    const offered = new Set<string>()
    const publish = (event: AgentEvent): void => {
      if (this.stopping) return
      if (event.type === 'tokens.update') { try { this.ledger?.recordDelta?.(job.run.id, { input: Number(event.payload.input) || 0, cached: Number(event.payload.cached) || 0, output: Number(event.payload.output) || 0 }) } catch { /* ledger é informativo */ } }
      if (event.type === 'claude/rate_limit_event') { try { this.usage?.recordClaude(context.profile.id, event.payload) } catch { /* uso é informativo */ } }
      const saved = this.conversations.appendEvent(job.run.id, event.type, event.payload); this.emit({ runId: job.run.id, eventType: saved.eventType, payload: saved.payload })
      // Ferramentas usadas viram linhas cinzas no chat (como no Claude Code); a tela recarrega as mensagens ao receber o aviso.
      const tools = toolActivities(event.type, event.payload)
      // O agente mexeu na worktree de outro card (ex.: o usuário pediu para trabalhar lá): avisa uma vez por dono, para a tela oferecer o vínculo.
      if (context.cardId) for (const file of toolEditedFiles(event.type, event.payload)) {
        const owner = this.worktrees.foreignOwner(context.cardId, file)
        if (owner && !offered.has(owner.cardId)) { offered.add(owner.cardId); this.emit({ runId: job.run.id, eventType: 'gearmod/worktree-foreign', payload: { cardId: context.cardId, ownerCardId: owner.cardId, ownerTitle: owner.title } }) }
      }
      if (tools.length) {
        for (const tool of tools) this.conversations.addMessage({ chatId: job.chatId, role: 'tool', body: tool.detail ? `${tool.title}\n${tool.detail}` : tool.title, status: 'complete' })
        this.emit({ runId: job.run.id, eventType: 'gearmod/tool-activity', payload: { chatId: job.chatId } })
      }
    }
    try {
      const free = context.chat.purpose === 'free', constitution = context.chat.purpose === 'constitution'
      // O planejamento do card já usa a mesma worktree que será reutilizada na execução.
      // Projetos sem Git continuam podendo ser planejados em modo somente leitura.
      let worktree = null
      if (context.cardId) {
        try { worktree = await this.worktrees.prepare(context.cardId) }
        catch (error) {
          if (!job.planning || !(error instanceof Error) || ![ptBR, en].some((dict) => error.message.startsWith(dict.worktrees.noGitRepoFound.slice(0, 30)))) throw error
          this.conversations.addMessage({ chatId: job.chatId, role: 'system', body: tm().orchestrator.noGitReadOnlyPlanning, status: 'complete' })
        }
      }
      if (this.stopping) return
      const cwd = worktree?.path ?? context.projectPath
      if (worktree) this.conversations.attachWorktree(job.run.id, worktree.id)
      const failedRepos = worktree && context.cardId ? this.worktrees.repositories(context.cardId).filter((repo) => repo.status === 'failed') : []
      if (failedRepos.length) this.conversations.addMessage({ chatId: job.chatId, role: 'system', body: tm().orchestrator.reposFailed(failedRepos.length, failedRepos.map((repo) => `- ${repo.error}`).join('\n')), status: 'failed' })
      // S10: HEAD de cada repositório antes da execução, para o harness detectar depois um commit/branch que não veio de agentCommit.
      if (worktree && context.cardId) try { await this.harness?.snapshotRepos?.(context.cardId) } catch { /* detecção é best-effort */ }
      // Spec Kit: skill conferida na worktree, feature do card amarrada e modo escolhido pelo usuário; falha aqui vira erro da run (sem trocar de método).
      const sk = context.chat.purpose === 'planning' && context.cardId ? this.speckit?.prepare({ cardId: context.cardId, provider: context.profile.provider, prompt: job.prompt }) ?? null : null
      if (sk) job = { ...job, prompt: sk.prompt }
      // Implementação com Spec Kit: roda no repositório do Spec Kit (onde estão as skills e a feature), com os demais repositórios liberados.
      let impl: ReturnType<SpecKitRuntime['prepareImplementation']> = null
      if (!sk && context.chat.purpose === 'execution' && context.cardId) { try { impl = this.speckit?.prepareImplementation(context.cardId) ?? null } catch { impl = null } }
      const runCwd = sk?.cwd ?? impl?.cwd ?? cwd, adapterPlanning = job.planning && !sk
      this.conversations.updateRun(job.run.id, 'running', null)
      publish({ type: 'gearmod/run-started', payload: { cardId: context.cardId, chatId: job.chatId, planning: job.planning } })
      if (free) this.conversations.setTitleIfEmpty(job.chatId, titleFromPrompt(job.prompt))
      if (constitution) this.conversations.setTitleIfEmpty(job.chatId, 'Constituição')
      const purpose = free || constitution ? null : context.chat.purpose as AgentPurpose
      const config = context.cardId && purpose ? this.configs?.resolve(context.cardId, context.profile.id, purpose) : undefined
      if (config && purpose) this.configs?.recordUse(config, purpose)
      const mcp = this.writeback?.begin(job.run.id, context.cardId, (type, payload) => publish({ type, payload }), { id: context.chat.id, purpose: context.chat.purpose })
      const prompt = this.agentContext ? await (constitution ? this.agentContext.constitutionPrompt(context.chat.projectId, job.prompt, context.chat.skill) : free || !context.cardId ? this.agentContext.freePrompt(job.prompt, context.chat.projectId, !job.planning, context.chat.skill) : this.agentContext.prompt(context.cardId, job.prompt, job.planning, context.chat.skill)) : job.prompt
      try { this.conversations.recordRunMeta(job.run.id, { purpose: context.chat.purpose, provider: context.profile.provider, model: config?.model ?? null, effort: config?.effort ?? null, promptChars: prompt.length }) } catch { /* métrica é informativa */ }
      // Servidores MCP cadastrados (globais e do projeto) para este agente; falha ao ler nunca derruba a run.
      let extraMcp: Awaited<ReturnType<McpRegistry['effective']>> = []
      if (this.mcpServers) { try { extraMcp = await this.mcpServers.effective(context.chat.projectId, context.profile.provider) } catch { /* a run segue sem eles */ } }
      const raw = await this.adapters[context.profile.provider].run({ cwd: runCwd, env: sk?.env ?? impl?.env, addDirs: impl?.addDirs, mcpServers: extraMcp, prompt, pluginDir: this.agentContext?.pluginDir, mcp, model: config?.model ?? job.choice?.model, effort: config?.effort ?? job.choice?.effort, mode: sk ? sk.mode : job.planning ? 'plan' : config?.mode ?? job.choice?.mode, developerInstructions: free ? this.agentContext?.freeInstructions(context.profile.provider === 'codex', !job.planning, context.chat.skill) : this.agentContext?.developerInstructions(job.planning, context.chat.skill, context.cardId, context.chat.purpose), sessionId: context.chat.providerSessionId, planning: adapterPlanning, attachments: job.attachments, profile: context.profile, signal: controller.signal, requestPermission: (kind, details, signal) => sk && this.speckit?.denies(details) ? Promise.resolve(false) : this.permissions.request({ runId: job.run.id, chatId: job.chatId, provider: context.profile.provider, kind, details }, signal ? AbortSignal.any([controller.signal, signal]) : controller.signal, publish), onEvent: publish })
      if (this.stopping) return
      const result = timedOut ? { ...raw, status: 'failed' as const, error: timeoutError() } : raw
      this.conversations.updateSession(job.chatId, result.sessionId)
      try { this.conversations.recordEffectiveModel(job.run.id, result.modelEffective) } catch { /* métrica é informativa */ }
      try { this.conversations.recordUsage(job.run.id, result.usage) } catch { /* contagem de tokens é informativa */ }
      try { this.ledger?.recordRun(job.run.id, result.usage, result.status !== 'completed') } catch { /* ledger é informativo; nunca derruba a run */ }
      if (result.apiKeySource) try { this.profiles?.recordBillingHint(context.profile.id, result.apiKeySource) } catch { /* indício é informativo; só sugere na UI */ }
      if (result.text) this.conversations.addMessage({ chatId: job.chatId, role: 'assistant', body: result.text, status: result.status === 'completed' ? 'complete' : 'failed' })
      // O chat livre pode ter virado planejamento durante o turno (ferramenta gearmod_create_card): daqui em diante vale o card novo.
      const after = free ? this.conversations.context(job.chatId) : context
      const planned = job.planning || (free && after.chat.purpose === 'planning')
      const applied = this.writeback?.finish({ runId: job.run.id, cardId: after.cardId, planning: planned, completed: result.status === 'completed', text: result.text, prompt: job.prompt, publish: (type, payload) => publish({ type, payload }) })
      applied?.notices.forEach((body) => this.conversations.addMessage({ chatId: job.chatId, role: 'system', body, status: 'failed' }))
      // A versão em `plans` nasce quando o usuário inicia a execução (approveCurrentPlan, a partir do documento Plano); cada turno de planejamento não grava mais uma.
      if (sk && result.status === 'completed' && after.cardId) { const next = this.speckit?.afterRun({ cardId: after.cardId, prompt: job.prompt }); if (next) this.conversations.addMessage({ chatId: job.chatId, role: 'system', body: next, status: 'complete' }) }
      if (result.status === 'failed' && !result.text && result.error) this.conversations.addMessage({ chatId: job.chatId, role: 'system', body: result.error, status: 'failed' })
      this.conversations.updateRun(job.run.id, result.status, result.error, result.turnId)
      publish({ type: 'gearmod/run-completed', payload: { chatId: job.chatId, status: result.status, error: result.error } })
      if (after.cardId && after.chat.purpose !== 'free' && after.chat.purpose !== 'constitution' && this.harness) {
        try { (await this.harness.after({ cardId: after.cardId, runId: job.run.id, chatId: job.chatId, purpose: after.chat.purpose, status: result.status })).forEach((body) => this.conversations.addMessage({ chatId: job.chatId, role: 'system', body, status: 'failed' })) } catch { /* aviso do harness é best-effort */ }
      }
      try { if (after.cardId && after.chat.purpose !== 'free' && after.chat.purpose !== 'constitution') this.collab?.afterRun({ cardId: after.cardId, chatId: job.chatId, purpose: after.chat.purpose, status: result.status }) } catch { /* encadeamento é best-effort; o chat mostra o aviso */ }
      try { this.onFinished?.({ cardId: after.cardId, chatId: job.chatId, runId: job.run.id, purpose: after.chat.purpose, status: result.status, error: result.error ?? null }) } catch { /* notificação é best-effort */ }
    } catch (error) {
      if (this.stopping) return
      const message = timedOut ? timeoutError() : error instanceof Error ? error.message : String(error)
      const aborted = controller.signal.aborted && !timedOut
      // Sem isto o card só ficava Pausado, sem dizer por quê (ex.: a worktree não pôde ser criada).
      if (!aborted) this.conversations.addMessage({ chatId: job.chatId, role: 'system', body: message, status: 'failed' })
      this.conversations.updateRun(job.run.id, aborted ? 'interrupted' : 'failed', message)
      publish({ type: 'gearmod/run-completed', payload: { chatId: job.chatId, status: aborted ? 'interrupted' : 'failed', error: message } })
      // Run que termina em erro também fecha o ciclo: o harness confere o que mudou e o encadeamento entre etapas segue.
      try {
        const after = this.conversations.context(job.chatId), status = aborted ? 'interrupted' as const : 'failed' as const
        if (after.cardId && after.chat.purpose !== 'free' && after.chat.purpose !== 'constitution') {
          if (this.harness) try { (await this.harness.after({ cardId: after.cardId, runId: job.run.id, chatId: job.chatId, purpose: after.chat.purpose, status })).forEach((body) => this.conversations.addMessage({ chatId: job.chatId, role: 'system', body, status: 'failed' })) } catch { /* aviso do harness é best-effort */ }
          try { this.collab?.afterRun({ cardId: after.cardId, chatId: job.chatId, purpose: after.chat.purpose, status }) } catch { /* encadeamento é best-effort */ }
        }
      } catch { /* chat removido */ }
      try { const after = this.conversations.context(job.chatId); this.onFinished?.({ cardId: after.cardId, chatId: job.chatId, runId: job.run.id, purpose: after.chat.purpose, status: aborted ? 'interrupted' : 'failed', error: message }) } catch { /* notificação é best-effort */ }
    } finally { this.permissions.closeRun(job.run.id); if (timer) clearTimeout(timer); this.controllers.delete(job.run.id) }
  }
}
