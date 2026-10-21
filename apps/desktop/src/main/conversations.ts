import { randomUUID } from 'node:crypto'
import type { Chat, ChatMessage, Plan, Run, RunEvent } from '@agentboard/contracts'
import type { AgentProfile } from '@agentboard/contracts'
import type { AppDatabase } from './database'

export class ConversationRepository {
  constructor(private readonly database: AppDatabase) {}

  listChats(projectId: string, cardId?: string | null): Chat[] {
    const where = cardId === undefined ? 'project_id = ?' : cardId === null ? 'project_id = ? AND card_id IS NULL' : 'project_id = ? AND card_id = ?'
    const args = cardId === undefined || cardId === null ? [projectId] : [projectId, cardId]
    return this.database.db.prepare(`SELECT id, project_id AS projectId, card_id AS cardId, purpose, provider, profile_id AS profileId,
      provider_session_id AS providerSessionId, created_at AS createdAt, updated_at AS updatedAt FROM chats WHERE ${where} ORDER BY updated_at DESC`).all(...args) as Chat[]
  }

  createChat(input: { projectId: string; cardId: string | null; purpose: 'planning' | 'execution'; profileId: string }): Chat {
    const allowed = this.database.db.prepare('SELECT ap.provider FROM project_agent_profiles pap JOIN agent_profiles ap ON ap.id = pap.profile_id WHERE pap.project_id = ? AND pap.profile_id = ? AND pap.allowed = 1 AND ap.enabled = 1').get(input.projectId, input.profileId) as { provider: 'codex' | 'claude' } | undefined
    if (!allowed) throw new Error('Perfil não permitido para este projeto')
    if (input.cardId && !this.database.db.prepare('SELECT 1 FROM cards WHERE id = ? AND project_id = ?').get(input.cardId, input.projectId)) throw new Error('Card não pertence ao projeto')
    const id = randomUUID(), now = new Date().toISOString()
    this.database.db.prepare(`INSERT INTO chats(id, project_id, card_id, purpose, provider, profile_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.projectId, input.cardId, input.purpose, allowed.provider, input.profileId, now, now)
    return this.listChats(input.projectId, input.cardId).find((chat) => chat.id === id)!
  }

  listMessages(chatId: string): ChatMessage[] {
    return this.database.db.prepare(`SELECT id, chat_id AS chatId, role, body, status, created_at AS createdAt,
      provider_message_id AS providerMessageId FROM chat_messages WHERE chat_id = ? ORDER BY created_at, rowid`).all(chatId) as ChatMessage[]
  }

  addMessage(input: { chatId: string; role: string; body: string; status: string }): ChatMessage {
    const id = randomUUID(), now = new Date().toISOString()
    if (!this.database.db.prepare('SELECT 1 FROM chats WHERE id = ?').get(input.chatId)) throw new Error('Chat não encontrado')
    this.database.db.prepare('INSERT INTO chat_messages(id, chat_id, role, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, input.chatId, input.role, input.body, input.status, now)
    this.database.db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(now, input.chatId)
    return this.listMessages(input.chatId).find((message) => message.id === id)!
  }

  createRun(input: { cardId: string; chatId: string; profileId: string }): Run {
    const valid = this.database.db.prepare(`SELECT 1 FROM chats c JOIN cards k ON k.id = ? WHERE c.id = ? AND c.card_id = k.id AND c.profile_id = ?`).get(input.cardId, input.chatId, input.profileId)
    if (!valid) throw new Error('Run não corresponde ao card, chat e perfil')
    const id = randomUUID(), startedAt = new Date().toISOString()
    this.database.db.prepare(`INSERT INTO runs(id, card_id, chat_id, profile_id, status, started_at) VALUES (?, ?, ?, ?, 'queued', ?)`).run(id, input.cardId, input.chatId, input.profileId, startedAt)
    return { id, ...input, status: 'queued', startedAt, endedAt: null, exitReason: null, worktreeId: null, providerTurnId: null }
  }

  appendEvent(runId: string, eventType: string, payload: Record<string, unknown>): RunEvent {
    const next = this.database.db.prepare('SELECT COALESCE(MAX(seq), -1) + 1 AS seq FROM run_events WHERE run_id = ?').get(runId) as { seq: number }
    const event = { id: randomUUID(), runId, seq: next.seq, eventType, payload, createdAt: new Date().toISOString() }
    this.database.db.prepare('INSERT INTO run_events(id, run_id, seq, event_type, payload_json_sanitized, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(event.id, runId, event.seq, eventType, JSON.stringify(payload), event.createdAt)
    return event
  }

  context(chatId: string): { chat: Chat; cardId: string; projectPath: string; profile: AgentProfile } {
    const row = this.database.db.prepare(`SELECT c.id, c.project_id AS projectId, c.card_id AS cardId, c.purpose, c.provider,
      c.profile_id AS profileId, c.provider_session_id AS providerSessionId, c.created_at AS createdAt, c.updated_at AS updatedAt,
      p.local_path AS projectPath, ap.label, ap.scope, ap.color, ap.config_dir AS configDir, ap.executable_path AS executablePath, ap.enabled
      FROM chats c JOIN projects p ON p.id = c.project_id JOIN agent_profiles ap ON ap.id = c.profile_id WHERE c.id = ?`).get(chatId) as (Chat & { projectPath: string; label: string; scope: string; color: string; configDir: string; executablePath: string | null; enabled: number }) | undefined
    if (!row?.cardId) throw new Error('A execução exige um chat associado a um card')
    const { projectPath, label, scope, color, configDir, executablePath, enabled, ...chat } = row
    return { chat, cardId: row.cardId, projectPath, profile: { id: row.profileId, provider: row.provider, label, scope, color, configDir, executablePath, enabled: Boolean(enabled) } }
  }

  updateSession(chatId: string, providerSessionId: string): void {
    this.database.db.prepare('UPDATE chats SET provider_session_id = ?, updated_at = ? WHERE id = ?').run(providerSessionId, new Date().toISOString(), chatId)
  }

  updateRun(runId: string, status: Run['status'], exitReason: string | null, providerTurnId: string | null = null): void {
    const ended = ['completed', 'failed', 'interrupted', 'cancelled'].includes(status) ? new Date().toISOString() : null
    this.database.db.prepare('UPDATE runs SET status = ?, ended_at = ?, exit_reason = ?, provider_turn_id = COALESCE(?, provider_turn_id) WHERE id = ?').run(status, ended, exitReason, providerTurnId, runId)
  }

  attachWorktree(runId: string, worktreeId: string): void {
    this.database.db.prepare('UPDATE runs SET worktree_id = ? WHERE id = ?').run(worktreeId, runId)
  }

  savePlan(cardId: string, profileId: string, content: string): void {
    const version = (this.database.db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS value FROM plans WHERE card_id = ?').get(cardId) as { value: number }).value
    this.database.db.prepare(`INSERT INTO plans(id, card_id, version, agent_profile_id, content_md, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'draft', ?)`).run(randomUUID(), cardId, version, profileId, content, new Date().toISOString())
  }

  listPlans(cardId: string): Plan[] {
    return this.database.db.prepare(`SELECT id, card_id AS cardId, version, agent_profile_id AS agentProfileId,
      content_md AS contentMd, status, created_at AS createdAt, approved_at AS approvedAt
      FROM plans WHERE card_id = ? ORDER BY version DESC`).all(cardId) as Plan[]
  }

  approvePlan(planId: string): Plan {
    const plan = this.database.db.prepare('SELECT card_id AS cardId FROM plans WHERE id = ?').get(planId) as { cardId: string } | undefined
    if (!plan) throw new Error('Plano não encontrado')
    const approve = this.database.db.transaction(() => {
      this.database.db.prepare(`UPDATE plans SET status = 'superseded' WHERE card_id = ? AND status = 'approved'`).run(plan.cardId)
      this.database.db.prepare(`UPDATE plans SET status = 'approved', approved_at = ? WHERE id = ?`).run(new Date().toISOString(), planId)
    })
    approve()
    return this.listPlans(plan.cardId).find((item) => item.id === planId)!
  }

  /** Garante que o Plano atual do card exista como versão em `plans` e o aprova (Iniciar aprova o plano). */
  approveCurrentPlan(cardId: string, profileId: string, planDocument: string): Plan | null {
    const latest = this.listPlans(cardId)[0]
    if (planDocument.trim() && latest?.contentMd !== planDocument) this.savePlan(cardId, profileId, planDocument)
    const target = this.listPlans(cardId)[0]
    return target ? this.approvePlan(target.id) : null
  }

  /** Chat de execução do card (um por card, com o histórico), criado na primeira execução. */
  executionChat(projectId: string, cardId: string, profileId: string): Chat {
    const existing = this.listChats(projectId, cardId).find((chat) => chat.purpose === 'execution')
    return existing ?? this.createChat({ projectId, cardId, purpose: 'execution', profileId })
  }

  reconcileInterrupted(): number {
    return this.database.db.prepare(`UPDATE runs SET status = 'interrupted', ended_at = ?, exit_reason = 'Application restarted' WHERE status IN ('queued', 'running')`).run(new Date().toISOString()).changes
  }
}
