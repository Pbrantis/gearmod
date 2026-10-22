import type { AgentConfig, Run } from '@agentboard/contracts'
import type { AgentConfigRepository } from './agent-config'
import type { ConversationRepository } from './conversations'
import type { AgentOrchestrator } from './orchestrator'
import type { BoardRepository } from './projects'

const startPrompt = [
  'Execute este card seguindo o Plano e as Tasks do contexto, na worktree atual.',
  'Preserve mudanças existentes e valide o resultado (testes, lint e typecheck do projeto).',
  'Marque cada task concluída com agentboard_marcar_task e, ao terminar, atualize o Resumo com agentboard_escrever_documento (status, progresso e próximo passo).',
  'Os documentos do card são o contrato entre as etapas: implemente o que está neles e nada além.',
  'Se algo fora dos documentos for necessário (escopo novo, requisito, refatoração extra), NÃO faça: registre com agentboard_propor_mudanca e continue só com o que está nos documentos; o usuário autoriza antes de qualquer alteração.',
  'Se tiver uma dúvida que os documentos não respondem, registre com agentboard_perguntar_ao_planejador, continue só com o que não depende dela e termine a execução: o app leva a dúvida ao planejador e te retoma com a resposta.',
  'Não mova o card de coluna: isso é com o usuário.'
].join('\n')
const testPrompt = [
  'Teste este card na worktree atual: confira as Tasks e os critérios de aceite do contexto contra o que foi implementado.',
  'Rode os testes, o lint e o typecheck do projeto, revise o diff e aponte o que falhar, com o motivo e onde.',
  'Marque com agentboard_marcar_task só o que você verificou de fato e, ao terminar, atualize o Resumo com agentboard_escrever_documento dizendo se está pronto ou o que falta.',
  'Use o plano de testes do Plano e os critérios das Tasks como roteiro; o que não estiver nos documentos e for preciso testar vira proposta com agentboard_propor_mudanca.',
  'Se tiver uma dúvida que os documentos não respondem, use agentboard_perguntar_ao_planejador, continue só com o que não depende dela e termine a execução; o app te retoma com a resposta.',
  'Não altere o código a menos que o usuário peça, e não mova o card de coluna.'
].join('\n')
const resumeTestPrompt = 'Continue o teste de onde parou, seguindo as Tasks e os critérios do contexto. Atualize o Resumo ao terminar.'
const resumePrompt = 'Continue de onde parou, seguindo o Plano e as Tasks do contexto. Marque as tasks que concluir e atualize o Resumo ao terminar.'

/** Iniciar e continuar execuções: Iniciar aprova o plano atual, leva o card para Doing e usa o chat de execução do card. */
export class ExecutionService {
  constructor(private readonly board: BoardRepository, private readonly conversations: ConversationRepository, private readonly orchestrator: Pick<AgentOrchestrator, 'start'>, private readonly configs?: Pick<AgentConfigRepository, 'set'>) {}

  /** Implementação (padrão) ou teste: cada etapa tem o seu chat e o seu agente; depois de iniciado o agente fica travado (trocar reinicia o chat). */
  start(cardId: string, config: AgentConfig, purpose: 'execution' | 'test' = 'execution'): Run {
    const card = this.assertIdle(cardId)
    const profileId = config.profileId
    const existing = this.conversations.listChats(card.projectId, cardId).find((chat) => chat.purpose === purpose)
    if (existing && existing.profileId !== profileId) throw new Error('Esta etapa já tem um chat com outro agente. Trocar o agente reinicia o chat.')
    this.configs?.set(cardId, purpose, config)
    if (purpose === 'execution') {
      const columns = this.board.get(card.projectId).columns, doing = columns.find((column) => column.semanticState === 'doing')
      if (doing && card.columnId !== doing.id) this.board.move(cardId, doing.id, null, 'user')
      this.conversations.approveCurrentPlan(cardId, profileId, this.board.documents.read(cardId, 'plano'))
    }
    const chat = this.conversations.purposeChat(card.projectId, cardId, purpose, profileId)
    return this.orchestrator.start({ chatId: chat.id, prompt: purpose === 'test' ? testPrompt : startPrompt, planning: false })
  }

  resume(cardId: string, purpose?: 'execution' | 'test'): Run {
    const card = this.assertIdle(cardId)
    const chats = this.conversations.listChats(card.projectId, cardId).filter((item) => purpose ? item.purpose === purpose : item.purpose !== 'planning')
    const chat = chats[0]
    if (!chat) throw new Error('Este card ainda não tem execução para continuar')
    return this.orchestrator.start({ chatId: chat.id, prompt: chat.purpose === 'test' ? resumeTestPrompt : resumePrompt, planning: false })
  }

  private assertIdle(cardId: string) {
    const card = this.board.card(cardId)
    if (card.run.state === 'running' || card.run.state === 'planning') throw new Error('Este card já tem um agente trabalhando')
    return card
  }
}
