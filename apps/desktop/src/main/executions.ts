import type { AgentConfig, Run } from '@agentboard/contracts'
import type { AgentConfigRepository } from './agent-config'
import type { ConversationRepository } from './conversations'
import type { AgentOrchestrator } from './orchestrator'
import type { BoardRepository } from './projects'

// O passo a passo vive nas skills do plugin (agentboard-implementar, agentboard-testar, agentboard-pequena): o prompt só aponta para a skill.
const steps = {
  execution: { skill: 'agentboard-implementar', start: 'implementar este card', resume: 'continuar a implementação de onde parou' },
  test: { skill: 'agentboard-testar', start: 'testar este card', resume: 'continuar o teste de onde parou' },
  minor: { skill: 'agentboard-pequena', start: 'fazer esta tarefa pequena do começo ao fim', resume: 'continuar a tarefa pequena de onde parou' }
} as const
const skillPrompt = (what: string, skill: string): string => `Use a skill ${skill} para ${what}.`
const skillNotice = (skill: string, extra = ''): string => `▶ Usando a skill ${skill}${extra}`

/** Iniciar e continuar execuções: Iniciar aprova o plano atual, leva o card para Doing e usa o chat de execução do card. */
export class ExecutionService {
  constructor(private readonly board: BoardRepository, private readonly conversations: ConversationRepository, private readonly orchestrator: Pick<AgentOrchestrator, 'start'>, private readonly configs?: Pick<AgentConfigRepository, 'set'>, private readonly git?: { branches(localPath: string): Promise<string[]> }) {}

  /** Implementação (padrão) ou teste: cada etapa tem o seu chat e o seu agente; depois de iniciado o agente fica travado (trocar reinicia o chat). */
  /** Branches para a worktree do card sair delas: as do primeiro repositório Git do projeto. `locked` quando a worktree já existe (a base não muda mais). */
  async branches(cardId: string): Promise<{ branches: string[]; current: string | null; selected: string | null; locked: boolean }> {
    const card = this.board.card(cardId), source = this.board.get(card.projectId).project.sources.find((item) => item.isGitRepository)
    const branches = source && this.git ? await this.git.branches(source.localPath).catch(() => []) : []
    return { branches, current: source?.currentBranch ?? null, selected: this.board.baseBranch(cardId), locked: Boolean(card.workspace) }
  }

  start(cardId: string, config: AgentConfig, purpose: 'execution' | 'test' = 'execution', baseBranch?: string): Run {
    const card = this.assertIdle(cardId), small = card.type === 'minor'
    if (small && purpose === 'test') throw new Error('Tarefa pequena não tem etapa de teste separada: o mesmo agente já valida.')
    if (baseBranch && !card.workspace) this.board.setBaseBranch(cardId, baseBranch)
    const profileId = config.profileId
    const existing = this.conversations.listChats(card.projectId, cardId).find((chat) => chat.purpose === purpose)
    if (existing && existing.profileId !== profileId) throw new Error('Esta etapa já tem um chat com outro agente. Trocar o agente reinicia o chat.')
    this.configs?.set(cardId, purpose, config)
    if (purpose === 'execution') {
      const columns = this.board.get(card.projectId).columns, doing = columns.find((column) => column.semanticState === 'doing')
      if (doing && card.columnId !== doing.id) this.board.move(cardId, doing.id, null, 'user')
      if (!small) this.conversations.approveCurrentPlan(cardId, profileId, this.board.documents.read(cardId, 'plano'))
    }
    const chat = this.conversations.purposeChat(card.projectId, cardId, purpose, profileId)
    const step = steps[small ? 'minor' : purpose]
    return this.orchestrator.start({ chatId: chat.id, prompt: skillPrompt(step.start, step.skill), planning: false, notice: skillNotice(step.skill) })
  }

  resume(cardId: string, purpose?: 'execution' | 'test'): Run {
    const card = this.assertIdle(cardId)
    const chats = this.conversations.listChats(card.projectId, cardId).filter((item) => purpose ? item.purpose === purpose : item.purpose !== 'planning')
    const chat = chats[0]
    if (!chat) throw new Error('Este card ainda não tem execução para continuar')
    const step = steps[card.type === 'minor' ? 'minor' : chat.purpose === 'test' ? 'test' : 'execution']
    return this.orchestrator.start({ chatId: chat.id, prompt: skillPrompt(step.resume, step.skill), planning: false, notice: skillNotice(step.skill, ' · retomando de onde parou') })
  }

  private assertIdle(cardId: string) {
    const card = this.board.card(cardId)
    if (card.run.state === 'running' || card.run.state === 'planning') throw new Error('Este card já tem um agente trabalhando')
    return card
  }
}
