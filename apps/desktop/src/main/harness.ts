import { basename } from 'node:path'
import type { AppDatabase } from './database'
import type { CardHistoryService } from './history'
import { nativeGit, type GitRunner, type WorktreeService } from './worktrees'
import { getMainLocale, tm } from './i18n'
import { equivalentCostSql } from './usage-ledger'

/** O que o orquestrador consulta antes e depois de cada execução de card. */
export interface RunHarness {
  /** Motivo para não começar (orçamento estourado, falhas repetidas numa retomada automática) ou `null`. */
  before(input: { cardId: string; chatId: string; automatic: boolean }): string | null
  timeoutMs(cardId: string): number | null
  /** S10: HEAD (e branch) de cada repositório da worktree, guardado antes da execução para comparar depois. */
  snapshotRepos?(cardId: string): Promise<void>
  /** Avisos para o chat depois da execução (arquivos fora do escopo, repositórios que falharam). */
  after(input: { cardId: string; runId: string; chatId: string; purpose: string; status: string }): Promise<string[]>
}

/**
 * Harness da execução (docs/09, fase 10): limites por projeto que não travam o uso normal. Orçamento e tempo valem para toda execução
 * do card; o limite de tentativas só bloqueia retomadas automáticas (o usuário sempre pode mandar outra mensagem).
 */
export class HarnessService implements RunHarness {
  constructor(private readonly database: AppDatabase, private readonly history: Pick<CardHistoryService, 'config' | 'recordAlert'>, private readonly worktrees: Pick<WorktreeService, 'repositories'>, private readonly git: GitRunner = nativeGit) {}
  /** S10: por card, o HEAD (`branch@hash`) de cada repositório da worktree no início da execução. */
  private readonly headSnapshots = new Map<string, Map<string, string>>()

  private harness(cardId: string) {
    const projectId = this.database.db.prepare('SELECT project_id FROM cards WHERE id = ?').pluck().get(cardId) as string | undefined
    return projectId ? this.history.config(projectId).harness : null
  }

  before(input: { cardId: string; chatId: string; automatic: boolean }): string | null {
    const limits = this.harness(input.cardId)
    if (!limits) return null
    // Tokens: todos, independente de como são cobrados (vêm de `runs`, atualizado a cada execução).
    const tokens = this.database.db.prepare('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens FROM runs WHERE card_id = ?').get(input.cardId) as { tokens: number }
    if (limits.maxTokens !== null && tokens.tokens >= limits.maxTokens) return tm().harness.tokensExceeded(tokens.tokens.toLocaleString(getMainLocale()), limits.maxTokens.toLocaleString(getMainLocale()))
    // Custo: só o faturado (`cost_kind='billed'`) por padrão; `includeEquivalentCost` soma também o equivalente estimado de planos por assinatura.
    const costKinds = limits.includeEquivalentCost ? `(cost_kind = 'billed' OR ${equivalentCostSql})` : "cost_kind='billed'"
    const cost = this.database.db.prepare(`SELECT COALESCE(SUM(CASE WHEN ${costKinds} THEN cost_usd ELSE 0 END), 0) AS cost FROM usage_ledger WHERE card_id = ?`).get(input.cardId) as { cost: number }
    if (limits.maxCostUsd !== null && cost.cost >= limits.maxCostUsd) return tm().harness.costExceeded(cost.cost.toFixed(2), limits.includeEquivalentCost, limits.maxCostUsd.toFixed(2))
    if (input.automatic) {
      const repeated = repeatedFailure(this.database, input.chatId, limits.maxAttempts)
      if (repeated) return tm().harness.repeatedFailure(limits.maxAttempts, repeated.slice(0, 200))
    }
    return null
  }

  timeoutMs(cardId: string): number | null {
    const minutes = this.harness(cardId)?.timeoutMinutes ?? null
    return minutes === null ? null : minutes * 60_000
  }

  async snapshotRepos(cardId: string): Promise<void> {
    const snapshot = new Map<string, string>()
    for (const repo of this.worktrees.repositories(cardId).filter((item) => item.status === 'active')) {
      const head = await headRef(this.git, repo.path)
      if (head) snapshot.set(repo.path, head)
    }
    this.headSnapshots.set(cardId, snapshot)
  }

