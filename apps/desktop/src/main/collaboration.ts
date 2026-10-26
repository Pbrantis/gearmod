import { randomUUID } from 'node:crypto'
import type { AgentPurpose, Change, Collaboration, Question } from '@agentboard/contracts'
import type { AgentConfigRepository } from './agent-config'
import type { ConversationRepository } from './conversations'
import type { AppDatabase } from './database'
import type { BoardRepository } from './projects'

export interface FollowUp { chatId: string; prompt: string; planning: boolean }
const roleName: Record<AgentPurpose, string> = { planning: 'planejador', execution: 'desenvolvedor', test: 'testador' }
const maxPlannerRounds = 2

interface QuestionRow { id: string; number: number; askerPurpose: AgentPurpose; askerChatId: string | null; question: string; status: Question['status']; answer: string | null; answeredBy: Question['answeredBy']; userQuestion: string | null; rounds: number; delivered: number; createdAt: string; answeredAt: string | null }
interface ChangeRow { id: string; number: number; proposerPurpose: AgentPurpose; proposerChatId: string | null; title: string; details: string; reason: string; status: Change['status']; userNote: string | null; createdAt: string; decidedAt: string | null; sentAt: string | null }

const qLabel = (n: number): string => `D${String(n).padStart(3, '0')}`
const mLabel = (n: number): string => `M${String(n).padStart(3, '0')}`
const questionStatus: Record<Question['status'], string> = { open: 'aberta', planner: 'com o planejador', user: 'aguardando você', answered: 'respondida' }
const changeStatus: Record<Change['status'], string> = { pending: 'aguardando sua autorização', accepted: 'autorizada (planejador atualizando os documentos; depois vai para o desenvolvedor)', suggested: 'outra visão sugerida (planejador ajustando)', rejected: 'recusada', applied: 'aplicada nos documentos' }

/**
 * Comunicação entre as etapas do card. O desenvolvedor e o testador mandam dúvidas ao planejador (o app orquestra, e o planejador só
 * chega ao usuário se precisar) e propõem mudanças que esperam a autorização do usuário antes de virarem documentos e código.
 */
function publicQuestion(row: QuestionRow): Question {
  const { askerChatId: _a, rounds: _r, delivered: _d, ...item } = row
  void [_a, _r, _d]
  return item
}

function publicChange(row: ChangeRow): Change {
  const { proposerChatId: _p, ...item } = row
  void _p
  return item
}

export class CollaborationService {
  private starter?: (action: FollowUp) => void
  constructor(private readonly database: AppDatabase, private readonly board: BoardRepository, private readonly conversations: ConversationRepository, private readonly configs: Pick<AgentConfigRepository, 'get'>, private readonly notify: (cardId: string) => void = () => undefined) {}

  setStarter(starter: (action: FollowUp) => void): void { this.starter = starter }

  private questions(cardId: string): QuestionRow[] {
    return this.database.db.prepare(`SELECT id, number, asker_purpose AS askerPurpose, asker_chat_id AS askerChatId, question, status, answer, answered_by AS answeredBy, user_question AS userQuestion, rounds, delivered, created_at AS createdAt, answered_at AS answeredAt FROM card_questions WHERE card_id = ? ORDER BY number`).all(cardId) as QuestionRow[]
  }

  private changes(cardId: string): ChangeRow[] {
    return this.database.db.prepare(`SELECT id, number, proposer_purpose AS proposerPurpose, proposer_chat_id AS proposerChatId, title, details, reason, status, user_note AS userNote, created_at AS createdAt, decided_at AS decidedAt, sent_at AS sentAt FROM card_changes WHERE card_id = ? ORDER BY number`).all(cardId) as ChangeRow[]
  }

  list(cardId: string): Collaboration {
    this.board.card(cardId)
    return {
      questions: this.questions(cardId).map((item) => publicQuestion(item)),
      changes: this.changes(cardId).map((item) => publicChange(item))
    }
  }

