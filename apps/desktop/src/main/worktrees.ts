import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { withErrorCode, type GitSnapshot, type Worktree } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import { tm } from './i18n'

const exec = promisify(execFile)
export interface GitRunner { run(args: string[]): Promise<{ stdout: string; stderr: string }> }
export const nativeGit: GitRunner = { run: (args) => exec('git', args, { timeout: 120_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }) }

export class WorktreeService {
  constructor(private readonly database: AppDatabase, private readonly dataDir: string, private readonly git: GitRunner = nativeGit) {}

  /** Dono da worktree que o card usa: ele mesmo, ou o card cuja worktree ele pegou emprestada (`link`). */
  ownerOf(cardId: string): string {
    const linked = this.database.db.prepare(`SELECT o.id FROM cards c JOIN cards o ON o.id = c.worktree_card_id WHERE c.id = ?`).pluck().get(cardId) as string | undefined
    return linked ?? cardId
  }

  get(cardId: string): Worktree | null {
    const row = this.database.db.prepare(`SELECT id, card_id AS cardId, repo_path AS repoPath, path, branch, base_ref AS baseRef,
      created_at AS createdAt, cleanup_state AS cleanupState FROM worktrees WHERE card_id = ? ORDER BY created_at DESC LIMIT 1`).get(this.ownerOf(cardId)) as Worktree | undefined
    return row ?? null
  }

  /** Cards do mesmo projeto com worktree ativa que este card pode usar (não inclui ele mesmo nem cards que também usam a de outro). */
  candidates(cardId: string): Array<{ cardId: string; title: string; branch: string; path: string }> {
    return this.database.db.prepare(`SELECT c.id AS cardId, c.title, w.branch, w.path FROM cards c JOIN worktrees w ON w.card_id = c.id
      WHERE c.project_id = (SELECT project_id FROM cards WHERE id = ?) AND c.id != ? AND c.worktree_card_id IS NULL AND w.cleanup_state = 'active'
        AND w.id = (SELECT id FROM worktrees x WHERE x.card_id = c.id ORDER BY x.created_at DESC LIMIT 1) ORDER BY c.updated_at DESC`).all(cardId, cardId) as Array<{ cardId: string; title: string; branch: string; path: string }>
  }

  /** Faz o card usar a worktree de outro (ou volta a ter a própria com `null`). Só enxerga e trabalha lá: limpeza e merge continuam do dono. */
  link(cardId: string, fromCardId: string | null): void {
    if (fromCardId === null) { this.database.db.prepare('UPDATE cards SET worktree_card_id = NULL WHERE id = ?').run(cardId); return }
    if (fromCardId === cardId) throw new Error(tm().worktrees.cardCannotUseOwn)
    if (!this.candidates(cardId).some((item) => item.cardId === fromCardId)) throw new Error(tm().worktrees.otherCardNoWorktree)
    const own = this.database.db.prepare(`SELECT 1 FROM worktrees WHERE card_id = ? AND cleanup_state = 'active' LIMIT 1`).get(cardId)
    if (own) throw new Error(tm().worktrees.cardHasOwnWorktree)
    this.database.db.prepare('UPDATE cards SET worktree_card_id = ? WHERE id = ?').run(fromCardId, cardId)
  }

  /** Se o arquivo está dentro da worktree de outro card (e este card ainda não a usa), devolve quem é o dono. */
  foreignOwner(cardId: string, filePath: string): { cardId: string; title: string } | null {
    const normal = (value: string): string => value.split(String.fromCharCode(92)).join('/').toLowerCase()
    const target = normal(filePath), mine = this.ownerOf(cardId)
    const rows = this.database.db.prepare(`SELECT c.id AS cardId, c.title, w.path FROM worktrees w JOIN cards c ON c.id = w.card_id
      WHERE c.project_id = (SELECT project_id FROM cards WHERE id = ?) AND c.id != ? AND w.cleanup_state = 'active'`).all(cardId, mine) as Array<{ cardId: string; title: string; path: string }>
    const hit = rows.find((row) => { const base = normal(row.path).replace(/\/+$/, ''); return target === base || target.startsWith(`${base}/`) })
    return hit ? { cardId: hit.cardId, title: hit.title } : null
  }