  async after(input: { cardId: string; runId: string; chatId: string; purpose: string; status: string }): Promise<string[]> {
    const notices: string[] = []
    if (usedPlaywrightCli(this.database, input.runId)) this.database.db.prepare('UPDATE runs SET used_playwright_cli = 1 WHERE id = ?').run(input.runId)
    const repos = this.worktrees.repositories(input.cardId)
    const failed = repos.filter((repo) => repo.status !== 'active')
    if (failed.length) notices.push(`Repositórios fora desta execução: ${failed.map((repo) => `${basename(repo.repoPath)} (${repo.status === 'failed' ? repo.error ?? 'falhou' : 'pasta sumiu'})`).join('; ')}. O card não pode ir para Done até eles ficarem prontos; a próxima execução tenta preparar de novo.`)
    // S10: HEAD mudou sem passar por agentCommit (`git_commit_agents`), ou a branch foi trocada — alguém rodou Git direto na worktree.
    const before = this.headSnapshots.get(input.cardId); this.headSnapshots.delete(input.cardId)
    if (before) {
      for (const repo of repos.filter((item) => item.status === 'active')) {
        const previous = before.get(repo.path)
        if (!previous) continue
        const current = await headRef(this.git, repo.path)
        if (!current || current === previous) continue
        const [previousBranch, previousHash] = previous.split('@'), [currentBranch, currentHash] = current.split('@')
        const name = basename(repo.repoPath)
        if (previousBranch !== currentBranch) {
          notices.push(`A branch de ${name} mudou de ${previousBranch} para ${currentBranch} durante a execução. Isso não devia acontecer sozinho; confira o que rodou nessa pasta.`)
          try { this.history.recordAlert(input.cardId, { kind: 'tamper', repo: name, reason: 'branch-changed', from: previousBranch, to: currentBranch, runId: input.runId }) } catch { /* aviso continua no chat */ }
          continue
        }
        const commits = await this.git.run(['-C', repo.path, 'log', '--format=%H', `${previousHash}..${currentHash}`]).then((result) => result.stdout.split(/\r?\n/).filter(Boolean), () => [])
        const known = new Set(this.database.db.prepare('SELECT hash FROM git_commit_agents WHERE repo_path = ?').pluck().all(repo.path) as string[])
        const unexpected = commits.filter((hash) => !known.has(hash))
        if (unexpected.length) {
          notices.push(`${name}: ${unexpected.length} commit${unexpected.length === 1 ? '' : 's'} na branch durante a execução que não veio${unexpected.length === 1 ? '' : 'ram'} do pedido de commit do agente. Confira ${unexpected.map((hash) => hash.slice(0, 7)).join(', ')}.`)
          try { this.history.recordAlert(input.cardId, { kind: 'tamper', repo: name, reason: 'unexpected-commit', hashes: unexpected, runId: input.runId }) } catch { /* aviso continua no chat */ }
        }
      }
    }
    const limits = this.harness(input.cardId)
    if (input.purpose === 'execution' && limits?.scopeCheck) {
      const docs = this.database.db.prepare("SELECT content_md FROM card_documents WHERE card_id = ? AND kind IN ('plano', 'tasks', 'resumo')").pluck().all(input.cardId) as string[]
      const changed: string[] = []
      for (const repo of repos.filter((item) => item.status === 'active')) {
        const name = basename(repo.repoPath)
        const status = await this.git.run(['-C', repo.path, 'status', '--porcelain', '--untracked-files=all']).then((result) => result.stdout, () => '')
        const committed = await this.git.run(['-C', repo.path, 'diff', '--name-only', `${repo.baseRef}...HEAD`]).then((result) => result.stdout, () => '')
        const files = new Set([...status.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).split(' -> ').pop()!.trim().replace(/^"|"$/g, '')), ...committed.split(/\r?\n/).filter(Boolean)])
        files.forEach((file) => { if (file === '.specify/feature.json') return; changed.push(repos.length > 1 ? `${name}/${file}` : file) })
      }
      const outside = outOfScope(docs.join('\n'), changed, repos.length > 1 ? repos.map((repo) => basename(repo.repoPath)) : [])
      if (outside.length) {
        const list = outside.slice(0, 15).join(', ') + (outside.length > 15 ? ` e mais ${outside.length - 15}` : '')
        notices.push(`Arquivos alterados fora das áreas citadas no Plano: ${list}. Confira se fazem parte do card; se não, peça ao agente para desfazer ou registre a mudança de escopo.`)
        try { this.history.recordAlert(input.cardId, { kind: 'out-of-scope', files: outside, runId: input.runId }) } catch { /* aviso continua no chat */ }
      }
    }
    return notices
  }
}

