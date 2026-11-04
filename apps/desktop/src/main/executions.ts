import type { AgentConfig, Run } from '@gearmod/contracts'
import type { AgentConfigRepository } from './agent-config'
import type { ConversationRepository } from './conversations'
import type { AgentOrchestrator } from './orchestrator'
import type { BoardRepository } from './projects'
import type { CardHistoryService } from './history'
import { specKitCommand, specKitGeminiMessage, specKitProvider, type SpecKitRuntime } from './speckit'
import { tm } from './i18n'

// The step by step lives in the plugin skills (gearmod-implement, gearmod-test, gearmod-small): the prompt only points to the skill.
const steps = {
  execution: { skill: 'gearmod-implement', start: 'implement this card', resume: 'continue the implementation where it left off' },
  test: { skill: 'gearmod-test', start: 'test this card', resume: 'continue the test where it left off' },
  short: { skill: 'gearmod-small', start: 'do this card in the short workflow from start to finish', resume: 'continue the short-workflow card where it left off' }
} as const
const skillPrompt = (what: string, skill: string): string => `Use the ${skill} skill to ${what}.`
const skillNotice = (skill: string, extra = ''): string => `▶ Usando a skill ${skill}${extra}`

/** Start and continue runs: Start approves the current plan, moves the card to Doing and uses the card's execution chat. */
export class ExecutionService {
  constructor(private readonly board: BoardRepository, private readonly conversations: ConversationRepository, private readonly orchestrator: Pick<AgentOrchestrator, 'start'>, private readonly configs?: Pick<AgentConfigRepository, 'set'>, private readonly git?: { branches(localPath: string): Promise<string[]> }, private readonly history?: Pick<CardHistoryService, 'config'>, private readonly speckit?: Pick<SpecKitRuntime, 'active' | 'artifacts'>) {}

  /** Implementation (default) or testing: each stage has its own chat and its own agent; once started the agent is locked (switching restarts the chat). */
  /** Branches for the worktree: uses the selected SDD repository and the project's base branch as the default. `locked` when the worktree already exists. */
  async branches(cardId: string): Promise<{ branches: string[]; current: string | null; selected: string | null; locked: boolean }> {
    const card = this.board.card(cardId), project = this.board.get(card.projectId).project, sddSourceId = this.history?.config(card.projectId).sdd.sourceId
    const source = (sddSourceId ? project.sources.find((item) => item.id === sddSourceId && item.isGitRepository) : undefined) ?? project.sources.find((item) => item.isGitRepository)
    const branches = source && this.git ? await this.git.branches(source.localPath).catch(() => []) : []
    return { branches, current: project.baseBranch || (source?.currentBranch ?? null), selected: this.board.baseBranch(cardId), locked: Boolean(card.workspace) }
  }

  start(cardId: string, config: AgentConfig, purpose: 'execution' | 'test' = 'execution', baseBranch?: string): Run {
    const card = this.assertIdle(cardId), small = card.workflow === 'light'
    if (small && purpose === 'test') throw new Error(tm().executions.smallTaskNoTestStage)
    const speckit = purpose === 'execution' && !small && this.speckit?.active(cardId)
    if (speckit && !this.speckit!.artifacts(cardId).ready) throw new Error(tm().executions.speckitNotReady)
    if (baseBranch && !card.workspace) this.board.setBaseBranch(cardId, baseBranch)
    const profileId = config.profileId
    const existing = this.conversations.listChats(card.projectId, cardId).find((chat) => chat.purpose === purpose)
    if (existing && existing.profileId !== profileId) throw new Error(tm().executions.stageHasOtherAgent)
    this.configs?.set(cardId, purpose, config)
    if (purpose === 'execution') {
      const columns = this.board.get(card.projectId).columns, doing = columns.find((column) => column.semanticState === 'doing')
      if (doing && card.columnId !== doing.id) this.board.move(cardId, doing.id, null, 'user')
      if (!small) this.conversations.approveCurrentPlan(cardId, profileId, this.board.documents.read(cardId, 'plano'))
    }
    const chat = this.conversations.purposeChat(card.projectId, cardId, purpose, profileId)
    // Spec Kit: implementation is the native speckit-implement skill, only after the card's feature has a specification, plan and tasks.
    if (speckit) {
      const provider = specKitProvider(chat.provider)
      if (!provider) throw new Error(specKitGeminiMessage())
      return this.orchestrator.start({ chatId: chat.id, prompt: specKitCommand(provider, 'implement', ''), planning: false, notice: skillNotice('speckit-implement') })
    }
    const step = steps[small ? 'short' : purpose]
    return this.orchestrator.start({ chatId: chat.id, prompt: skillPrompt(step.start, step.skill), planning: false, notice: skillNotice(step.skill) })
  }

  resume(cardId: string, purpose?: 'execution' | 'test'): Run {
    const card = this.assertIdle(cardId)
    const chats = this.conversations.listChats(card.projectId, cardId).filter((item) => purpose ? item.purpose === purpose : item.purpose !== 'planning')
    const chat = chats[0]
    if (!chat) throw new Error(tm().executions.nothingToContinue)
    const step = steps[card.workflow === 'light' ? 'short' : chat.purpose === 'test' ? 'test' : 'execution']
    return this.orchestrator.start({ chatId: chat.id, prompt: skillPrompt(step.resume, step.skill), planning: false, notice: skillNotice(step.skill, ' · retomando de onde parou') })
  }

  private assertIdle(cardId: string) {
    const card = this.board.card(cardId)
    if (card.run.state === 'running' || card.run.state === 'planning') throw new Error(tm().executions.agentAlreadyWorking)
    return card
  }
}