  counts(cardId: string): { changes: number; questions: number; toSend: number } {
    return {
      toSend: (this.database.db.prepare(`SELECT COUNT(*) AS value FROM card_changes WHERE card_id = ? AND status IN ('accepted', 'applied') AND sent_at IS NULL`).get(cardId) as { value: number }).value,
      changes: (this.database.db.prepare(`SELECT COUNT(*) AS value FROM card_changes WHERE card_id = ? AND status = 'pending'`).get(cardId) as { value: number }).value,
      questions: (this.database.db.prepare(`SELECT COUNT(*) AS value FROM card_questions WHERE card_id = ? AND status = 'user'`).get(cardId) as { value: number }).value
    }
  }

  /** Reescreve os documentos Dúvidas e Mudanças a partir das tabelas. */
  private render(cardId: string): void {
    const questions = this.questions(cardId), changes = this.changes(cardId)
    const q = questions.map((item) => [`### ${qLabel(item.number)} · ${questionStatus[item.status]}`, `**Pergunta (${roleName[item.askerPurpose]}):** ${item.question}`, item.userQuestion && item.status === 'user' ? `**Pergunta do planejador para você:** ${item.userQuestion}` : '', item.answer ? `**Resposta (${item.answeredBy === 'user' ? 'você' : 'planejador'}):** ${item.answer}` : ''].filter(Boolean).join('\n\n')).join('\n\n')
    const c = changes.map((item) => [`### ${mLabel(item.number)} · ${item.title} · ${changeStatus[item.status]}`, `**Proposta (${roleName[item.proposerPurpose]}):** ${item.details}`, `**Motivo:** ${item.reason}`, item.userNote ? `**Sua anotação:** ${item.userNote}` : ''].filter(Boolean).join('\n\n')).join('\n\n')
    this.board.documents.write(cardId, 'duvidas', q ? `## Dúvidas\n\n${q}` : '', 'system')
    this.board.documents.write(cardId, 'mudancas', c ? `## Mudanças\n\n${c}` : '', 'system')
    this.notify(cardId)
  }

  private next(table: 'card_questions' | 'card_changes', cardId: string): number {
    return (this.database.db.prepare(`SELECT COALESCE(MAX(number), 0) + 1 AS value FROM ${table} WHERE card_id = ?`).get(cardId) as { value: number }).value
  }

  /** Dúvida do desenvolvedor ou do testador. Fica "aberta" até a execução dele terminar; aí o app aciona o planejador. */
  askQuestion(input: { cardId: string; chatId: string; purpose: AgentPurpose; question: string }): Question {
    if (input.purpose === 'planning') throw new Error('O planejador não pergunta a si mesmo; se precisar de uma decisão sua, use agentboard_pedir_ao_usuario')
    const id = randomUUID(), number = this.next('card_questions', input.cardId)
    this.database.db.prepare(`INSERT INTO card_questions(id, card_id, number, asker_purpose, asker_chat_id, question, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`).run(id, input.cardId, number, input.purpose, input.chatId, input.question.trim(), new Date().toISOString())
    this.render(input.cardId)
    return this.list(input.cardId).questions.find((item) => item.id === id)!
  }

  /** Resposta do planejador (por número da dúvida). */
  answerFromPlanner(cardId: string, number: number, answer: string): void {
    const row = this.questions(cardId).find((item) => item.number === number)
    if (!row) throw new Error(`Dúvida ${qLabel(number)} não encontrada`)
    if (row.status === 'answered') throw new Error(`A dúvida ${qLabel(number)} já foi respondida`)
    this.database.db.prepare(`UPDATE card_questions SET status = 'answered', answer = ?, answered_by = 'planner', answered_at = ? WHERE id = ?`).run(answer.trim(), new Date().toISOString(), row.id)
    this.render(cardId)
  }