/** `branch@hash` do HEAD de um repositório, ou `null` se a pasta não existir mais ou não for um repositório Git válido. */
async function headRef(git: GitRunner, path: string): Promise<string | null> {
  const hash = await git.run(['-C', path, 'rev-parse', 'HEAD']).then((result) => result.stdout.trim(), () => '')
  if (!hash) return null
  const branch = await git.run(['-C', path, 'rev-parse', '--abbrev-ref', 'HEAD']).then((result) => result.stdout.trim(), () => '')
  return `${branch}@${hash}`
}

/** Erro comum das últimas `max` execuções do chat, se todas falharam pelo mesmo motivo. */
export function repeatedFailure(database: AppDatabase, chatId: string, max: number): string | null {
  const rows = database.db.prepare('SELECT status, exit_reason AS reason FROM runs WHERE chat_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?').all(chatId, max) as Array<{ status: string; reason: string | null }>
  if (rows.length < max || rows.some((row) => row.status !== 'failed')) return null
  const reasons = new Set(rows.map((row) => (row.reason ?? '').replace(/\d+/g, '#').slice(0, 300)))
  return reasons.size === 1 ? rows[0]!.reason ?? 'erro sem mensagem' : null
}

/** A execução chamou o Playwright CLI (comando `playwright-cli` em alguma ferramenta)? */
export function usedPlaywrightCli(database: AppDatabase, runId: string): boolean {
  return Boolean(database.db.prepare("SELECT 1 FROM run_events WHERE run_id = ? AND payload_json_sanitized LIKE '%playwright-cli%' LIMIT 1").get(runId))
}

/**
 * Arquivos alterados que não estão em nenhuma área citada nos documentos do card (caminhos como `src/push/` ou `src/app.ts`).
 * Sem nenhum caminho citado, não há como julgar e nada é apontado. Arquivos de lock e de build são ignorados.
 */
export function outOfScope(docs: string, changed: string[], repoNames: string[] = []): string[] {
  const cited = [...docs.matchAll(/(?:^|[\s`'"([])((?:[\w.@-]+\/)+[\w.@*-]*|[\w-]+\.[a-z0-9]{1,6})(?=$|[\s`'"),:;\]])/gim)].map((match) => match[1]!.replace(/\*.*$/, '').replace(/^\.\//, '').toLowerCase())
  if (!cited.length) return []
  const ignore = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|dist\/|out\/|build\/|node_modules\/)/i
  const strip = (file: string): string => { const lower = file.replace(/\\/g, '/').toLowerCase(); const repo = repoNames.find((name) => lower.startsWith(`${name.toLowerCase()}/`)); return repo ? lower.slice(repo.length + 1) : lower }
  return changed.filter((file) => {
    if (ignore.test(file)) return false
    const path = strip(file), full = file.replace(/\\/g, '/').toLowerCase()
    return !cited.some((area) => {
      // Pasta citada vale inteira; arquivo citado vale para os vizinhos só numa pasta específica (src/push/x.ts cobre src/push/, src/app.ts não cobre src/).
      const parent = area.includes('/') ? area.slice(0, area.lastIndexOf('/') + 1) : ''
      const dir = area.endsWith('/') ? area : parent.split('/').filter(Boolean).length >= 2 ? parent : ''
      return path === area || full === area || path.endsWith(`/${area}`) || (dir && (path.startsWith(dir) || full.startsWith(dir) || path.includes(`/${dir}`)))
    })
  })
}
