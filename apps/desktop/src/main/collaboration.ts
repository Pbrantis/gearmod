import { randomUUID } from 'node:crypto'
import type { AgentPurpose, Change, Collaboration, Question } from '@agentboard/contracts'
import type { AgentConfigRepository } from './agent-config'
import type { ConversationRepository } from './conversations'
import type { AppDatabase } from './database'
import type { BoardRepository } from './projects'
import { tm } from './i18n'

export interface FollowUp { chatId: string; prompt: string; planning: boolean }
const roleName: Record<AgentPurpose, string> = { planning: 'planejador', execution: 'desenvolvedor', test: 'testador' }
/** Papéis como aparecem nos prompts enviados aos agentes. */
const promptRole: Record<AgentPurpose, string> = { planning: 'planner', execution: 'developer', test: 'tester' }
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
    if (input.purpose === 'planning') throw new Error('The planner does not ask itself; if it needs a decision from the user, use agentboard_ask_user')
    const id = randomUUID(), number = this.next('card_questions', input.cardId)
    this.database.db.prepare(`INSERT INTO card_questions(id, card_id, number, asker_purpose, asker_chat_id, question, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`).run(id, input.cardId, number, input.purpose, input.chatId, input.question.trim(), new Date().toISOString())
    this.render(input.cardId)
    return this.list(input.cardId).questions.find((item) => item.id === id)!
  }

  /** Resposta do planejador (por número da dúvida). */
  answerFromPlanner(cardId: string, number: number, answer: string): void {
    const row = this.questions(cardId).find((item) => item.number === number)
    if (!row) throw new Error(tm().collaboration.questionNotFound(qLabel(number)))
    if (row.status === 'answered') throw new Error(tm().collaboration.questionAlreadyAnswered(qLabel(number)))
    this.database.db.prepare(`UPDATE card_questions SET status = 'answered', answer = ?, answered_by = 'planner', answered_at = ? WHERE id = ?`).run(answer.trim(), new Date().toISOString(), row.id)
    this.render(cardId)
  }

  /** O planejador não consegue decidir sozinho: a pergunta vai para o usuário. */
  escalateToUser(cardId: string, number: number, userQuestion: string): void {
    const row = this.questions(cardId).find((item) => item.number === number)
    if (!row) throw new Error(tm().collaboration.questionNotFound(qLabel(number)))
    if (row.status === 'answered') throw new Error(tm().collaboration.questionAlreadyAnswered(qLabel(number)))
    this.database.db.prepare(`UPDATE card_questions SET status = 'user', user_question = ? WHERE id = ?`).run(userQuestion.trim(), row.id)
    this.render(cardId)
  }

  answerByUser(questionId: string, answer: string): Collaboration {
    const row = this.database.db.prepare('SELECT id, card_id AS cardId, status FROM card_questions WHERE id = ?').get(questionId) as { id: string; cardId: string; status: string } | undefined
    if (!row) throw new Error(tm().collaboration.questionNotFoundPlain)
    if (row.status !== 'user') throw new Error(tm().collaboration.notWaitingForYou)
    this.database.db.prepare(`UPDATE card_questions SET status = 'answered', answer = ?, answered_by = 'user', answered_at = ? WHERE id = ?`).run(answer.trim(), new Date().toISOString(), row.id)
    this.render(row.cardId)
    this.deliverAnswers(row.cardId)
    return this.list(row.cardId)
  }

  /** Proposta de mudança do desenvolvedor ou do testador: nada é alterado até o usuário autorizar. */
  proposeChange(input: { cardId: string; chatId: string; purpose: AgentPurpose; title: string; details: string; reason: string }): Change {
    if (input.purpose === 'planning') throw new Error('The planner changes the documents directly; change proposals are for the developer and the tester')
    const id = randomUUID(), number = this.next('card_changes', input.cardId)
    this.database.db.prepare(`INSERT INTO card_changes(id, card_id, number, proposer_purpose, proposer_chat_id, title, details, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(id, input.cardId, number, input.purpose, input.chatId, input.title.trim(), input.details.trim(), input.reason.trim(), new Date().toISOString())
    this.render(input.cardId)
    return this.list(input.cardId).changes.find((item) => item.id === id)!
  }

  /** Aceitar e sugerir outra visão passam pelo planejador (ele atualiza os documentos); recusar volta direto ao autor. */
  decideChange(changeId: string, decision: 'accept' | 'reject' | 'suggest', note?: string): Collaboration {
    const row = this.database.db.prepare(`SELECT card_id AS cardId FROM card_changes WHERE id = ?`).get(changeId) as { cardId: string } | undefined
    if (!row) throw new Error(tm().common.proposalNotFound)
    const change = this.changes(row.cardId).find((item) => item.id === changeId)!
    if (change.status !== 'pending') throw new Error(tm().collaboration.proposalAlreadyDecided)
    if (decision === 'suggest' && !note?.trim()) throw new Error(tm().collaboration.suggestNeedsNote)
    const status = decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : 'suggested'
    this.database.db.prepare('UPDATE card_changes SET status = ?, user_note = ?, decided_at = ? WHERE id = ?').run(status, note?.trim() || null, new Date().toISOString(), changeId)
    this.render(row.cardId)
    if (decision === 'reject') {
      this.start(this.resumeChange(change, `Change ${mLabel(change.number)} (${change.title}) was REJECTED by the user${note?.trim() ? `: ${note.trim()}` : ''}. Do not implement it. Continue with the rest of the plan.`))
    } else {
      const action = this.plannerAction(row.cardId, [
        decision === 'accept'
          ? `The user AUTHORIZED change ${mLabel(change.number)}, proposed by the ${promptRole[change.proposerPurpose]}: ${change.title}.\n\nDetails: ${change.details}\nReason: ${change.reason}\n\nUpdate the Specification, the Plan (including the test plan) and the Tasks to include the change, with agentboard_write_document. Do not implement anything.`
          : `The user did NOT accept change ${mLabel(change.number)} as proposed (${change.title}) and suggested a different view: ${note!.trim()}\n\nOriginal proposal: ${change.details}\n\nReassess and update the Specification, the Plan (including the test plan) and the Tasks according to the user's view, with agentboard_write_document. If it is not feasible, tell the user why with agentboard_ask_user. Do not implement anything.`
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
    if (!row) throw new Error(tm().common.proposalNotFound)
    const change = this.changes(row.cardId).find((item) => item.id === changeId)!
    if (change.status !== 'accepted' && change.status !== 'applied') throw new Error(tm().collaboration.onlyAuthorizedCanImplement)
    const card = this.board.card(row.cardId)
    const execution = this.conversations.listChats(card.projectId, row.cardId).find((chat) => chat.purpose === 'execution')
    const chatId = change.proposerChatId ?? execution?.id
    if (!chatId) throw new Error(tm().collaboration.noImplementationChat)
    this.database.db.prepare(`UPDATE card_changes SET status = 'applied', sent_at = ? WHERE id = ?`).run(new Date().toISOString(), changeId)
    this.render(row.cardId)
    this.start({ chatId, planning: false, prompt: `Change ${mLabel(change.number)} (${change.title}) was AUTHORIZED by the user. Work on it now.\n\nWhat changes: ${change.details}\nReason: ${change.reason}${change.userNote ? `\nUser note: ${change.userNote}` : ''}\n\nFollow the card documents; if any of them does not reflect this change yet, follow the details above and mention it in the Summary.` })
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
        ? `Change ${mLabel(change.number)} (${change.title}) was AUTHORIZED and is already in the card documents. Resume where you left off and implement according to the updated documents.`
        : `The user suggested a different view for ${mLabel(change.number)} (${change.title}): ${change.userNote}. The planner adjusted the documents; follow the updated documents and resume where you left off.`))
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
      const lines = items.map((item) => `${qLabel(item.number)} — ${item.question}\nAnswer (${item.answeredBy === 'user' ? 'user' : 'planner'}): ${item.answer}`).join('\n\n')
      this.start({ chatId, planning: false, prompt: `The questions below were answered. The card documents in the context already reflect what changed. Resume where you left off following the answers.\n\n${lines}` })
    }
  }

  private plannerQuestionsPrompt(items: QuestionRow[], retry = false): string {
    const lines = items.map((item) => `${qLabel(item.number)} (${promptRole[item.askerPurpose]}): ${item.question}`).join('\n')
    return `${retry ? 'You have not answered the questions below yet. ' : ''}Questions from the ${[...new Set(items.map((item) => promptRole[item.askerPurpose]))].join(' and ')} of this card. Answer each one by calling agentboard_answer_question (numero and resposta). If the answer changes the Specification, the Plan or the Tasks, update the documents FIRST with agentboard_write_document. If only the user can decide, call agentboard_ask_user (numero and a clear question). Do not implement anything.\n\n${lines}`
  }

  private resumeChange(change: ChangeRow, prompt: string): FollowUp {
    if (!change.proposerChatId) throw new Error(tm().collaboration.proposalNoOriginChat)
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