  /** O planejador não consegue decidir sozinho: a pergunta vai para o usuário. */
  escalateToUser(cardId: string, number: number, userQuestion: string): void {
    const row = this.questions(cardId).find((item) => item.number === number)
    if (!row) throw new Error(`Dúvida ${qLabel(number)} não encontrada`)
    if (row.status === 'answered') throw new Error(`A dúvida ${qLabel(number)} já foi respondida`)
    this.database.db.prepare(`UPDATE card_questions SET status = 'user', user_question = ? WHERE id = ?`).run(userQuestion.trim(), row.id)
    this.render(cardId)
  }

  answerByUser(questionId: string, answer: string): Collaboration {
    const row = this.database.db.prepare('SELECT id, card_id AS cardId, status FROM card_questions WHERE id = ?').get(questionId) as { id: string; cardId: string; status: string } | undefined
    if (!row) throw new Error('Dúvida não encontrada')
    if (row.status !== 'user') throw new Error('Esta dúvida não está esperando resposta sua')
    this.database.db.prepare(`UPDATE card_questions SET status = 'answered', answer = ?, answered_by = 'user', answered_at = ? WHERE id = ?`).run(answer.trim(), new Date().toISOString(), row.id)
    this.render(row.cardId)
    this.deliverAnswers(row.cardId)
    return this.list(row.cardId)
  }

