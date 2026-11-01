import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppDatabase } from './database'
import type { BoardRepository } from './projects'
import type { CardHistoryService } from './history'
import type { SddResolver } from './sdd/sdd-resolver'
import type { SddWriter } from './sdd/sdd-writer'
import { nativeGit, type WorktreeService } from './worktrees'
import { redact } from './redaction'
import { tm } from './i18n'

type UsageRow = { runId: string; provider: string; profileId: string | null; modelConfigured: string | null; modelEffective: string | null; inputTokens: number; cachedTokens: number; outputTokens: number; costKind: string; costUsd: number | null; partial: number }
/** Exportação explícita e serializada por card; o ledger e a cópia principal nunca são alterados. */
export class CardUsageExport {
  private readonly queues = new Map<string, Promise<void>>()
  constructor(private readonly database: AppDatabase, private readonly board: Pick<BoardRepository, 'card'>, private readonly history: Pick<CardHistoryService, 'config'>, private readonly resolver: Pick<SddResolver, 'locate'>, private readonly worktrees: Pick<WorktreeService, 'ensureMember'>, private readonly writer: Pick<SddWriter, 'write'>) {}
  export(cardId: string): Promise<void> {
    const previous = this.queues.get(cardId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.write(cardId))
    this.queues.set(cardId, next)
    void next.finally(() => { if (this.queues.get(cardId) === next) this.queues.delete(cardId) }).catch(() => undefined)
    return next
  }
  private async write(cardId: string): Promise<void> {
    const card = this.board.card(cardId), config = this.history.config(card.projectId)
    if (!config.exportUsage) return
    const location = await this.resolver.locate({ projectId: card.projectId, cardId })
    const member = await this.worktrees.ensureMember(cardId, location.sourceId)
    if (member.status !== 'active') throw new Error(member.error ?? tm().usageExport.worktreeUnavailable)
    const relPath = [config.sdd.root, config.sdd.featuresDir, `card-${cardId}`, 'usage.json'].filter(Boolean).join('/').replace(/\\/g, '/')
    // O writer valida o caminho antes de gravar; aqui não lemos o arquivo por um caminho não confiável.
    const rows = this.database.db.prepare(`SELECT run_id AS runId, provider, profile_id AS profileId, model_configured AS modelConfigured, model_effective AS modelEffective, input_tokens AS inputTokens, cached_read_tokens AS cachedTokens, output_tokens AS outputTokens, cost_kind AS costKind, cost_usd AS costUsd, partial FROM usage_ledger WHERE card_id=? AND run_id IS NOT NULL ORDER BY run_id, seq`).all(cardId) as UsageRow[]
    const byRun = new Map<string, { runId: string; provider: string; profileId: string | null; model: string | null; inputTokens: number; cachedTokens: number; outputTokens: number; costKinds: string[]; costs: Record<string, number>; partial: boolean }>()
    for (const row of rows) {
      const run = byRun.get(row.runId) ?? { runId: redact(row.runId), provider: redact(row.provider), profileId: row.profileId ? redact(row.profileId) : null, model: null, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costKinds: [], costs: {}, partial: false }
      if (row.modelEffective) run.model = redact(row.modelEffective)
      else if (!run.model && row.modelConfigured) run.model = redact(row.modelConfigured)
      run.inputTokens += row.inputTokens; run.cachedTokens += row.cachedTokens; run.outputTokens += row.outputTokens
      if (!run.costKinds.includes(row.costKind)) run.costKinds.push(row.costKind)
      if (row.costUsd !== null) run.costs[row.costKind] = (run.costs[row.costKind] ?? 0) + row.costUsd
      run.partial ||= Boolean(row.partial); byRun.set(row.runId, run)
    }
    const runs = [...byRun.values()]
    // Apenas caminhos relativos normalizados são usados antes de consultar o hash atual.
    if (!relPath || relPath.startsWith('/') || /^[a-zA-Z]:/.test(relPath) || relPath.split('/').some((part) => part === '..' || part === '.')) throw new Error(tm().usageExport.invalidExportPath)
    const target = join(member.path, relPath)
    const sha = existsSync(target) ? (await nativeGit.run(['hash-object', target])).stdout.trim() : null
    await this.writer.write(cardId, location.sourceId, relPath, `${JSON.stringify({ version: 1, cardId, runs }, null, 2)}\n`, { blobSha: sha })
  }
}
