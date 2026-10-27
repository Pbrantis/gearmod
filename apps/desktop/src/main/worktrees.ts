import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { GitSnapshot, Worktree } from '@agentboard/contracts'
import type { AppDatabase } from './database'

const exec = promisify(execFile)
export interface GitRunner { run(args: string[]): Promise<{ stdout: string; stderr: string }> }
export const nativeGit: GitRunner = { run: (args) => exec('git', args, { timeout: 120_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }) }

export class WorktreeService {
  constructor(private readonly database: AppDatabase, private readonly dataDir: string, private readonly git: GitRunner = nativeGit) {}

  get(cardId: string): Worktree | null {
    const row = this.database.db.prepare(`SELECT id, card_id AS cardId, repo_path AS repoPath, path, branch, base_ref AS baseRef,
      created_at AS createdAt, cleanup_state AS cleanupState FROM worktrees WHERE card_id = ? ORDER BY created_at DESC LIMIT 1`).get(cardId) as Worktree | undefined
    return row ?? null
  }

  /**
   * Worktree composta do card: uma pasta por repositório envolvido (`cards.repo_ids`; vazio = todos do projeto, como antes), todas na
   * mesma branch. Falha num repositório não desfaz os outros: ele fica `failed` com o erro e a próxima preparação tenta de novo.
   * Repositório que entra no card depois (o agente descobriu que precisa) ganha a sua pasta na worktree que já existe.
   */
  async prepare(cardId: string): Promise<Worktree> {
    const existing = this.get(cardId)
    const alive = existing && await exists(existing.path) ? existing : null
    if (existing && !alive) this.database.db.prepare(`UPDATE worktrees SET cleanup_state = 'missing' WHERE id = ?`).run(existing.id)
    const card = this.database.db.prepare(`SELECT c.title, c.project_id AS projectId, c.base_branch AS baseBranch, c.repo_ids AS repoIds, p.local_path AS projectPath
      FROM cards c JOIN projects p ON p.id = c.project_id WHERE c.id = ?`).get(cardId) as { title: string; projectId: string; baseBranch: string | null; repoIds: string | null; projectPath: string } | undefined
    if (!card) throw new Error('Card não encontrado')
    const all = await this.gitSources(card.projectId, card.projectPath)
    if (!all.length) throw new Error('Nenhum repositório Git foi encontrado na pasta do projeto nem nas pastas internas. O planejamento continua disponível, mas a execução isolada exige Git.')
    const wanted = card.repoIds ? JSON.parse(card.repoIds) as string[] : null
    const sources = wanted?.length ? all.filter((source) => wanted.includes(source.id)) : all
    if (!sources.length) throw new Error('Os repositórios escolhidos para este card não existem mais no projeto. Escolha de novo no card.')
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
      const repoName = plain(source.name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 24) || `repo-${index + 1}`
      const memberPath = current.find((member) => same(member.repoPath, source.repoPath))?.path ?? join(path, `${index + 1}-${repoName}`)
      let baseRef = source.baseRef
      try {
        // Branch escolhida ao iniciar: vale nos repositórios que a têm (local ou em origin); nos outros fica a branch atual deles.
        if (card.baseBranch) for (const candidate of [card.baseBranch, `origin/${card.baseBranch}`]) { if (await this.git.run(['-C', source.repoPath, 'rev-parse', '--verify', candidate]).then(() => true, () => false)) { baseRef = candidate; break } }
        await this.git.run(['-C', source.repoPath, 'rev-parse', '--verify', baseRef])
        await this.releaseStale(source.repoPath, branch, memberPath)
        try {
          try { await this.git.run(['-c', 'core.longpaths=true', '-C', source.repoPath, 'worktree', 'add', '-b', branch, memberPath, baseRef]) }
          catch (error) {
            const branches = await this.git.run(['-C', source.repoPath, 'branch', '--list', branch])
            if (!branches.stdout.trim()) throw error
            await this.git.run(['-c', 'core.longpaths=true', '-C', source.repoPath, 'worktree', 'add', memberPath, branch])
          }
        } catch (error) {
          // Uma worktree criada pela metade prende a branch e impede a próxima tentativa: desfaz antes de avisar.
          await this.discard(source.repoPath, memberPath)
          throw error
        }
        results.push({ repoPath: source.repoPath, path: memberPath, baseRef, error: null })
      } catch (error) {
        results.push({ repoPath: source.repoPath, path: memberPath, baseRef, error: friendlyGitError(error, source.name) })
      }
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
    if (!worktree) throw new Error('Worktree ainda não foi criada')
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
    return member ? { ref: await this.mergeBase(member), label: `${member.baseRef} (ponto de saída do card)` } : null
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

function friendlyGitError(error: unknown, repo: string): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/Filename too long/i.test(text)) return `Não foi possível criar a worktree de ${repo}: o Windows recusou nomes de arquivo longos demais. Ative caminhos longos no Git (git config --global core.longpaths true) e tente de novo.`
  const detail = text.split(/\r?\n/).find((line) => /^(fatal|error):/.test(line.trim()))?.trim()
  return `Não foi possível criar a worktree de ${repo}${detail ? `: ${detail}` : ''}`
}

async function exists(path: string): Promise<boolean> { return stat(path).then((value) => value.isDirectory(), () => false) }

/** Distingue pasta removida de acesso temporariamente negado; só o primeiro caso autoriza apagar o registro. */
async function directoryState(path: string): Promise<'available' | 'missing' | 'unavailable'> {
  try { return (await stat(path)).isDirectory() ? 'available' : 'missing' }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR' ? 'missing' : 'unavailable' }
}
