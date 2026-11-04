import { randomUUID } from 'node:crypto'
import type { ChatPurpose, UsageWindow } from '@gearmod/contracts'
import type { AppDatabase } from './database'
import { getMainLocale, tm } from './i18n'

/** One minute of slack after the time the limit comes back, so the provider has already released it. */
const slackMs = 60_000
/** No known time: try again in 15 minutes. */
const fallbackMs = 15 * 60_000

const limitPattern = /usageLimitExceeded|usage[_ ]limit|rate[_ ]limit|limit reached|hit your (usage |session |weekly )?limit|session limit|weekly limit|limite de uso|\b429\b/i

/** The run error says the agent stopped because the usage limit (session or week) ran out. */
export function isUsageLimit(error: string | null | undefined): boolean {
  return Boolean(error && limitPattern.test(error))
}

/**
 * When to resume: the time the error itself reports (Claude's epoch "…limit reached|1760000000", `resets_at`, `resets_in_seconds`)
 * or, without it, the reset of the usage window that is at its limit. Always with a one-minute slack.
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

/** Scheduled resumes (in the database, to survive closing and reopening the app). */
export class AutoResumeRepository {
  constructor(private readonly database: AppDatabase) {}

  /** One pending resume per chat: scheduling again only changes the time. */
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

  /** The chat ran again after the scheduling (the user resumed by hand): the automatic resume is no longer needed. */
  ranSince(item: PendingResume): boolean {
    return Boolean(this.database.db.prepare('SELECT 1 FROM runs WHERE chat_id = ? AND started_at > ? LIMIT 1').get(item.chatId, item.createdAt))
  }
}

export interface AutoResumeDeps {
  repository: AutoResumeRepository
  enabled(): boolean
  /** Updated usage windows of the agent (Claude makes a minimal call to read the limit). */
  usage(profileId: string): Promise<UsageWindow[]>
  /** Restarts the chat from where it stopped (implementation/testing through the Continue flow; planning and project chats with a continue request). */
  resume(item: PendingResume): void
  /** Notice in the chat (system message) and screen update. */
  notify(chatId: string, body: string): void
}

const clock = (ms: number): string => {
  const date = new Date(ms), today = new Date().toDateString() === date.toDateString()
  return `${today ? '' : `${date.toLocaleDateString(getMainLocale(), { day: '2-digit', month: '2-digit' })} `}${date.toLocaleTimeString(getMainLocale(), { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Resume on its own when the usage limit comes back: when a run ends because of the limit, schedules the resume for the return time (+1 min).
 * At that time, checks that the limit really came back; if not, reschedules. If the user already resumed by hand, gives up.
 */
export class AutoResumeService {
  private timer?: ReturnType<typeof setInterval>
  private checking = false
  constructor(private readonly deps: AutoResumeDeps) {}

  start(intervalMs = 30_000): void { this.timer = setInterval(() => void this.tick(), intervalMs); void this.tick() }
  stop(): void { if (this.timer) clearInterval(this.timer) }

  /** Called at the end of each run. Returns the scheduled time (or null if it was not because of a limit). */
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
        // Checks that the limit really came back: if a window is still full with its reset in the future, reschedule for it.
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