  /**
   * Worktree composta do card: uma pasta por repositório envolvido (`cards.repo_ids`; vazio = todos do projeto, como antes), todas na
   * mesma branch. Falha num repositório não desfaz os outros: ele fica `failed` com o erro e a próxima preparação tenta de novo.
   * Repositório que entra no card depois (o agente descobriu que precisa) ganha a sua pasta na worktree que já existe.
   */
  async prepare(cardId: string): Promise<Worktree> {
    const owner = this.ownerOf(cardId)
    if (owner !== cardId) return this.prepare(owner)
    // Duas runs do mesmo card não podem disputar o `worktree add`: a segunda espera a primeira e reaproveita o resultado.
    const running = this.preparing.get(cardId)
    const next = (running ?? Promise.resolve()).catch(() => undefined).then(() => this.prepareNow(cardId))
    this.preparing.set(cardId, next)
    try { return await next } finally { if (this.preparing.get(cardId) === next) this.preparing.delete(cardId) }
  }
  private readonly preparing = new Map<string, Promise<Worktree>>()

  private async prepareNow(cardId: string): Promise<Worktree> {
    const existing = this.get(cardId)
    const alive = existing && await exists(existing.path) ? existing : null
    if (existing && !alive) this.database.db.prepare(`UPDATE worktrees SET cleanup_state = 'missing' WHERE id = ?`).run(existing.id)
    const card = this.database.db.prepare(`SELECT c.title, c.project_id AS projectId, c.base_branch AS baseBranch, c.repo_ids AS repoIds, p.local_path AS projectPath
      FROM cards c JOIN projects p ON p.id = c.project_id WHERE c.id = ?`).get(cardId) as { title: string; projectId: string; baseBranch: string | null; repoIds: string | null; projectPath: string } | undefined
    if (!card) throw new Error(tm().common.cardNotFound)
    const all = await this.gitSources(card.projectId, card.projectPath)
    if (!all.length) throw new Error(tm().worktrees.noGitRepoFound)
    const wanted = card.repoIds ? JSON.parse(card.repoIds) as string[] : null
    const sources = wanted?.length ? all.filter((source) => wanted.includes(source.id)) : all
    if (!sources.length) throw new Error(tm().worktrees.chosenReposGone)
    // Caminho curto (wt/<8 letras do card>/<repo>): no Windows o limite de 260 caracteres quebra repositórios com nomes longos (migrations etc.).
    const short = cardId.slice(0, 8), path = alive?.path ?? join(this.dataDir, 'wt', short)
    await mkdir(path, { recursive: true })
    const slug = plain(card.title).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 36) || 'task'
    // Worktree recriada (pasta apagada) continua na branch que já tinha, mesmo que o nome gerado tenha mudado.
    const branch = existing?.branch ?? `agentboard/${slug}-${short}`
    const current = alive ? this.members(alive.id) : []
    const todo = sources.filter((source) => !current.some((member) => same(member.repoPath, source.repoPath) && member.status === 'active' && existsSync(member.path)))
    if (alive && !todo.length) return alive
    const results: Array<{ repoPath: string; path: string; baseRef: string; error: string | null }> = []
    for (const source of todo) {
      const index = all.findIndex((item) => item.id === source.id)
      const memberPath = current.find((member) => same(member.repoPath, source.repoPath))?.path ?? join(path, `${index + 1}-${memberName(source.name, index)}`)
      results.push(await this.addMember(source, card.baseBranch, branch, memberPath))
    }
    const ok = results.filter((item) => !item.error)
    if (!alive && !ok.length) throw new Error(results.map((item) => item.error).join('\n'))
    const first = sources[0]!
    const worktree: Worktree = alive ?? { id: randomUUID(), cardId, repoPath: card.projectPath, path, branch, baseRef: ok[0]?.baseRef ?? first.baseRef, createdAt: new Date().toISOString(), cleanupState: 'active' }
    this.database.db.transaction(() => {
      if (!alive) this.database.db.prepare(`INSERT INTO worktrees(id, card_id, repo_path, path, branch, base_ref, created_at, cleanup_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(worktree.id, worktree.cardId, worktree.repoPath, worktree.path, worktree.branch, worktree.baseRef, worktree.createdAt, worktree.cleanupState)
      const upsert = this.database.db.prepare(`INSERT INTO worktree_members(id, worktree_id, repo_path, path, base_ref, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(worktree_id, repo_path) DO UPDATE SET path = excluded.path, base_ref = excluded.base_ref, status = excluded.status, error = excluded.error`)
      results.forEach((item) => upsert.run(randomUUID(), worktree.id, item.repoPath, item.path, item.baseRef, item.error ? 'failed' : 'active', item.error))
    })()
    return worktree
  }

  /** Cria (ou confirma) a pasta de um repositório na worktree, na branch do card; nunca lança — o erro vai no campo `error`. */
  private async addMember(source: { repoPath: string; name: string; baseRef: string }, cardBaseBranch: string | null, branch: string, memberPath: string): Promise<{ repoPath: string; path: string; baseRef: string; error: string | null }> {
    let baseRef = source.baseRef
    try {
      // Branch escolhida ao iniciar: vale nos repositórios que a têm (local ou em origin); nos outros fica a branch atual deles.
      if (cardBaseBranch) for (const candidate of [cardBaseBranch, `origin/${cardBaseBranch}`]) { if (await this.git.run(['-C', source.repoPath, 'rev-parse', '--verify', candidate]).then(() => true, () => false)) { baseRef = candidate; break } }
      await this.git.run(['-C', source.repoPath, 'rev-parse', '--verify', baseRef])
      await this.releaseStale(source.repoPath, branch, memberPath)
      try {
        try { await this.git.run(['-c', 'core.longpaths=true', '-C', source.repoPath, 'worktree', 'add', '-b', branch, memberPath, baseRef]) }
        catch (error) {
          const branches = await this.git.run(['-C', source.repoPath, 'branch', '--list', branch])
          if (!branches.stdout.trim()) throw error
          // Branch que já existe: com commits próprios (trabalho de uma worktree apagada) é reaproveitada como está; sem nenhum commit que a base
          // não tenha, só estaria parada num ponto velho, então é recriada em cima da base de agora.
          const unique = Number((await this.git.run(['-C', source.repoPath, 'rev-list', '--count', `${baseRef}..${branch}`])).stdout.trim()) || 0
          await this.git.run(['-c', 'core.longpaths=true', '-C', source.repoPath, 'worktree', 'add', ...(unique === 0 ? ['-B', branch, memberPath, baseRef] : [memberPath, branch])])
        }
      } catch (error) {
        // Uma worktree criada pela metade prende a branch e impede a próxima tentativa: desfaz antes de avisar.
        await this.discard(source.repoPath, memberPath)
        throw error
      }
      return { repoPath: source.repoPath, path: memberPath, baseRef, error: null }
    } catch (error) {
      return { repoPath: source.repoPath, path: memberPath, baseRef, error: friendlyGitError(error, source.name) }
    }
  }

  private readonly ensuring = new Map<string, Promise<unknown>>()
  /**
   * G07 — garante que um repositório específico está na worktree composta do card, mesmo fora de `cards.repo_ids` (ex.: o
   * repositório do SDD, que só entra no primeiro write). Idempotente: repositório já membro e ativo não é recriado. Não
   * recria os outros membros existentes. Duas chamadas concorrentes para o mesmo card+repositório são serializadas (a
   * segunda reaproveita o resultado da primeira), então nunca disputam a mesma pasta/branch no Git.
   */
  async ensureMember(cardId: string, sourceId: string): Promise<{ repoPath: string; path: string; baseRef: string; status: 'active' | 'failed'; error: string | null }> {
    const owner = this.ownerOf(cardId)
    const key = `${owner}:${sourceId}`
    const prior = this.ensuring.get(key) ?? Promise.resolve()
    const next = prior.catch(() => undefined).then(() => this.ensureMemberNow(owner, sourceId))
    this.ensuring.set(key, next)
    try { return await next } finally { if (this.ensuring.get(key) === next) this.ensuring.delete(key) }
  }

  private async ensureMemberNow(owner: string, sourceId: string): Promise<{ repoPath: string; path: string; baseRef: string; status: 'active' | 'failed'; error: string | null }> {
    const worktree = await this.prepare(owner)
    const source = this.database.db.prepare('SELECT name, local_path AS repoPath, current_branch AS baseRef FROM project_sources WHERE id = ?').get(sourceId) as { name: string; repoPath: string; baseRef: string } | undefined
    if (!source) throw new Error(tm().common.repoNotFoundInProject)
    const current = this.members(worktree.id)
    const existing = current.find((member) => same(member.repoPath, source.repoPath))
    if (existing && existing.status === 'active' && existsSync(existing.path)) return existing
    const card = this.database.db.prepare('SELECT base_branch AS baseBranch FROM cards WHERE id = ?').get(owner) as { baseBranch: string | null }
    const memberPath = existing?.path ?? join(worktree.path, `${current.length + 1}-${memberName(source.name, current.length)}`)
    const result = await this.addMember(source, card.baseBranch, worktree.branch, memberPath)
    this.database.db.prepare(`INSERT INTO worktree_members(id, worktree_id, repo_path, path, base_ref, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(worktree_id, repo_path) DO UPDATE SET path = excluded.path, base_ref = excluded.base_ref, status = excluded.status, error = excluded.error`)
      .run(randomUUID(), worktree.id, result.repoPath, result.path, result.baseRef, result.error ? 'failed' : 'active', result.error)
    return { ...result, status: result.error ? 'failed' : 'active' }
  }

  /** Estado de cada repositório da worktree do card: `active` (pasta pronta), `failed` (com o erro) ou `missing` (pasta sumiu). */
  repositories(cardId: string): Array<{ repoPath: string; path: string; baseRef: string; status: 'active' | 'failed' | 'missing'; error: string | null; prUrl: string | null }> {
    const worktree = this.get(cardId)
    if (!worktree) return []
    return this.members(worktree.id).map((member) => ({ ...member, status: member.status === 'active' && !existsSync(member.path) ? 'missing' : member.status }))
  }

  private members(worktreeId: string): Array<{ repoPath: string; path: string; baseRef: string; status: 'active' | 'failed'; error: string | null; prUrl: string | null }> {
    return this.database.db.prepare('SELECT repo_path AS repoPath, path, base_ref AS baseRef, status, error, pr_url AS prUrl FROM worktree_members WHERE worktree_id = ? ORDER BY path').all(worktreeId) as Array<{ repoPath: string; path: string; baseRef: string; status: 'active' | 'failed'; error: string | null; prUrl: string | null }>
  }

  /** Repositórios Git do projeto; sem cadastro, procura na pasta do projeto e grava o que achou. */
  private async gitSources(projectId: string, projectPath: string): Promise<Array<{ id: string; name: string; repoPath: string; baseRef: string }>> {
    const read = (): Array<{ id: string; name: string; repoPath: string; baseRef: string }> => this.database.db.prepare(`SELECT id, name, local_path AS repoPath, current_branch AS baseRef
      FROM project_sources WHERE project_id = ? AND is_git_repository = 1 ORDER BY sort_order`).all(projectId) as Array<{ id: string; name: string; repoPath: string; baseRef: string }>
    const saved = read()
    if (saved.length) return saved
    const found = await this.discoverRepositories(projectPath)
    this.database.db.transaction(() => {
      const update = this.database.db.prepare('UPDATE project_sources SET name = ?, is_git_repository = 1, current_branch = ? WHERE project_id = ? AND local_path = ?')
      const insert = this.database.db.prepare(`INSERT OR IGNORE INTO project_sources(id, project_id, name, local_path, is_git_repository, current_branch, sort_order)
        VALUES (?, ?, ?, ?, 1, ?, ?)`)
      found.forEach((source, index) => {
        const changed = update.run(source.name, source.baseRef, projectId, source.repoPath).changes
        if (!changed) insert.run(randomUUID(), projectId, source.name, source.repoPath, source.baseRef, index + 1)
      })
    })()
    return read()
  }

  async snapshot(cardId: string): Promise<GitSnapshot> {
    const worktree = this.get(cardId)
    if (!worktree) throw new Error(withErrorCode('no-worktree', tm().worktrees.notCreatedYet))
    if (!await exists(worktree.path)) {
      this.database.db.prepare(`UPDATE worktrees SET cleanup_state = 'missing' WHERE id = ?`).run(worktree.id)
      return { worktreeId: worktree.id, status: '', diff: '', exists: false }
    }
    const members = this.database.db.prepare(`SELECT repo_path AS repoPath, path, base_ref AS baseRef FROM worktree_members WHERE worktree_id = ? AND status = 'active' ORDER BY path`).all(worktree.id) as Array<{ repoPath: string; path: string; baseRef: string }>
    const targets: typeof members = []
    for (const member of members) {
      const state = await directoryState(member.path)
      if (state !== 'missing') { targets.push(member); continue }
      // A pasta foi apagada fora do AgentBoard: remove tanto o vínculo órfão do Git quanto o registro local.
      // Falhas de permissão não entram aqui e continuam visíveis ao usuário, pois podem ser temporárias.
      await this.git.run(['-C', member.repoPath, 'worktree', 'prune']).catch(() => undefined)
      this.database.db.prepare('DELETE FROM worktree_members WHERE worktree_id = ? AND path = ?').run(worktree.id, member.path)
    }
    if (members.length && !targets.length) {
      this.database.db.prepare(`UPDATE worktrees SET cleanup_state = 'missing' WHERE id = ?`).run(worktree.id)
      return { worktreeId: worktree.id, status: '', diff: '', exists: false }
    }
    if (!members.length) targets.push({ repoPath: worktree.repoPath, path: worktree.path, baseRef: worktree.baseRef })
    const snapshots = await Promise.all(targets.map(async (member) => {
      // O que o card mudou é contado a partir do ponto em que a branch saiu da base (merge-base), não da ponta atual da base:
      // senão tudo o que a base ganhou depois (ou tem a mais) apareceria como se o card tivesse apagado.
      const since = await this.mergeBase(member)
      const [status, diff] = await Promise.all([
        this.git.run(['-C', member.path, 'status', '--short', '--branch']),
        this.git.run(['-C', member.path, 'diff', '--no-ext-diff', '--binary', since, '--'])
      ])
      // A raiz real da worktree acompanha cada trecho: a tela de alterações precisa dela para abrir caminhos relativos
      // corretamente quando o card usa mais de um repositório.
      return { heading: `\n### AgentBoard root: ${member.path}\n`, status: status.stdout, diff: diff.stdout }
    }))
    return { worktreeId: worktree.id, status: snapshots.map((item) => `${item.heading}${item.status}`).join(''), diff: snapshots.map((item) => `${item.heading}${item.diff}`).join(''), exists: true }
  }

  /** Ponto de saída do card no repositório (merge-base com a base; sem ele, a própria base): o "antes" de tudo o que o card mudou. */
  private mergeBase(member: { path: string; baseRef: string }): Promise<string> {
    return this.git.run(['-C', member.path, 'merge-base', member.baseRef, 'HEAD']).then((result) => result.stdout.trim() || member.baseRef, () => member.baseRef)
  }

  /** Referência "antes" de um repositório da worktree do card (pasta `repoPath` da worktree); `null` se a pasta não é de nenhum membro. */
  async baseFor(cardId: string, repoPath: string): Promise<{ ref: string; label: string } | null> {
    const worktree = this.get(cardId)
    if (!worktree) return null
    const member = this.members(worktree.id).find((item) => item.status === 'active' && same(item.path, repoPath))
    return member ? { ref: await this.mergeBase(member), label: tm().worktrees.cardStartingPoint(member.baseRef) } : null
  }

  /** Solta a branch de worktrees antigas do AgentBoard que ficaram quebradas (pasta apagada ou criação interrompida). */
  private async releaseStale(repoPath: string, branch: string, target: string): Promise<void> {
    await this.git.run(['-C', repoPath, 'worktree', 'prune']).catch(() => undefined)
    const list = await this.git.run(['-C', repoPath, 'worktree', 'list', '--porcelain']).catch(() => ({ stdout: '' }))
    // Caminho real nos dois lados: o Git devolve o nome longo e o Windows pode entregar o curto (FRANCI~1).
    const real = async (path: string): Promise<string> => (await realpath(path).catch(() => resolve(path))).toLowerCase()
    const ours = await real(this.dataDir), wanted = await real(target)
    for (const block of list.stdout.split(/\r?\n\r?\n/)) {
      const path = /^worktree (.+)$/m.exec(block)?.[1]?.trim(), ref = /^branch (.+)$/m.exec(block)?.[1]?.trim()
      if (!path) continue
      const found = await real(path)
      if ((ref !== `refs/heads/${branch}` && found !== wanted) || !found.startsWith(ours)) continue
      if (await exists(path) && this.database.db.prepare(`SELECT 1 FROM worktree_members WHERE path = ?`).get(path)) continue
      await this.discard(repoPath, path)
    }
  }

  private async discard(repoPath: string, path: string): Promise<void> {
    await this.git.run(['-C', repoPath, 'worktree', 'remove', '--force', path]).catch(() => undefined)
    await rm(path, { recursive: true, force: true }).catch(() => undefined)
    await this.git.run(['-C', repoPath, 'worktree', 'prune']).catch(() => undefined)
  }

  private async discoverRepositories(projectPath: string): Promise<Array<{ name: string; repoPath: string; baseRef: string }>> {
    const inspect = async (path: string): Promise<{ name: string; repoPath: string; baseRef: string } | null> => {
      try {
        const root = resolve((await this.git.run(['-C', path, 'rev-parse', '--show-toplevel'])).stdout.trim())
        const branch = (await this.git.run(['-C', root, 'branch', '--show-current'])).stdout.trim()
        return branch ? { name: basename(root), repoPath: root, baseRef: branch } : null
      } catch { return null }
    }
    const direct = await inspect(projectPath)
    if (direct) return [direct]
    const children = await readdir(projectPath, { withFileTypes: true })
    const found = await Promise.all(children.filter((entry) => entry.isDirectory() && entry.name !== '.git').map((entry) => inspect(join(projectPath, entry.name))))
    return found.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  }
}

/** Mesmo caminho, sem diferenciar maiúsculas (Windows). */
const same = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()

/** Tira acentos ("Botão" → "Botao") antes de virar nome de branch ou pasta. */
const plain = (text: string): string => text.normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Nome da pasta do repositório dentro da worktree composta (curto, sem acento nem caractere especial). */
const memberName = (name: string, index: number): string => plain(name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 24) || `repo-${index + 1}`

function friendlyGitError(error: unknown, repo: string): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/Filename too long/i.test(text)) return tm().worktrees.longPaths(repo)
  const detail = text.split(/\r?\n/).find((line) => /^(fatal|error):/.test(line.trim()))?.trim()
  return tm().worktrees.createFailed(repo, detail)
}

async function exists(path: string): Promise<boolean> { return stat(path).then((value) => value.isDirectory(), () => false) }

/** Distingue pasta removida de acesso temporariamente negado; só o primeiro caso autoriza apagar o registro. */
async function directoryState(path: string): Promise<'available' | 'missing' | 'unavailable'> {
  try { return (await stat(path)).isDirectory() ? 'available' : 'missing' }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR' ? 'missing' : 'unavailable' }
}
