import type { AgentConfig, Run } from '@agentboard/contracts'
import type { AgentConfigRepository } from './agent-config'
import type { ConversationRepository } from './conversations'
import type { AgentOrchestrator } from './orchestrator'
import type { BoardRepository } from './projects'

const startPrompt = [
  'Execute este card seguindo o Plano e as Tasks do contexto, na worktree atual.',
  'Preserve mudanças existentes e valide o resultado (testes, lint e typecheck do projeto).',
  'Marque cada task concluída com agentboard_marcar_task e, ao terminar, atualize o Resumo com agentboard_escrever_documento (status, progresso e próximo passo).',
  'Não mova o card de coluna: isso é com o usuário.'
].join('\n')
const resumePrompt = 'Continue de onde parou, seguindo o Plano e as Tasks do contexto. Marque as tasks que concluir e atualize o Resumo ao terminar.'

/** Iniciar e continuar execuções: Iniciar aprova o plano atual, leva o card para Doing e usa o chat de execução do card. */
export class ExecutionService {
  constructor(private readonly board: BoardRepository, private readonly conversations: ConversationRepository, private readonly orchestrator: Pick<AgentOrchestrator, 'start'>, private readonly configs?: Pick<AgentConfigRepository, 'set'>) {}

  start(cardId: string, config: AgentConfig): Run {
    const card = this.assertIdle(cardId)
    const profileId = config.profileId
    this.configs?.set(cardId, 'execution', config)
    const columns = this.board.get(card.projectId).columns, doing = columns.find((column) => column.semanticState === 'doing')
    if (doing && card.columnId !== doing.id) this.board.move(cardId, doing.id, null, 'user')
    this.conversations.approveCurrentPlan(cardId, profileId, this.board.documents.read(cardId, 'plano'))
    const chat = this.conversations.executionChat(card.projectId, cardId, profileId)
    return this.orchestrator.start({ chatId: chat.id, prompt: startPrompt, planning: false })
  }

  resume(cardId: string): Run {
    const card = this.assertIdle(cardId)
    const chat = this.conversations.listChats(card.projectId, cardId).find((item) => item.purpose === 'execution')
    if (!chat) throw new Error('Este card ainda não tem execução para continuar')
    return this.orchestrator.start({ chatId: chat.id, prompt: resumePrompt, planning: false })
  }

  private assertIdle(cardId: string) {
    const card = this.board.card(cardId)
    if (card.run.state === 'running' || card.run.state === 'planning') throw new Error('Este card já tem um agente trabalhando')
    return card
  }
}
