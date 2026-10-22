import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Review, TestRun } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import type { WorktreeService } from './worktrees'

const exec = promisify(execFile)
export class QualityService {
  constructor(private readonly database: AppDatabase, private readonly worktrees: WorktreeService) {}

  async runTest(cardId: string, executable: string, args: string[]): Promise<TestRun> {
    const worktree = this.worktrees.get(cardId)
    if (!worktree) throw new Error('Crie a worktree antes de executar testes')
    const id = randomUUID(), startedAt = new Date().toISOString(), command = [executable, ...args].map(displayArg).join(' ')
    this.database.db.prepare(`INSERT INTO test_runs(id, card_id, command, status, summary, started_at) VALUES (?, ?, ?, 'running', '', ?)`).run(id, cardId, command, startedAt)
    let exitCode = 0, status: TestRun['status'] = 'passed', summary = ''
    try {
      const result = await exec(executable, args, { cwd: worktree.path, timeout: 10 * 60_000, windowsHide: true, maxBuffer: 5 * 1024 * 1024 })
      summary = `${result.stdout}\n${result.stderr}`.trim().slice(-100_000)
    } catch (error) {
      status = 'failed'; exitCode = typeof error === 'object' && error && 'code' in error && typeof error.code === 'number' ? error.code : 1
      summary = error instanceof Error ? error.message : String(error)
    }
    const endedAt = new Date().toISOString()
    this.database.db.prepare('UPDATE test_runs SET status = ?, exit_code = ?, summary = ?, ended_at = ? WHERE id = ?').run(status, exitCode, redact(summary), endedAt, id)
    return { id, cardId, command, status, exitCode, summary: redact(summary), startedAt, endedAt }
  }

  /** Último teste e última revisão do card: o que o gate de Done confere. */
  status(cardId: string): { test: TestRun | null; review: Review | null } {
    const test = this.database.db.prepare(`SELECT id, card_id AS cardId, command, status, exit_code AS exitCode, summary, started_at AS startedAt, ended_at AS endedAt
      FROM test_runs WHERE card_id = ? ORDER BY started_at DESC LIMIT 1`).get(cardId) as TestRun | undefined
    const review = this.database.db.prepare(`SELECT id, card_id AS cardId, provider, remote_url AS remoteUrl, remote_id AS remoteId,
      state, target_branch AS targetBranch, source_branch AS sourceBranch, updated_at AS updatedAt FROM reviews WHERE card_id = ? ORDER BY updated_at DESC LIMIT 1`).get(cardId) as Review | undefined
    return { test: test ?? null, review: review ?? null }
  }

  prepareLocalReview(cardId: string): Review {
    const worktree = this.worktrees.get(cardId)
    if (!worktree) throw new Error('Crie a worktree antes da revisão')
    const existing = this.database.db.prepare(`SELECT id, card_id AS cardId, provider, remote_url AS remoteUrl, remote_id AS remoteId,
      state, target_branch AS targetBranch, source_branch AS sourceBranch, updated_at AS updatedAt FROM reviews WHERE card_id = ? ORDER BY updated_at DESC LIMIT 1`).get(cardId) as Review | undefined
    if (existing) return existing
    const review: Review = { id: randomUUID(), cardId, provider: 'local', remoteUrl: null, remoteId: null, state: 'open', targetBranch: worktree.baseRef, sourceBranch: worktree.branch, updatedAt: new Date().toISOString() }
    this.database.db.prepare(`INSERT INTO reviews(id, card_id, provider, state, target_branch, source_branch, updated_at) VALUES (?, ?, 'local', 'open', ?, ?, ?)`).run(review.id, cardId, review.targetBranch, review.sourceBranch, review.updatedAt)
    return review
  }

  approveLocal(reviewId: string): Review {
    const row = this.database.db.prepare(`SELECT id, card_id AS cardId, provider, remote_url AS remoteUrl, remote_id AS remoteId,
      state, target_branch AS targetBranch, source_branch AS sourceBranch, updated_at AS updatedAt FROM reviews WHERE id = ?`).get(reviewId) as Review | undefined
    if (!row || row.provider !== 'local') throw new Error('Revisão local não encontrada')
    const updatedAt = new Date().toISOString()
    this.database.db.prepare(`UPDATE reviews SET state = 'approved', updated_at = ? WHERE id = ?`).run(updatedAt, reviewId)
    return { ...row, state: 'approved', updatedAt }
  }
}

function displayArg(value: string): string { return /\s/.test(value) ? JSON.stringify(value) : value }
function redact(value: string): string { return value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[redacted]').slice(0, 100_000) }