  /** Proposta de mudança do desenvolvedor ou do testador: nada é alterado até o usuário autorizar. */
  proposeChange(input: { cardId: string; chatId: string; purpose: AgentPurpose; title: string; details: string; reason: string }): Change {
    if (input.purpose === 'planning') throw new Error('O planejador altera os documentos direto; propostas de mudança são do desenvolvedor e do testador')
    const id = randomUUID(), number = this.next('card_changes', input.cardId)
    this.database.db.prepare(`INSERT INTO card_changes(id, card_id, number, proposer_purpose, proposer_chat_id, title, details, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(id, input.cardId, number, input.purpose, input.chatId, input.title.trim(), input.details.trim(), input.reason.trim(), new Date().toISOString())
    this.render(input.cardId)
    return this.list(input.cardId).changes.find((item) => item.id === id)!
  }

  /** Aceitar e sugerir outra visão passam pelo planejador (ele atualiza os documentos); recusar volta direto ao autor. */
  decideChange(changeId: string, decision: 'accept' | 'reject' | 'suggest', note?: string): Collaboration {
    const row = this.database.db.prepare(`SELECT card_id AS cardId FROM card_changes WHERE id = ?`).get(changeId) as { cardId: string } | undefined
    if (!row) throw new Error('Proposta não encontrada')
    const change = this.changes(row.cardId).find((item) => item.id === changeId)!
    if (change.status !== 'pending') throw new Error('Esta proposta já foi decidida')
    if (decision === 'suggest' && !note?.trim()) throw new Error('Conte qual é a sua visão para sugerir outra solução')
    const status = decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : 'suggested'
    this.database.db.prepare('UPDATE card_changes SET status = ?, user_note = ?, decided_at = ? WHERE id = ?').run(status, note?.trim() || null, new Date().toISOString(), changeId)
    this.render(row.cardId)
    if (decision === 'reject') {
      this.start(this.resumeChange(change, `A mudança ${mLabel(change.number)} (${change.title}) foi RECUSADA pelo usuário${note?.trim() ? `: ${note.trim()}` : ''}. Não implemente. Continue o restante do plano.`))
    } else {
      const action = this.plannerAction(row.cardId, [
        decision === 'accept'
          ? `O usuário AUTORIZOU a mudança ${mLabel(change.number)} proposta pelo ${roleName[change.proposerPurpose]}: ${change.title}.\n\nDetalhes: ${change.details}\nMotivo: ${change.reason}\n\nAtualize a Especificação, o Plano (inclusive o plano de testes) e as Tasks para incluir a mudança, com agentboard_escrever_documento. Não implemente nada.`
          : `O usuário NÃO aceitou a mudança ${mLabel(change.number)} como foi proposta (${change.title}) e sugeriu outra visão: ${note!.trim()}\n\nProposta original: ${change.details}\n\nReavalie e atualize a Especificação, o Plano (inclusive o plano de testes) e as Tasks conforme a visão do usuário, com agentboard_escrever_documento. Se for inviável, diga o porquê ao usuário com agentboard_pedir_ao_usuario. Não implemente nada.`
      ].join(''))
      if (action) this.start(action)
    }
    return this.list(row.cardId)
  }

  /**
   * Manda ao desenvolvedor (o chat de implementação) implementar uma mudança já autorizada. Normalmente acontece sozinho quando o
   * planejador termina de atualizar os documentos; este é o botão de lembrete para quando isso ainda não aconteceu.
   */
  sendChange(changeId: string): Collaboration {
    const row = this.database.db.prepare(`SELECT card_id AS cardId FROM card_changes WHERE id = ?`).get(changeId) as { cardId: string } | undefined
    if (!row) throw new Error('Proposta não encontrada')
    const change = this.changes(row.cardId).find((item) => item.id === changeId)!
    if (change.status !== 'accepted' && change.status !== 'applied') throw new Error('Só uma mudança autorizada pode ser mandada para implementar')
    const card = this.board.card(row.cardId)
    const execution = this.conversations.listChats(card.projectId, row.cardId).find((chat) => chat.purpose === 'execution')
    const chatId = change.proposerChatId ?? execution?.id
    if (!chatId) throw new Error('Este card ainda não tem chat de implementação. Inicie a execução primeiro.')
    this.database.db.prepare(`UPDATE card_changes SET status = 'applied', sent_at = ? WHERE id = ?`).run(new Date().toISOString(), changeId)
    this.render(row.cardId)
    this.start({ chatId, planning: false, prompt: `A mudança ${mLabel(change.number)} (${change.title}) foi AUTORIZADA pelo usuário. Trabalhe nela agora.\n\nO que muda: ${change.details}\nMotivo: ${change.reason}${change.userNote ? `\nAnotação do usuário: ${change.userNote}` : ''}\n\nSiga os documentos do card; se algum ainda não refletir esta mudança, siga os detalhes acima e avise no Resumo.` })
    return this.list(row.cardId)
  }

  /** Chamado quando uma execução termina com sucesso: encadeia o que estava esperando por ela. */
  afterRun(info: { cardId: string; chatId: string; purpose: AgentPurpose; status: string }): void {
    if (info.status !== 'completed') return
    if (info.purpose !== 'planning') {
      const open = this.questions(info.cardId).filter((item) => item.status === 'open' && item.askerChatId === info.chatId)
      if (!open.length) return
      for (const item of open) this.database.db.prepare(`UPDATE card_questions SET status = 'planner', rounds = rounds + 1 WHERE id = ?`).run(item.id)
      this.render(info.cardId)
      const action = this.plannerAction(info.cardId, this.plannerQuestionsPrompt(this.questions(info.cardId).filter((item) => open.some((o) => o.id === item.id))))
      if (action) this.start(action)
      return
    }
    // O planejador terminou: dúvidas sem resposta tentam de novo (até o limite) e depois vão para o usuário.
    const stuck = this.questions(info.cardId).filter((item) => item.status === 'planner')
    const retry = stuck.filter((item) => item.rounds < maxPlannerRounds)
    for (const item of stuck.filter((entry) => entry.rounds >= maxPlannerRounds)) this.database.db.prepare(`UPDATE card_questions SET status = 'user', user_question = ? WHERE id = ?`).run(item.question, item.id)
    if (retry.length) {
      for (const item of retry) this.database.db.prepare(`UPDATE card_questions SET rounds = rounds + 1 WHERE id = ?`).run(item.id)
      const action = this.plannerAction(info.cardId, this.plannerQuestionsPrompt(this.questions(info.cardId).filter((item) => retry.some((r) => r.id === item.id)), true))
      if (action) this.start(action)
    }
    if (stuck.length) this.render(info.cardId)
    // Mudanças autorizadas/ajustadas: os documentos já foram atualizados, o autor retoma.
    for (const change of this.changes(info.cardId).filter((item) => item.status === 'accepted' || item.status === 'suggested')) {
      this.database.db.prepare(`UPDATE card_changes SET status = 'applied', sent_at = ? WHERE id = ?`).run(new Date().toISOString(), change.id)
      this.start(this.resumeChange(change, change.status === 'accepted'
        ? `A mudança ${mLabel(change.number)} (${change.title}) foi AUTORIZADA e já está nos documentos do card. Retome de onde parou e implemente conforme os documentos atualizados.`
        : `O usuário sugeriu outra visão para ${mLabel(change.number)} (${change.title}): ${change.userNote}. O planejador ajustou os documentos; siga os documentos atualizados e retome de onde parou.`))
    }
    this.render(info.cardId)
    this.deliverAnswers(info.cardId)
  }

  /** Entrega as respostas ainda não entregues a quem perguntou, uma retomada por chat. */
  private deliverAnswers(cardId: string): void {
    const ready = this.questions(cardId).filter((item) => item.status === 'answered' && !item.delivered && item.askerChatId)
    const byChat = new Map<string, QuestionRow[]>()
    for (const item of ready) byChat.set(item.askerChatId!, [...(byChat.get(item.askerChatId!) ?? []), item])
    for (const [chatId, items] of byChat) {
      const blocked = this.questions(cardId).some((item) => item.askerChatId === chatId && (item.status === 'open' || item.status === 'planner' || item.status === 'user'))
      if (blocked) continue
      for (const item of items) this.database.db.prepare('UPDATE card_questions SET delivered = 1 WHERE id = ?').run(item.id)
      const lines = items.map((item) => `${qLabel(item.number)} — ${item.question}\nResposta (${item.answeredBy === 'user' ? 'usuário' : 'planejador'}): ${item.answer}`).join('\n\n')
      this.start({ chatId, planning: false, prompt: `As dúvidas abaixo foram respondidas. Os documentos do card no contexto já refletem o que mudou. Retome de onde parou seguindo as respostas.\n\n${lines}` })
    }
  }

  private plannerQuestionsPrompt(items: QuestionRow[], retry = false): string {
    const lines = items.map((item) => `${qLabel(item.number)} (${roleName[item.askerPurpose]}): ${item.question}`).join('\n')
    return `${retry ? 'Você ainda não respondeu as dúvidas abaixo. ' : ''}Dúvidas do ${[...new Set(items.map((item) => roleName[item.askerPurpose]))].join(' e ')} deste card. Responda cada uma chamando agentboard_responder_duvida (numero e resposta). Se a resposta mudar a Especificação, o Plano ou as Tasks, atualize os documentos ANTES com agentboard_escrever_documento. Se só o usuário puder decidir, chame agentboard_pedir_ao_usuario (numero e pergunta clara). Não implemente nada.\n\n${lines}`
  }

  private resumeChange(change: ChangeRow, prompt: string): FollowUp {
    if (!change.proposerChatId) throw new Error('A proposta não tem chat de origem')
    return { chatId: change.proposerChatId, planning: false, prompt }
  }

  /** Chat do planejador: o que já existe ou um novo com o agente de planejamento do card (senão o primeiro liberado no projeto). */
  private plannerAction(cardId: string, prompt: string): FollowUp | null {
    const card = this.board.card(cardId), project = this.board.get(card.projectId).project
    const existing = this.conversations.listChats(card.projectId, cardId).find((chat) => chat.purpose === 'planning')
    const profileId = existing?.profileId ?? this.configs.get(cardId).planning?.profileId ?? project.allowedProfileIds[0]
    if (!profileId) return null
    const chat = existing ?? this.conversations.createChat({ projectId: card.projectId, cardId, purpose: 'planning', profileId })
    return { chatId: chat.id, planning: true, prompt }
  }

  private start(action: FollowUp): void {
    try { this.starter?.(action) } catch (error) {
      try { this.conversations.addMessage({ chatId: action.chatId, role: 'system', body: `Não foi possível continuar automaticamente: ${error instanceof Error ? error.message : String(error)}`, status: 'failed' }) } catch { /* chat removido */ }
    }
  }
}
