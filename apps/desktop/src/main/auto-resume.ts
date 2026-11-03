import { randomUUID } from 'node:crypto'
import type { ChatPurpose, UsageWindow } from '@gearmod/contracts'
import type { AppDatabase } from './database'
import { getMainLocale, tm } from './i18n'

/** Um minuto de folga depois do horário em que o limite volta, para o provedor já ter liberado. */
const slackMs = 60_000
/** Sem horário conhecido: tenta de novo daqui a 15 minutos. */
const fallbackMs = 15 * 60_000

const limitPattern = /usageLimitExceeded|usage[_ ]limit|rate[_ ]limit|limit reached|hit your (usage |session |weekly )?limit|session limit|weekly limit|limite de uso|\b429\b/i

/** O erro da execução diz que o agente parou porque o limite de uso (sessão ou semana) acabou. */
export function isUsageLimit(error: string | null | undefined): boolean {
  return Boolean(error && limitPattern.test(error))
}

/**
 * Quando retomar: o horário que o próprio erro informa (epoch do Claude "…limit reached|1760000000", `resets_at`, `resets_in_seconds`)
 * ou, sem ele, o reset da janela de uso que está no limite. Sempre com um minuto de folga.
 */
export function resumeTime(error: string | null | undefined, windows: UsageWindow[], now = Date.now()): number {
  const text = error ?? ''
  const epoch = /(?:\||resets?_?at"?\s*[:=]\s*"?)(\d{10})(?!\d)/i.exec(text)
  if (epoch) { const at = Number(epoch[1]) * 1000; if (at > now) return at + slackMs }
  const seconds = /resets?_in_seconds"?\s*[:=]\s*(\d+)/i.exec(text)
  if (seconds) return now + Number(seconds[1]) * 1000 + slackMs
  const future = windows.filter((window) => window.resetsAt && Date.parse(window.resetsAt) > now)
  const full = future.filter((window) => window.usedPercent >= 95).map((window) => Date.parse(window.resetsAt!))
  if (full.length) return Math.max(...full) + slackMs
  const any = future.map((window) => Date.parse(window.resetsAt!))
  return any.length ? Math.min(...any) + slackMs : now + fallbackMs
}

export interface PendingResume { id: string; chatId: string; cardId: string | null; purpose: ChatPurpose; profileId: string; resumeAt: string; createdAt: string }

/** Retomadas agendadas (no banco, para sobreviver a fechar e abrir o app). */
export class AutoResumeRepository {
  constructor(private readonly database: AppDatabase) {}

  /** Uma retomada pendente por chat: agendar de novo só troca o horário. */
  schedule(input: { chatId: string; cardId: string | null; purpose: ChatPurpose; profileId: string; resumeAt: number }): PendingResume {
    const now = new Date().toISOString(), at = new Date(input.resumeAt).toISOString()
    this.database.db.transaction(() => {
      this.database.db.prepare("UPDATE auto_resumes SET status = 'replaced' WHERE chat_id = ? AND status = 'pending'").run(input.chatId)
      this.database.db.prepare(`INSERT INTO auto_resumes(id, chat_id, card_id, purpose, profile_id, resume_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
        .run(randomUUID(), input.chatId, input.cardId, input.purpose, input.profileId, at, now)
    })()
    return this.pending().find((item) => item.chatId === input.chatId)!
  }

  pending(): PendingResume[] {
    return this.database.db.prepare(`SELECT id, chat_id AS chatId, card_id AS cardId, purpose, profile_id AS profileId, resume_at AS resumeAt, created_at AS createdAt
      FROM auto_resumes WHERE status = 'pending' ORDER BY resume_at`).all() as PendingResume[]
  }

  due(now = Date.now()): PendingResume[] { return this.pending().filter((item) => Date.parse(item.resumeAt) <= now) }

  finish(id: string, status: 'done' | 'cancelled'): void { this.database.db.prepare('UPDATE auto_resumes SET status = ? WHERE id = ?').run(status, id) }

  /** O chat rodou de novo depois do agendamento (o usuário retomou à mão): a retomada automática não é mais necessária. */
  ranSince(item: PendingResume): boolean {
    return Boolean(this.database.db.prepare('SELECT 1 FROM runs WHERE chat_id = ? AND started_at > ? LIMIT 1').get(item.chatId, item.createdAt))
  }
}

export interface AutoResumeDeps {
  repository: AutoResumeRepository
  enabled(): boolean
  /** Janelas de uso atualizadas do agente (Claude faz uma chamada mínima para ler o limite). */
  usage(profileId: string): Promise<UsageWindow[]>
  /** Recomeça o chat de onde parou (implementação/teste pelo fluxo de Continuar; planejamento e chats do projeto com um pedido de continuar). */
  resume(item: PendingResume): void
  /** Aviso no chat (mensagem do sistema) e atualização da tela. */
  notify(chatId: string, body: string): void
}

const clock = (ms: number): string => {
  const date = new Date(ms), today = new Date().toDateString() === date.toDateString()
  return `${today ? '' : `${date.toLocaleDateString(getMainLocale(), { day: '2-digit', month: '2-digit' })} `}${date.toLocaleTimeString(getMainLocale(), { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Retomar sozinho quando o limite de uso volta: ao terminar uma execução por limite, agenda a retomada para o horário de volta (+1 min).
 * Na hora, confere se o limite voltou mesmo; se não, reagenda. Se o usuário já retomou à mão, desiste.
 */
export class AutoResumeService {
  private timer?: ReturnType<typeof setInterval>
  private checking = false
  constructor(private readonly deps: AutoResumeDeps) {}

  start(intervalMs = 30_000): void { this.timer = setInterval(() => void this.tick(), intervalMs); void this.tick() }
  stop(): void { if (this.timer) clearInterval(this.timer) }

  /** Chamado ao fim de cada execução. Devolve o horário agendado (ou null se não foi por limite). */
  async onFinished(info: { chatId: string; cardId: string | null; purpose: ChatPurpose; profileId: string; status: string; error: string | null }): Promise<number | null> {
    if (info.status !== 'failed' || !isUsageLimit(info.error)) return null
    const at = resumeTime(info.error, await this.deps.usage(info.profileId).catch(() => []))
    if (!this.deps.enabled()) { this.deps.notify(info.chatId, tm().autoResume.limitReachedManual(clock(at))); return null }
    this.deps.repository.schedule({ ...info, resumeAt: at })
    this.deps.notify(info.chatId, tm().autoResume.limitReachedAuto(clock(at)))
    return at
  }

  async tick(now = Date.now()): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      for (const item of this.deps.repository.due(now)) {
        if (!this.deps.enabled() || this.deps.repository.ranSince(item)) { this.deps.repository.finish(item.id, 'cancelled'); continue }
        // Confere se o limite voltou mesmo: se ainda tem janela cheia com reset no futuro, reagenda para ele.
        const windows = await this.deps.usage(item.profileId).catch(() => [])
        const blocked = windows.filter((window) => window.usedPercent >= 100 && window.resetsAt && Date.parse(window.resetsAt) > now)
        if (blocked.length) {
          const at = Math.max(...blocked.map((window) => Date.parse(window.resetsAt!))) + slackMs
          this.deps.repository.schedule({ ...item, resumeAt: at })
          this.deps.notify(item.chatId, tm().autoResume.limitStillActive(clock(at)))
          continue
        }
        this.deps.repository.finish(item.id, 'done')
        try { this.deps.resume(item) } catch (error) { this.deps.notify(item.chatId, tm().autoResume.resumeFailed(error instanceof Error ? error.message : String(error))) }
      }
    } finally { this.checking = false }
  }
}
