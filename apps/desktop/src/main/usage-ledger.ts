import { randomUUID } from 'node:crypto'
import type { AppDatabase } from './database'
import { readArtifactHistory } from './history'
import { ApprovalService } from './approvals'
import { tm } from './i18n'

type RetentionRange = { from?: string; to?: string }
/** Seq reservada para o fechamento; deltas permanecem em 0..n e o fechamento continua por último. */
const finalSequence = 2_147_483_647
const csv = (value: unknown): string => { const text = value === null || value === undefined ? '' : String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }

/** Data (ano-mês-dia) local no fuso informado, já considerando o horário de verão da data em questão. */
function localDate(at: string, tz: string): { y: number; m: number; d: number } {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at)).split('-').map(Number) as [number, number, number]
  return { y, m, d }
}
/** Semana ISO-8601 (segunda a domingo, semana 1 contém a primeira quinta-feira do ano) da data local informada. */
function isoWeek(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}
/** Período local (dia/semana/mês) de um instante UTC, no fuso do usuário. */
function localPeriod(at: string, granularity: 'day' | 'week' | 'month', tz: string): string {
  const { y, m, d } = localDate(at, tz)
  if (granularity === 'month') return `${y}-${String(m).padStart(2, '0')}`
  if (granularity === 'week') return isoWeek(y, m, d)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export class UsageLedgerService {
  constructor(private readonly database: AppDatabase) {}

  recordRun(runId: string, usage: { input: number; cached: number; output: number; costUsd?: number } | undefined, partial = false): void {
    if (!usage) return
    const run = this.database.db.prepare(`SELECT r.id, r.started_at AS at, r.provider, r.profile_id AS profileId, ap.billing_mode AS billingMode, r.model AS modelConfigured, r.model_effective AS modelEffective,
      r.purpose, r.card_id AS cardId, c.title AS cardTitle, p.id AS projectId, p.name AS projectName
      FROM runs r JOIN agent_profiles ap ON ap.id=r.profile_id LEFT JOIN cards c ON c.id = r.card_id LEFT JOIN projects p ON p.id = c.project_id WHERE r.id = ?`).get(runId) as Record<string, unknown> | undefined
    if (!run || !run.provider || !run.profileId) return
    // A seq reservada identifica o fechamento da run sem alterar os deltas append-only.
    // A chave UNIQUE(run_id, seq) torna a gravação do fechamento idempotente, inclusive após deltas.
    const totals = this.database.db.prepare('SELECT COUNT(*) AS count,COUNT(cost_usd) AS cost_count FROM usage_ledger WHERE run_id=?').get(runId) as { count: number; cost_count: number }
    const existing = totals.count, finalCost = totals.cost_count ? undefined : usage.costUsd
    this.database.db.prepare(`INSERT OR IGNORE INTO usage_ledger (
      id, at, run_id, seq, source, provider, profile_id, model_configured, model_effective, project_id, project_name, card_id, card_title, purpose,
      input_tokens, cached_read_tokens, output_tokens, billing_mode, cost_kind, cost_usd, partial
    ) VALUES (?, ?, ?, ?, 'run', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), run.at, runId, finalSequence, run.provider, run.profileId, run.modelConfigured ?? null, run.modelEffective ?? null, run.projectId ?? null, run.projectName ?? null, run.cardId ?? null, run.cardTitle ?? null, run.purpose ?? null, existing ? 0 : usage.input, existing ? 0 : usage.cached, existing ? 0 : usage.output, run.billingMode ?? 'unknown', finalCost !== undefined && (run.billingMode === 'api' || run.billingMode === 'credits') ? 'billed' : 'unknown', finalCost ?? null, partial ? 1 : 0)
  }

  recordDelta(runId: string, usage: { input: number; cached: number; output: number }): void {
    if (!usage.input && !usage.cached && !usage.output) return
    if (this.database.db.prepare('SELECT 1 FROM usage_ledger WHERE run_id=? AND seq=?').get(runId, finalSequence)) return
    const run = this.database.db.prepare(`SELECT r.started_at AS at,r.provider,r.profile_id AS profileId,r.model AS modelConfigured,r.purpose,r.card_id AS cardId,c.title AS cardTitle,p.id AS projectId,p.name AS projectName FROM runs r LEFT JOIN cards c ON c.id=r.card_id LEFT JOIN projects p ON p.id=c.project_id WHERE r.id=?`).get(runId) as Record<string, unknown> | undefined
    if (!run || !run.provider || !run.profileId) return
    const seq = (this.database.db.prepare('SELECT COALESCE(MAX(seq),-1)+1 AS seq FROM usage_ledger WHERE run_id=? AND seq < ?').get(runId, finalSequence) as { seq: number }).seq
    if (seq >= finalSequence) throw new Error(tm().usageLedger.deltaLimitExceeded)
    this.database.db.prepare(`INSERT INTO usage_ledger(id,at,run_id,seq,source,provider,profile_id,model_configured,project_id,project_name,card_id,card_title,purpose,input_tokens,cached_read_tokens,output_tokens,partial) VALUES (?,?,?,?, 'run',?,?,?,?,?,?,?,?,?,?,?,0)`)
      .run(randomUUID(), run.at, runId, seq, run.provider, run.profileId, run.modelConfigured ?? null, run.projectId ?? null, run.projectName ?? null, run.cardId ?? null, run.cardTitle ?? null, run.purpose ?? null, usage.input, usage.cached, usage.output)
  }

  recordAuxiliary(profile: { id: string; provider: string; billingMode: string }, source: 'probe' | 'skill-review', usage?: { input: number; cached: number; output: number; costUsd?: number }): void {
    this.database.db.prepare(`INSERT INTO usage_ledger(id,at,run_id,seq,source,provider,profile_id,input_tokens,cached_read_tokens,output_tokens,billing_mode,cost_kind,cost_usd,partial) VALUES (?,?,NULL,0,?,?,?,?,?,?,?,?,?,0)`)
      .run(randomUUID(), new Date().toISOString(), source, profile.provider, profile.id, usage?.input ?? 0, usage?.cached ?? 0, usage?.output ?? 0, profile.billingMode, usage?.costUsd && (profile.billingMode === 'api' || profile.billingMode === 'credits') ? 'billed' : 'unknown', usage?.costUsd ?? null)
  }

  /**
   * O filtro de período (`at >= ?/<= ?`) usa o índice `usage_ledger_at`, que é o custo que importa em volume (`EXPLAIN QUERY PLAN`
   * sem `SCAN TABLE`). O agrupamento por dia/semana/mês, porém, precisa do fuso do usuário (inclusive em mudança de horário de
   * verão), que o SQLite não resolve por nome de fuso (`strftime` só sabe UTC/hora local do sistema); por isso os limites de dia são
   * calculados em JS com `Intl`, linha a linha, depois de já ter usado o índice para restringir o período.
   */
  history(input: { granularity: 'day' | 'week' | 'month'; tz: string; groupBy: 'provider' | 'profile' | 'model' | 'project' | 'card' | 'purpose'; from?: string; to?: string }): Array<{ period: string; group: string; input: number; cached: number; output: number; billedUsd: number; equivalentUsd: number; unknownUsd: number }> {
    const groups = { provider: 'provider', profile: 'profile_id', model: 'COALESCE(model_effective, model_configured, \'unknown\')', project: 'COALESCE(project_name, project_id, \'none\')', card: 'COALESCE(card_title, card_id, \'none\')', purpose: 'COALESCE(purpose, \'unknown\')' } as const
    const where: string[] = [], args: string[] = []
    if (input.from) { where.push('at >= ?'); args.push(input.from) }
    if (input.to) { where.push('at <= ?'); args.push(input.to) }
    const group = groups[input.groupBy]
    const rows = this.database.db.prepare(`SELECT at, ${group} AS "group", input_tokens AS input, cached_read_tokens AS cached, output_tokens AS output, cost_kind AS costKind, cost_usd AS costUsd FROM usage_ledger ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`).all(...args) as Array<{ at: string; group: string; input: number; cached: number; output: number; costKind: string; costUsd: number | null }>
    const buckets = new Map<string, { period: string; group: string; input: number; cached: number; output: number; billedUsd: number; equivalentUsd: number; unknownUsd: number }>()
    for (const row of rows) {
      const period = localPeriod(row.at, input.granularity, input.tz)
      const key = `${period}\u0000${row.group}`
      const bucket = buckets.get(key) ?? { period, group: row.group, input: 0, cached: 0, output: 0, billedUsd: 0, equivalentUsd: 0, unknownUsd: 0 }
      bucket.input += row.input; bucket.cached += row.cached; bucket.output += row.output
      if (row.costUsd) { if (row.costKind === 'billed') bucket.billedUsd += row.costUsd; else if (row.costKind === 'api_equivalent') bucket.equivalentUsd += row.costUsd; else bucket.unknownUsd += row.costUsd }
      buckets.set(key, bucket)
    }
    return [...buckets.values()].sort((a, b) => a.period === b.period ? (a.group < b.group ? -1 : a.group > b.group ? 1 : 0) : (a.period < b.period ? -1 : 1))
  }

  exportCsv(range: RetentionRange = {}): string {
    const where: string[] = [], args: string[] = []
    if (range.from) { where.push('at >= ?'); args.push(range.from) }
    if (range.to) { where.push('at <= ?'); args.push(range.to) }
    const rows = this.database.db.prepare(`SELECT id,at,run_id AS runId,seq,source,provider,profile_id AS profileId,account_key AS accountKey,model_configured AS modelConfigured,model_effective AS modelEffective,project_id AS projectId,project_name AS projectName,card_id AS cardId,card_title AS cardTitle,purpose,input_tokens AS inputTokens,cached_read_tokens AS cachedReadTokens,output_tokens AS outputTokens,billing_mode AS billingMode,cost_kind AS costKind,cost_usd AS costUsd,partial FROM usage_ledger ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at,id`).all(...args) as Array<Record<string, unknown>>
    const headers = ['id', 'at', 'runId', 'seq', 'source', 'provider', 'profileId', 'accountKey', 'modelConfigured', 'modelEffective', 'projectId', 'projectName', 'cardId', 'cardTitle', 'purpose', 'inputTokens', 'cachedReadTokens', 'outputTokens', 'billingMode', 'costKind', 'costUsd', 'partial']
    return [headers.join(','), ...rows.map((row) => headers.map((key) => csv(row[key])).join(','))].join('\n')
  }

  requestPurge(approvals: ApprovalService, range: RetentionRange = {}): ReturnType<ApprovalService['request']> {
    if (!range.from && !range.to) throw new Error(tm().usageLedger.enterPeriodLimit)
    return approvals.request({ kind: 'usage-ledger-purge', subjectRef: 'usage_ledger', payload: { from: range.from ?? null, to: range.to ?? null }, requestedActor: 'user' })
  }

  purge(range: RetentionRange, approvalId: string, approvals: ApprovalService): { deleted: number; csv: string } {
    if (!range.from && !range.to) throw new Error(tm().usageLedger.enterPeriodLimit)
    const payload = { from: range.from ?? null, to: range.to ?? null }
    const approval = approvals.get(approvalId)
    if (approval.kind !== 'usage-ledger-purge') throw new Error(tm().usageLedger.approvalNotForPurge)
    const csvBeforeDelete = this.exportCsv(range)
    return this.database.db.transaction(() => {
      approvals.consume(approvalId, ApprovalService.operationHash(payload))
      const where: string[] = [], args: string[] = []
      if (range.from) { where.push('at >= ?'); args.push(range.from) }
      if (range.to) { where.push('at <= ?'); args.push(range.to) }
      this.database.db.exec('DROP TRIGGER usage_ledger_no_update; DROP TRIGGER usage_ledger_no_delete;')
      const deleted = this.database.db.prepare(`DELETE FROM usage_ledger WHERE ${where.join(' AND ')}`).run(...args).changes
      this.database.db.exec(`CREATE TRIGGER usage_ledger_no_update BEFORE UPDATE ON usage_ledger BEGIN SELECT RAISE(ABORT, 'usage_ledger é append-only'); END;
        CREATE TRIGGER usage_ledger_no_delete BEFORE DELETE ON usage_ledger BEGIN SELECT RAISE(ABORT, 'usage_ledger é append-only'); END;`)
      return { deleted, csv: csvBeforeDelete }
    })()
  }

  /** Recovers token totals from versioned card history when the original run was deleted. */
  importHistory(cardId: string, artifactsDir: string): number {
    const card = this.database.db.prepare('SELECT c.title AS cardTitle, p.id AS projectId, p.name AS projectName FROM cards c JOIN projects p ON p.id=c.project_id WHERE c.id=?').get(cardId) as { cardTitle: string; projectId: string; projectName: string } | undefined
    if (!card) throw new Error(tm().common.cardNotFound)
    let imported = 0
    const insert = this.database.db.prepare(`INSERT OR IGNORE INTO usage_ledger (id,at,run_id,seq,source,provider,profile_id,model_configured,project_id,project_name,card_id,card_title,purpose,input_tokens,cached_read_tokens,output_tokens,cost_kind,cost_usd,partial)
      VALUES (?,?,?,?, 'backfill',?,?,?,?,?,?,?,?,?,?,?, 'unknown',?,1)`)
    const exists = this.database.db.prepare('SELECT 1 FROM usage_ledger WHERE run_id=? LIMIT 1')
    for (const event of readArtifactHistory(artifactsDir).events) {
      if (event.type !== 'execution.completed' && event.type !== 'verification.completed' && event.type !== 'handoff.completed') continue
      const payload = event.payload, runId = event.source.runId
      const profileId = typeof payload.profileId === 'string' ? payload.profileId : null
      const provider = typeof payload.provider === 'string' ? payload.provider : null
      if (!runId || !profileId || !provider) continue
      if (exists.get(runId)) continue
      const changed = insert.run(randomUUID(), event.at, runId, 0, provider, profileId, typeof payload.model === 'string' ? payload.model : null, card.projectId, card.projectName, cardId, card.cardTitle, typeof payload.purpose === 'string' ? payload.purpose : null, Number(payload.input) || 0, Number(payload.cached) || 0, Number(payload.output) || 0, typeof payload.costUsd === 'number' ? payload.costUsd : null).changes
      imported += changed
    }
    return imported
  }
}
