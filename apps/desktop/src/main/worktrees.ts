import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { GitSnapshot, Worktree } from '@agentboard/contracts'
import type { AppDatabase } from './database'

const exec = promisify(execFile)
export interface GitRunner { run(args: string[]): Promise<{ stdout: string; stderr: string }> }
const nativeGit: GitRunner = { run: (args) => exec('git', args, { timeout: 120_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }) }

export class WorktreeService {
  constructor(private readonly database: AppDatabase, private readonly dataDir: string, private readonly git: GitRunner = nativeGit) {}

  get(cardId: string): Worktree | null {
    const row = this.database.db.prepare(`SELECT id, card_id AS cardId, repo_path AS repoPath, path, branch, base_ref AS baseRef,
      created_at AS createdAt, cleanup_state AS cleanupState FROM worktrees WHERE card_id = ? ORDER BY created_at DESC LIMIT 1`).get(cardId) as Worktree | undefined
    return row ?? null
  }

  async prepare(cardId: string): Promise<Worktree> {
    const existing = this.get(cardId)
    if (existing && await exists(existing.path)) return existing
    if (existing) this.database.db.prepare(`UPDATE worktrees SET cleanup_state = 'missing' WHERE id = ?`).run(existing.id)
    const card = this.database.db.prepare(`SELECT c.title, c.project_id AS projectId, c.base_branch AS baseBranch, p.local_path AS projectPath
      FROM cards c JOIN projects p ON p.id = c.project_id WHERE c.id = ?`).get(cardId) as { title: string; projectId: string; baseBranch: string | null; projectPath: string } | undefined
    if (!card) throw new Error('Card não encontrado')
    let sources = this.database.db.prepare(`SELECT name, local_path AS repoPath, current_branch AS baseRef
      FROM project_sources WHERE project_id = ? AND is_git_repository = 1 ORDER BY sort_order`).all(card.projectId) as Array<{ name: string; repoPath: string; baseRef: string }>
    if (!sources.length) {
      sources = await this.discoverRepositories(card.projectPath)
      const saveSources = this.database.db.transaction(() => {
        const update = this.database.db.prepare('UPDATE project_sources SET name = ?, is_git_repository = 1, current_branch = ? WHERE project_id = ? AND local_path = ?')
        const insert = this.database.db.prepare(`INSERT OR IGNORE INTO project_sources(id, project_id, name, local_path, is_git_repository, current_branch, sort_order)
          VALUES (?, ?, ?, ?, 1, ?, ?)`)
        sources.forEach((source, index) => {
          const changed = update.run(source.name, source.baseRef, card.projectId, source.repoPath).changes
          if (!changed) insert.run(randomUUID(), card.projectId, source.name, source.repoPath, source.baseRef, index + 1)
        })
      })
      saveSources()
    }
    if (!sources.length) throw new Error('Nenhum repositório Git foi encontrado na pasta do projeto nem nas pastas internas. O planejamento continua disponível, mas a execução isolada exige Git.')
    // Caminho curto (wt/<8 letras do card>/<repo>): no Windows o limite de 260 caracteres quebra repositórios com nomes longos (migrations etc.).
    const short = cardId.slice(0, 8), path = join(this.dataDir, 'wt', short)
    await mkdir(path, { recursive: true })
    const slug = plain(card.title).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 36) || 'task'
    // Worktree recriada (pasta apagada) continua na branch que já tinha, mesmo que o nome gerado tenha mudado.
    const branch = existing?.branch ?? `agentboard/${slug}-${short}`
    const members: Array<{ repoPath: string; path: string; baseRef: string }> = []
    for (const [index, source] of sources.entries()) {
      const repoName = plain(source.name).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 24) || `repo-${index + 1}`
      const memberPath = join(path, `${index + 1}-${repoName}`)
      // Branch escolhida ao iniciar: vale nos repositórios que a têm (local ou em origin); nos outros fica a branch atual deles.
      if (card.baseBranch) for (const candidate of [card.baseBranch, `origin/${card.baseBranch}`]) { if (await this.git.run(['-C', source.repoPath, 'rev-parse', '--verify', candidate]).then(() => true, () => false)) { source.baseRef = candidate; break } }
      await this.git.run(['-C', source.repoPath, 'rev-parse', '--verify', source.baseRef])
      await this.releaseStale(source.repoPath, branch, memberPath)
      try {
        try { await this.git.run(['-c', 'core.longpaths=true', '-C', source.repoPath, 'worktree', 'add', '-b', branch, memberPath, source.baseRef]) }
        catch (error) {
          const branches = await this.git.run(['-C', source.repoPath, 'branch', '--list', branch])
          if (!branches.stdout.trim()) throw error
          await this.git.run(['-c', 'core.longpaths=true', '-C', source.repoPath, 'worktree', 'add', memberPath, branch])
        }
      } catch (error) {
        // Uma worktree criada pela metade prende a branch e impede a próxima tentativa: desfaz antes de avisar.
        await this.discard(source.repoPath, memberPath)
        throw new Error(friendlyGitError(error, source.name))
      }
      members.push({ repoPath: source.repoPath, path: memberPath, baseRef: source.baseRef })
    }
    const first = sources[0]!
    const worktree: Worktree = { id: randomUUID(), cardId, repoPath: card.projectPath, path, branch, baseRef: first.baseRef, createdAt: new Date().toISOString(), cleanupState: 'active' }
    const save = this.database.db.transaction(() => {
      this.database.db.prepare(`INSERT INTO worktrees(id, card_id, repo_path, path, branch, base_ref, created_at, cleanup_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(worktree.id, worktree.cardId, worktree.repoPath, worktree.path, worktree.branch, worktree.baseRef, worktree.createdAt, worktree.cleanupState)
      const insertMember = this.database.db.prepare('INSERT INTO worktree_members(id, worktree_id, repo_path, path, base_ref) VALUES (?, ?, ?, ?, ?)')
      members.forEach((member) => insertMember.run(randomUUID(), worktree.id, member.repoPath, member.path, member.baseRef))
    })
    save()
    return worktree
  }

  async snapshot(cardId: string): Promise<GitSnapshot> {
    const worktree = this.get(cardId)
    if (!worktree) throw new Error('Worktree ainda não foi criada')
    if (!await exists(worktree.path)) {
      this.database.db.prepare(`UPDATE worktrees SET cleanup_state = 'missing' WHERE id = ?`).run(worktree.id)
      return { worktreeId: worktree.id, status: '', diff: '', exists: false }
    }
    const members = this.database.db.prepare('SELECT repo_path AS repoPath, path, base_ref AS baseRef FROM worktree_members WHERE worktree_id = ? ORDER BY path').all(worktree.id) as Array<{ repoPath: string; path: string; baseRef: string }>
    const targets = members.length ? members : [{ repoPath: worktree.repoPath, path: worktree.path, baseRef: worktree.baseRef }]
    const snapshots = await Promise.all(targets.map(async (member) => {
      const [status, diff] = await Promise.all([
        this.git.run(['-C', member.path, 'status', '--short', '--branch']),
        this.git.run(['-C', member.path, 'diff', '--no-ext-diff', '--binary', member.baseRef, '--'])
      ])
      return { heading: `\n## ${member.repoPath}\n`, status: status.stdout, diff: diff.stdout }
    }))
    return { worktreeId: worktree.id, status: snapshots.map((item) => `${item.heading}${item.status}`).join(''), diff: snapshots.map((item) => `${item.heading}${item.diff}`).join(''), exists: true }
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

/** Tira acentos ("Botão" → "Botao") antes de virar nome de branch ou pasta. */
const plain = (text: string): string => text.normalize('NFKD').replace(/[̀-ͯ]/g, '')

function friendlyGitError(error: unknown, repo: string): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/Filename too long/i.test(text)) return `Não foi possível criar a worktree de ${repo}: o Windows recusou nomes de arquivo longos demais. Ative caminhos longos no Git (git config --global core.longpaths true) e tente de novo.`
  const detail = text.split(/\r?\n/).find((line) => /^(fatal|error):/.test(line.trim()))?.trim()
  return `Não foi possível criar a worktree de ${repo}${detail ? `: ${detail}` : ''}`
}

async function exists(path: string): Promise<boolean> { return stat(path).then((value) => value.isDirectory(), () => false) }
