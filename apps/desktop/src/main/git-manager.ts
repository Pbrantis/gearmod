import { randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { scanForSecrets } from './secret-scan'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { defaultGitPolicy, withErrorCode, gitPolicySchema, type GitCard, type GitChange, type GitChanges, type GitCommitFile, type GitGraph, type GitPolicy, type GitRef, type GitRepo, type GitRequest, type GitRow, type GitRule, type GitWorktreeInfo } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import { nativeGit, type GitRunner } from './worktrees'
import { ApprovalService } from './approvals'
import { tm } from './i18n'
import { entryLabel, sameState, UndoJournal, undoActions, type DiscardFile, type GitState, type UndoCtx, type UndoEntry, type UndoKind } from './git-undo'

interface Source { id: string; projectId: string; name: string; path: string }
interface Member { cardId: string; title: string; branch: string; path: string; repoPath: string; baseRef: string; status: 'active' | 'failed'; error: string | null; prUrl: string | null }
/** Roda um programa de linha de comando (gh, glab) numa pasta; nos testes é trocado por um falso. */
export interface CliRunner { run(command: string, args: string[], cwd: string): Promise<string> }
const execCli = promisify(execFile)
export const nativeCli: CliRunner = { run: async (command, args, cwd) => (await execCli(command, args, { cwd, timeout: 120_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } })).stdout }
interface Target { dir: string; branch: string | null; baseRef: string | null }
interface RequestRow { id: string; cardId: string; sourceId: string; repoName: string; message: string; files: string; status: GitRequest['status']; profileId: string | null; hash: string | null; error: string | null; createdAt: string; approvalId: string | null }

/** Tamanho máximo das cópias de um descarte (mais que isso, o descarte funciona mas não se desfaz). */
const maxDiscardBackup = 100 * 1024 * 1024
const same = (a: string, b: string): boolean => (process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b))
/** Mesma pasta, resolvendo atalhos e nomes curtos do Windows (C:\Users\NOME~1) antes de comparar. */
const real = (path: string): string => { try { return realpathSync.native(path) } catch { return resolve(path) } }
const sameDir = (a: string, b: string): boolean => (process.platform === 'win32' ? real(a).toLowerCase() === real(b).toLowerCase() : real(a) === real(b))
const existsSyncDir = (path: string): boolean => { try { return statSync(path).isDirectory() } catch { return false } }
const isDir = (path: string): Promise<boolean> => stat(path).then((value) => value.isDirectory(), () => false)

/** Atribui a faixa (coluna) de cada linha do grafo. As linhas vêm em ordem topológica: filhos antes dos pais. */
export function assignLanes(rows: ReadonlyArray<{ hash: string; parents: readonly string[] }>): number[] {
  const lanes: Array<string | null> = [], result: number[] = []
  const free = (): number => { const at = lanes.indexOf(null); if (at >= 0) return at; lanes.push(null); return lanes.length - 1 }
  for (const row of rows) {
    let lane = lanes.indexOf(row.hash)
    if (lane < 0) lane = free()
    // Outras faixas que esperavam este commit terminam aqui: a linha delas desce até ele.
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === row.hash) lanes[i] = null
    result.push(lane)
    row.parents.forEach((parent, index) => {
      const waiting = lanes.indexOf(parent)
      // Primeiro pai já esperado por outra faixa: a faixa mais à esquerda fica com ele, assim a história principal não "pula" de coluna.
      if (waiting >= 0) { if (index === 0 && waiting > lane) { lanes[waiting] = null; lanes[lane] = parent } return }
      if (index === 0) lanes[lane] = parent
      else lanes[free()] = parent
    })
  }
  return result
}

const globToRegExp = (pattern: string): RegExp => new RegExp(`^${pattern.trim().replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')}$`)

/** Regra de commit do agente para uma branch: a primeira exceção que bater vence; senão vale o padrão do projeto. */
export function resolveRule(policy: GitPolicy, branch: string): { rule: GitRule; why: string } {
  const found = policy.rules.find((item) => item.pattern.trim() && globToRegExp(item.pattern).test(branch))
  return found ? { rule: found.rule, why: tm().git.branchException(found.pattern.trim()) } : { rule: policy.def, why: tm().git.projectDefault }
}

/** Mensagem curta em português para os erros mais comuns do Git. */
export function friendlyError(error: unknown): string {
  const text = [(error as { stderr?: string })?.stderr, error instanceof Error ? error.message : String(error)].filter(Boolean).join('\n')
  if (/Please tell me who you are|unable to auto-detect email|empty ident/i.test(text)) return tm().git.gitIdentityMissing
  if (/nothing (added )?to commit|no changes added/i.test(text)) return tm().git.friendlyNothingStaged
  if (/Authentication failed|could not read Username|Permission denied \(publickey\)|terminal prompts disabled/i.test(text)) return tm().git.gitAuthFailed
  if (/non-fast-forward|\[rejected\]|fetch first|failed to push some refs/i.test(text)) return withErrorCode('git-push-rejected', tm().git.pushRejected)
  const busy = /'([^']+)' is already (?:used by worktree|checked out) at '([^']+)'/i.exec(text)
  if (busy) return tm().git.branchOpenElsewhere(busy[1]!, busy[2]!)
  if (/Not possible to fast-forward|divergent branches/i.test(text)) return tm().git.cannotFastForward
  if (/no upstream|has no upstream branch/i.test(text)) return tm().git.branchNotPublished
  if (/not a git repository/i.test(text)) return tm().git.notAGitRepo
  const used = /cannot delete branch '([^']+)' (?:used by|checked out at) (?:worktree at )?'([^']+)'/i.exec(text)
  if (used) return tm().git.branchUsedByWorktree(used[1]!, used[2]!)
  const unmerged = /The branch '([^']+)' is not fully merged/i.exec(text)
  if (unmerged) return tm().git.branchNotMerged(unmerged[1]!)
  const detail = text.split(/\r?\n/).map((line) => line.trim()).find((line) => /^(fatal|error):/i.test(line))
  return detail ? detail.replace(/^(fatal|error):\s*/i, '') : text.trim().split(/\r?\n/)[0] || tm().git.gitOperationFailed
}

/**
 * Revisões dos commits que são só do card: o que a branch dele tem e nenhuma outra branch (local ou remota) tem, nem a origem.
 * Não basta `origem..branch`: se a branch for rebaseada sobre outra (ex.: main) ou a origem gravada ficar velha, entrariam commits alheios.
 */
export const cardRevs = (branch: string, baseRef: string, tip = branch): string[] =>
  // Antes de --branches/--remotes, o --exclude é comparado sem o prefixo refs/heads/ ou refs/remotes/.
  [tip, '--not', baseRef, `--exclude=${branch}`, '--branches', `--exclude=*/${branch}`, '--exclude=*/HEAD', '--remotes']

const statusOf = (code: string): 'M' | 'A' | 'D' => (code === 'A' || code === '?' ? 'A' : code === 'D' ? 'D' : 'M')
const splitMessage = (message: string): { subject: string; body: string } => { const [subject = '', ...rest] = message.trim().split(/\r?\n/); return { subject: subject.trim(), body: rest.join('\n').trim() } }

/** Gerenciador Git do projeto: grafo, status, commit, sincronização e a regra de commit do agente. Só usa o `git` instalado. */
/** Operação que deixou conflitos; `stash` = apply/pop de stash (sem arquivo de estado no .git). */
export type ConflictOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'stash'

export class GitManager {
  private readonly approvals: ApprovalService
  constructor(private readonly database: AppDatabase, private readonly git: GitRunner = nativeGit, private readonly cli: CliRunner = nativeCli, approvals?: ApprovalService, private readonly trashItem?: (path: string) => Promise<void>, private readonly backupDir?: string) {
    this.approvals = approvals ?? new ApprovalService(database)
  }

  /** Chamado depois que uma pasta de worktree some (o índice de código para de observá-la). */
  onFolderRemoved?: (path: string) => void

  private async run(dir: string, args: string[]): Promise<string> {
    try { return (await this.git.run(['-c', 'core.quotepath=false', '-C', dir, ...args])).stdout } catch (error) { throw new Error(friendlyError(error)) }
  }
  private async tryRun(dir: string, args: string[]): Promise<string | null> {
    try { return (await this.git.run(['-c', 'core.quotepath=false', '-C', dir, ...args])).stdout } catch { return null }
  }

  // ---------- desfazer e refazer (só o que o usuário faz na tela de Git; fica na memória) ----------
  private readonly undo = new UndoJournal()
  private readonly swept = new Set<string>()
  private backupsSwept = false
  private readonly locks = new Map<string, Promise<unknown>>()
  private keyOf(sourceId: string, cardId: string | null | undefined): string { return `${sourceId}:${cardId ?? ''}` }

  /** HEAD e branch da pasta (HEAD nulo em repositório sem commit; branch nula com HEAD solto). */
  private async state(dir: string): Promise<GitState> {
    return { head: (await this.tryRun(dir, ['rev-parse', '-q', '--verify', 'HEAD']))?.trim() || null, branch: (await this.tryRun(dir, ['symbolic-ref', '-q', '--short', 'HEAD']))?.trim() || null }
  }

  /** Prende os hashes em `refs/agentboard/undo/<id>-<n>` para o `git gc` não levar o que o refazer ainda usa. Devolve as refs criadas. */
  private async pin(dir: string, id: string, hashes: string[]): Promise<string[]> {
    const refs: string[] = []
    for (const hash of new Set(hashes)) { const ref = `refs/agentboard/undo/${id}-${refs.length}`; if (await this.tryRun(dir, ['update-ref', ref, hash]) !== null) refs.push(ref) }
    return refs
  }

  private async dropBackup(id: string): Promise<void> { if (this.backupDir) await rm(join(this.backupDir, id), { recursive: true, force: true }).catch(() => undefined) }

  /** Solta o que as entradas seguravam: as refs e a pasta de cópias de arquivos. */
  private async release(entries: UndoEntry[]): Promise<void> {
    for (const entry of entries) {
      for (const ref of entry.pins) await this.tryRun(entry.dir, ['update-ref', '-d', ref])
      await this.dropBackup(entry.id)
    }
  }

  /** Ação que não se desfaz (push, pull, merge, rebase…): as entradas antigas não conseguiriam mais conferir a pasta. */
  private async forget(key: string): Promise<void> { await this.release(this.undo.clear(key)) }

  /** Grava na pilha uma ação que acabou de dar certo. Nunca falha: se não der para gravar, a ação só deixa de ser desfazível. */
  private async record(key: string, dir: string, kind: UndoKind, before: GitState, data: Record<string, unknown> = {}, extraPins: Array<string | null> = [], id: string = randomUUID()): Promise<void> {
    try {
      const after = await this.state(dir)
      if (kind === 'checkout' && sameState(before, after)) return
      const pins = await this.pin(dir, id, [before.head, after.head, ...extraPins].filter((hash): hash is string => Boolean(hash)))
      await this.release(this.undo.push(key, { id, kind, at: new Date().toISOString(), before, after, dir, pins, data }))
    } catch { await this.forget(key); await this.dropBackup(id) }
  }

  /** Uma desfazer/refazer por vez em cada pasta (Ctrl+Z repetido não pode atropelar o anterior). */
  private exclusive<T>(key: string, job: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(job)
    const tail = run.then(() => undefined, () => undefined)
    this.locks.set(key, tail)
    void tail.then(() => { if (this.locks.get(key) === tail) this.locks.delete(key) })
    return run
  }

  private undoCtx(sourceId: string, cardId: string | null, dir: string, entry: UndoEntry): UndoCtx {
    return { dir, entry, run: (args) => this.run(dir, args), tryRun: (args) => this.tryRun(dir, args), backupDir: this.backupDir, inside: (path) => this.inside(sourceId, cardId, path), discard: (paths) => this.discardPaths(sourceId, cardId, dir, paths) }
  }

  /** O que dá para desfazer e refazer agora nessa pasta. Entrada que ficou velha (alguém mexeu na pasta por fora) sai da pilha, para o botão não prometer o que não dá. */
  async undoState(sourceId: string, cardId: string | null): Promise<{ undo: { label: string } | null; redo: { label: string } | null }> {
    const key = this.keyOf(sourceId, cardId), source = this.source(sourceId)
    let dir: string
    try { dir = (await this.target(source, cardId)).dir } catch { return { undo: null, redo: null } }
    if (!(await this.conflictState(dir)).operation) {
      const now = await this.state(dir)
      for (let top = this.undo.peekUndo(key); top && !sameState(now, top.after); top = this.undo.peekUndo(key)) await this.release(this.undo.drop(key, top.id))
      for (let top = this.undo.peekRedo(key); top && !sameState(now, top.before); top = this.undo.peekRedo(key)) await this.release(this.undo.drop(key, top.id))
    }
    const undo = this.undo.peekUndo(key), redo = this.undo.peekRedo(key)
    return { undo: undo ? { label: entryLabel(undo.kind, undo.data) } : null, redo: redo ? { label: entryLabel(redo.kind, redo.data) } : null }
  }

  async undoLast(sourceId: string, cardId: string | null): Promise<{ output: string }> { return this.undoStep(sourceId, cardId, false) }
  async redoLast(sourceId: string, cardId: string | null): Promise<{ output: string }> { return this.undoStep(sourceId, cardId, true) }

  private undoStep(sourceId: string, cardId: string | null, redo: boolean): Promise<{ output: string }> {
    const key = this.keyOf(sourceId, cardId)
    return this.exclusive(key, async () => {
      const dir = (await this.busyTarget(this.source(sourceId), cardId)).dir, entry = redo ? this.undo.peekRedo(key) : this.undo.peekUndo(key)
      if (!entry) throw new Error(redo ? tm().git.redoNothing : tm().git.undoNothing)
      if ((await this.conflictState(dir)).operation) throw new Error(tm().git.undoFinishFirst)
      // Só mexe se a pasta continua como a ação (ou o desfazer) deixou; senão a entrada sai da pilha.
      if (!sameState(await this.state(dir), redo ? entry.before : entry.after)) { await this.release(this.undo.drop(key, entry.id)); throw new Error(tm().git.undoRepoChanged(redo)) }
      const note = await undoActions[entry.kind][redo ? 'redo' : 'undo'](this.undoCtx(sourceId, cardId, dir, entry))
      if (redo) this.undo.moveToDone(key); else this.undo.moveToUndone(key)
      const label = entryLabel(entry.kind, entry.data)
      return { output: [redo ? tm().git.redone(label) : tm().git.undone(label), note].filter(Boolean).join(' ') }
    })
  }

  /** Ao abrir o app: apaga as refs e as cópias que a sessão anterior deixou (o que a sessão atual ainda usa fica). */
  private async sweep(source: Source): Promise<void> {
    if (this.swept.has(source.id)) return
    this.swept.add(source.id)
    const live = this.undo.all()
    const held = new Set(live.flatMap((entry) => entry.pins))
    for (const ref of ((await this.tryRun(source.path, ['for-each-ref', '--format=%(refname)', 'refs/agentboard/undo'])) ?? '').split(/\r?\n/).filter(Boolean)) if (!held.has(ref)) await this.tryRun(source.path, ['update-ref', '-d', ref])
    if (this.backupDir && !this.backupsSwept) {
      this.backupsSwept = true
      const keep = new Set(live.map((entry) => entry.id))
      for (const name of await readdir(this.backupDir).catch(() => [] as string[])) if (!keep.has(name)) await rm(join(this.backupDir, name), { recursive: true, force: true }).catch(() => undefined)
    }
  }

  // ---------- repositórios e contexto ----------
  private source(sourceId: string): Source {
    const row = this.database.db.prepare('SELECT id, project_id AS projectId, name, local_path AS path FROM project_sources WHERE id = ?').get(sourceId) as Source | undefined
    if (!row) throw new Error(tm().common.repoNotFoundInProject)
    return row
  }

  private members(projectId: string, cardId?: string): Member[] {
    return this.database.db.prepare(`SELECT w.card_id AS cardId, c.title, w.branch, m.path, m.repo_path AS repoPath, m.base_ref AS baseRef, m.status, m.error, m.pr_url AS prUrl
      FROM worktrees w JOIN worktree_members m ON m.worktree_id = w.id JOIN cards c ON c.id = w.card_id
      WHERE c.project_id = ? AND w.cleanup_state != 'removed' AND w.id = (SELECT id FROM worktrees x WHERE x.card_id = w.card_id ORDER BY x.created_at DESC LIMIT 1) ${cardId ? 'AND w.card_id = ?' : ''}
      ORDER BY c.title, m.path`).all(...(cardId ? [projectId, cardId] : [projectId])) as Member[]
  }

  /** Como `target`, para quem altera arquivos: com um card, recusa enquanto um agente roda nessa pasta (D1). */
  private async busyTarget(source: Source, cardId: string | null): Promise<Target> {
    const target = await this.target(source, cardId)
    if (cardId) this.assertIdle(source.id, target.dir)
    return target
  }

  private async target(source: Source, cardId: string | null): Promise<Target> {
    if (!cardId) return { dir: source.path, branch: null, baseRef: null }
    const member = this.members(source.projectId, cardId).find((item) => same(item.repoPath, source.path))
    if (!member || !await isDir(member.path)) throw new Error(tm().git.worktreeMissingInRepo)
    return { dir: member.path, branch: member.branch, baseRef: member.baseRef }
  }

  async repos(projectId: string): Promise<GitRepo[]> {
    const sources = this.database.db.prepare(`SELECT id, project_id AS projectId, name, local_path AS path FROM project_sources WHERE project_id = ? AND is_git_repository = 1 ORDER BY sort_order`).all(projectId) as Source[]
    for (const source of sources) await this.sweep(source)
    return Promise.all(sources.map(async (source) => ({
      sourceId: source.id, name: source.name, path: source.path,
      head: (await this.tryRun(source.path, ['branch', '--show-current']))?.trim() || null,
      hasRemote: Boolean((await this.tryRun(source.path, ['remote']))?.trim())
    })))
  }

  // ---------- descoberta e configuração do Git ----------
  /** Repositório (raiz e branch) da pasta, ou null se ela não está dentro de um repositório Git. */
  private async repositoryAt(dir: string): Promise<{ root: string; branch: string } | null> {
    const root = (await this.tryRun(dir, ['rev-parse', '--show-toplevel']))?.trim()
    if (!root) return null
    const branch = (await this.tryRun(root, ['branch', '--show-current']))?.trim() || (await this.tryRun(root, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() || 'main'
    return { root: resolve(root), branch }
  }

  /**
   * Procura repositórios nas pastas do projeto (a própria pasta e as filhas diretas), inclusive os criados ou configurados por fora
   * depois do cadastro, e acerta o cadastro: o que virou repositório passa a valer como tal e o que deixou de ser é desmarcado.
   */
  async detect(projectId: string): Promise<{ repos: GitRepo[]; changed: boolean }> {
    const rows = this.database.db.prepare('SELECT id, project_id AS projectId, name, local_path AS path, is_git_repository AS git, current_branch AS branch FROM project_sources WHERE project_id = ? ORDER BY sort_order').all(projectId) as Array<Source & { git: number; branch: string | null }>
    const project = this.database.db.prepare('SELECT local_path AS path FROM projects WHERE id = ?').get(projectId) as { path: string } | undefined
    if (!project) throw new Error(tm().common.projectNotFound)
    const found = new Map<string, { root: string; branch: string }>()
    const look = async (dir: string): Promise<void> => {
      if (!await isDir(dir)) return
      const direct = await this.repositoryAt(dir)
      if (direct) { found.set(real(direct.root).toLowerCase(), direct); return }
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue
        const child = await this.repositoryAt(join(dir, entry.name))
        if (child && sameDir(child.root, join(dir, entry.name))) found.set(real(child.root).toLowerCase(), child)
      }
    }
    await look(project.path)
    for (const row of rows) if (!sameDir(row.path, project.path)) await look(row.path)
    let changed = false
    this.database.db.transaction(() => {
      const mark = this.database.db.prepare('UPDATE project_sources SET is_git_repository = ?, current_branch = ? WHERE id = ?')
      const add = this.database.db.prepare('INSERT OR IGNORE INTO project_sources(id, project_id, name, local_path, is_git_repository, current_branch, sort_order) VALUES (?, ?, ?, ?, 1, ?, ?)')
      for (const row of rows) {
        const repo = [...found.values()].find((item) => sameDir(item.root, row.path))
        if (repo && (!row.git || row.branch !== repo.branch)) { mark.run(1, repo.branch, row.id); changed = true }
        else if (!repo && row.git && existsSyncDir(row.path)) { mark.run(0, null, row.id); changed = true }
      }
      let order = rows.length
      for (const repo of found.values()) if (!rows.some((row) => sameDir(row.path, repo.root))) { add.run(randomUUID(), projectId, basename(repo.root), repo.root, repo.branch, order++); changed = true }
    })()
    return { repos: await this.repos(projectId), changed }
  }

  /** Pastas do projeto que ainda não são repositório: onde o Git pode ser adicionado. */
  setupTargets(projectId: string): Array<{ sourceId: string; name: string; path: string }> {
    return this.database.db.prepare('SELECT id AS sourceId, name, local_path AS path FROM project_sources WHERE project_id = ? AND is_git_repository = 0 ORDER BY sort_order').all(projectId) as Array<{ sourceId: string; name: string; path: string }>
  }

  /** Inicia o Git na pasta (sem mexer nos arquivos dela) ou vincula uma origin SSH/HTTPS; cria o repositório se a pasta ainda não tem. */
  async setup(input: { projectId: string; sourceId: string; mode: 'init' | 'origin'; url?: string | undefined }): Promise<GitRepo[]> {
    const source = this.source(input.sourceId)
    if (source.projectId !== input.projectId) throw new Error(tm().git.folderNotInProject)
    if (!await isDir(source.path)) throw new Error(tm().git.projectFolderGone)
    const url = (input.url ?? '').trim()
    if (input.mode === 'origin') {
      if (!/^(https?:\/\/[^\s/]+\/\S+|ssh:\/\/[^\s/]+\/\S+|[\w.-]+@[\w.-]+:\S+)$/.test(url) || url.startsWith('-')) throw new Error(tm().git.invalidRemoteUrl)
    }
    let repo = await this.repositoryAt(source.path)
    if (repo && !sameDir(repo.root, source.path)) throw new Error(tm().git.folderInsideOtherRepo)
    if (!repo) {
      await this.run(source.path, ['init', '-b', 'main']).catch(() => this.run(source.path, ['init']))
      repo = await this.repositoryAt(source.path)
    }
    if (input.mode === 'origin') {
      const current = (await this.tryRun(source.path, ['remote', 'get-url', 'origin']))?.trim()
      await this.run(source.path, current ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url])
    }
    this.database.db.prepare('UPDATE project_sources SET is_git_repository = 1, current_branch = ? WHERE id = ?').run(repo?.branch ?? 'main', source.id)
    return this.repos(input.projectId)
  }

  // ---------- regra de commit ----------
  policy(projectId: string): GitPolicy {
    const row = this.database.db.prepare('SELECT git_policy AS policy FROM projects WHERE id = ?').get(projectId) as { policy: string | null } | undefined
    if (!row) throw new Error(tm().common.projectNotFound)
    if (!row.policy) return structuredClone(defaultGitPolicy)
    try { const parsed = gitPolicySchema.safeParse(JSON.parse(row.policy)); if (parsed.success) return parsed.data } catch { /* JSON ruim: volta ao padrão */ }
    return structuredClone(defaultGitPolicy)
  }

  setPolicy(projectId: string, policy: GitPolicy): GitPolicy {
    const clean = gitPolicySchema.parse({ def: policy.def, rules: policy.rules.map((item) => ({ pattern: item.pattern.trim(), rule: item.rule })).filter((item) => item.pattern) })
    if (!this.database.db.prepare('UPDATE projects SET git_policy = ? WHERE id = ?').run(JSON.stringify(clean), projectId).changes) throw new Error(tm().common.projectNotFound)
    return clean
  }

  ruleFor(projectId: string, branch: string): { rule: GitRule; why: string } { return resolveRule(this.policy(projectId), branch) }

  /** Frase para o contexto do agente de implementação: o que ele pode fazer quanto a commit nesta branch. */
  agentRule(cardId: string): string | null {
    const card = this.database.db.prepare('SELECT project_id AS projectId FROM cards WHERE id = ?').get(cardId) as { projectId: string } | undefined
    const wt = this.latestWorktree(cardId)
    if (!card || !wt) return null
    const { rule } = this.ruleFor(card.projectId, wt.branch)
    if (rule === 'never') return `Do not commit on this branch (${wt.branch}): leave the changes in the worktree, the user does the committing. Do not run git commit.`
    if (rule === 'auto') return 'When you close each task, commit with the agentboard_pedir_commit tool (short message in the language given in `idioma`, imperative mood). Do not run git commit directly.'
    return 'To commit, ask with the agentboard_pedir_commit tool (message and files): the user authorizes it on the card. Do not run git commit directly.'
  }

  private latestWorktree(cardId: string): { id: string; branch: string } | undefined {
    return this.database.db.prepare(`SELECT id, branch FROM worktrees WHERE card_id = COALESCE((SELECT worktree_card_id FROM cards WHERE id = ?), ?) AND cleanup_state != 'removed' ORDER BY created_at DESC LIMIT 1`).get(cardId, cardId) as { id: string; branch: string } | undefined
  }

  // ---------- grafo ----------
  async graph(projectId: string, sourceId: string, limit = 300, cardId?: string | null): Promise<GitGraph> {
    const source = this.source(sourceId)
    if (source.projectId !== projectId) throw new Error(tm().common.repoNotFoundInProject)
    const dir = (await this.target(source, cardId ?? null)).dir
    const baseRepo = (await this.repos(projectId)).find((item) => item.sourceId === sourceId)!
    const head = (await this.tryRun(dir, ['branch', '--show-current']))?.trim() || null
    const repo = { ...baseRepo, path: dir, head }
    const members = this.members(projectId).filter((item) => same(item.repoPath, source.path))
    const present = await Promise.all(members.map((member) => isDir(member.path)))
    const live = members.filter((_, index) => present[index])
    const [log, refsOut, stashOut] = await Promise.all([
      this.tryRun(dir, ['log', '--branches', '--remotes', '--tags', 'HEAD', '--topo-order', '-n', String(limit + 1), '--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%D']),
      this.tryRun(dir, ['for-each-ref', '--format=%(refname)%1f%(upstream:track)', 'refs/heads', 'refs/remotes']),
      this.tryRun(dir, ['stash', 'list', '--format=%gd%x1f%gs%x1f%H%x1f%P%x1f%aI'])
    ])
    const locals = new Set<string>(), remotes = new Set<string>()
    const tracking = new Map<string, { ahead: number; behind: number }>()
    for (const line of (refsOut ?? '').split(/\r?\n/).filter(Boolean)) {
      const [ref = '', track = ''] = line.split('\x1f')
      if (ref.startsWith('refs/heads/')) {
        locals.add(ref.slice(11))
        tracking.set(ref.slice(11), { ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0) })
      }
      else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) remotes.add(ref.slice(13))
    }
    // Commits de cada card: tudo que a branch dele tem além da base.
    const cardOf = new Map<string, string>()
    await Promise.all(live.map(async (member) => {
      if (!locals.has(member.branch)) return
      const out = await this.tryRun(dir, ['rev-list', ...cardRevs(member.branch, member.baseRef)])
      for (const hash of (out ?? '').split(/\r?\n/).filter(Boolean)) if (!cardOf.has(hash)) cardOf.set(hash, member.cardId)
    }))
    const agents = new Map((this.database.db.prepare('SELECT hash, profile_id AS profileId FROM git_commit_agents WHERE repo_path = ?').all(source.path) as Array<{ hash: string; profileId: string }>).map((item) => [item.hash, item.profileId]))
    const records = (log ?? '').split('\x1e').filter((item) => item.trim())
    const commits: GitRow[] = records.slice(0, limit).map((record) => {
      const [hash = '', parents = '', author = '', email = '', date = '', subject = '', decoration = ''] = record.replace(/^\n/, '').split('\x1f')
      const refs: GitRef[] = []
      for (const raw of decoration.trim().split(', ').map((item) => item.trim()).filter(Boolean)) {
        if (raw.startsWith('HEAD -> ')) refs.push({ name: raw.slice(8), kind: 'head' })
        else if (raw === 'HEAD') continue
        else if (raw.startsWith('tag: ')) refs.push({ name: raw.slice(5), kind: 'tag' })
        else if (remotes.has(raw)) refs.push({ name: raw, kind: 'remote' })
        else if (!raw.endsWith('/HEAD')) refs.push({ name: raw, kind: 'local' })
      }
      return { hash, short: hash.slice(0, 7), parents: parents.split(' ').filter(Boolean), lane: 0, author, email, date: new Date(date).toISOString(), subject, refs, cardId: cardOf.get(hash) ?? null, agentProfileId: agents.get(hash) ?? null, wip: null }
    })
    // Alterações sem commit: pasta principal e cada worktree de card.
    const places: Array<{ cardId: string | null; dir: string; branch: string | null }> = [{ cardId: null, dir: source.path, branch: null }, ...live.map((member) => ({ cardId: member.cardId, dir: member.path, branch: member.branch }))]
    const wips = (await Promise.all(places.map(async (place): Promise<GitRow | null> => {
      const files = await this.listChanges(place.dir).catch(() => [] as GitChange[])
      if (!files.length) return null
      const kinds = new Map<string, GitChange['status']>()
      for (const file of files) { const before = kinds.get(file.path); kinds.set(file.path, before === 'D' || file.status === 'D' ? 'D' : before === 'A' || file.status === 'A' ? 'A' : 'M') }
      const count = (status: string): number => [...kinds.values()].filter((item) => item === status).length
      const head = (await this.tryRun(place.dir, ['rev-parse', '--verify', '-q', 'HEAD']))?.trim()
      const branch = place.branch ?? (await this.tryRun(place.dir, ['branch', '--show-current']))?.trim() ?? ''
      return { hash: `wip:${place.cardId ?? 'main'}`, short: '', parents: head ? [head] : [], lane: 0, author: '', email: '', date: null, subject: '', refs: [], cardId: place.cardId, agentProfileId: null, wip: { modified: count('M'), added: count('A'), deleted: count('D'), staged: files.filter((file) => file.staged).length, branch } }
    }))).filter((item): item is GitRow => Boolean(item))
    const stashEntries = (stashOut ?? '').split(/\r?\n/).filter(Boolean).map((line) => { const [ref = '', message = '', commit = '', parents = '', date = ''] = line.split('\x1f'); return { ref, message, commit, parent: parents.split(' ')[0] ?? '', date } })
    const stashRows: GitRow[] = stashEntries.filter((item) => item.commit && item.parent).map((item) => ({ hash: `stash:${item.commit}:${item.ref}`, short: item.commit.slice(0, 7), parents: [item.parent], lane: 0, author: '', email: '', date: item.date ? new Date(item.date).toISOString() : null, subject: item.message, refs: [], cardId: cardOf.get(item.parent) ?? null, agentProfileId: null, wip: null, stash: { ref: item.ref, commit: item.commit } }))
    const byParent = new Map<string, GitRow[]>()
    for (const stash of stashRows) { const parent = stash.parents[0]!; byParent.set(parent, [...(byParent.get(parent) ?? []), stash]) }
    const visible = new Set(commits.map((commit) => commit.hash))
    const rows = [...wips, ...stashRows.filter((row) => !visible.has(row.parents[0]!)), ...commits.flatMap((commit) => [...(byParent.get(commit.hash) ?? []), commit])]
    assignLanes(rows).forEach((lane, index) => { rows[index]!.lane = lane })
    // A pasta da worktree pode estar em outra branch que a registrada (o usuário ou o agente fez checkout lá): vale a que está aberta de fato.
    const opened = await Promise.all(live.map(async (member) => (await this.tryRun(member.path, ['branch', '--show-current']))?.trim() ?? ''))
    const cardByBranch = new Map<string, string>()
    live.forEach((member, index) => { cardByBranch.set(member.branch, member.cardId); if (opened[index]) cardByBranch.set(opened[index]!, member.cardId) })
    return {
      repo, rows, truncated: records.length > limit,
      branches: {
        local: [...locals].sort().map((name) => ({ name, cardId: cardByBranch.get(name) ?? null, head: name === repo.head, ahead: tracking.get(name)?.ahead ?? 0, behind: tracking.get(name)?.behind ?? 0 })),
        remote: [...remotes].sort().map((name) => ({ name, cardId: cardByBranch.get(name.replace(/^[^/]+\//, '')) ?? null }))
      },
      worktrees: live.map((member, index) => ({ cardId: member.cardId, title: member.title, branch: opened[index] || member.branch, path: member.path })),
      stashes: stashEntries.map(({ ref, message }) => ({ ref, message }))
    }
  }

  async commitDetail(sourceId: string, hash: string): Promise<{ body: string; files: GitCommitFile[] }> {
    const dir = this.source(sourceId).path
    if (!/^[0-9a-f]{7,64}$/.test(hash)) throw new Error(tm().git.invalidCommit)
    const [body, parentsOut] = await Promise.all([this.run(dir, ['show', '-s', '--format=%B', hash]), this.run(dir, ['rev-list', '--parents', '-n', '1', hash])])
    const parent = parentsOut.trim().split(' ')[1]
    const [names, nums] = await Promise.all([
      parent ? this.run(dir, ['diff', '--name-status', '-z', '--no-renames', parent, hash]) : this.run(dir, ['diff-tree', '--root', '-r', '--no-commit-id', '--name-status', '-z', '--no-renames', hash]),
      parent ? this.run(dir, ['diff', '--numstat', '-z', '--no-renames', parent, hash]) : this.run(dir, ['diff-tree', '--root', '-r', '--no-commit-id', '--numstat', '-z', '--no-renames', hash])
    ])
    const counts = parseNumstat(nums), parts = names.split('\0').filter(Boolean), files: GitCommitFile[] = []
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const path = parts[i + 1]!, found = counts.get(path)
      files.push({ path, status: statusOf(parts[i]!.charAt(0)), additions: found?.[0] ?? 0, deletions: found?.[1] ?? 0 })
    }
    return { body: body.trim(), files }
  }

  // ---------- alterações da pasta de trabalho ----------
  private async listChanges(dir: string): Promise<GitChange[]> {
    const [status, unstaged, staged] = await Promise.all([
      this.run(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']),
      this.tryRun(dir, ['diff', '--numstat', '-z', '--no-renames']),
      this.tryRun(dir, ['diff', '--cached', '--numstat', '-z', '--no-renames'])
    ])
    const unstagedStats = parseNumstat(unstaged ?? ''), stagedStats = parseNumstat(staged ?? '')
    const files: GitChange[] = []
    for (const entry of status.split('\0').filter(Boolean)) {
      const x = entry.charAt(0), y = entry.charAt(1), path = entry.slice(3)
      if (x === '?' && y === '?') { files.push({ path, status: 'A', staged: false, additions: await countLines(join(dir, path)), deletions: 0 }); continue }
      if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) { files.push({ path, status: 'M', staged: false, additions: 0, deletions: 0 }); continue }
      if (x !== ' ') files.push({ path, status: statusOf(x), staged: true, additions: stagedStats.get(path)?.[0] ?? 0, deletions: stagedStats.get(path)?.[1] ?? 0 })
      if (y !== ' ') files.push({ path, status: statusOf(y), staged: false, additions: unstagedStats.get(path)?.[0] ?? 0, deletions: unstagedStats.get(path)?.[1] ?? 0 })
    }
    return files.sort((a, b) => a.path.localeCompare(b.path))
  }

  async changes(sourceId: string, cardId: string | null): Promise<GitChanges> {
    const target = await this.target(this.source(sourceId), cardId)
    const [files, current, last] = await Promise.all([this.listChanges(target.dir), target.branch ?? this.tryRun(target.dir, ['branch', '--show-current']), this.tryRun(target.dir, ['log', '-1', '--format=%s'])])
    return { branch: typeof current === 'string' ? current.trim() || null : current, files, lastMessage: (last ?? '').trim() }
  }

  /** Diff de um arquivo dentro de um commit já feito (contra o pai; no primeiro commit, contra o vazio). */
  async commitDiff(sourceId: string, hash: string, path: string): Promise<string> {
    if (!/^[0-9a-f]{7,64}$/.test(hash)) throw new Error(tm().git.invalidCommit)
    const out = await this.run(this.source(sourceId).path, ['show', '--format=', '--no-ext-diff', '--no-renames', '--first-parent', hash, '--', path])
    return out.slice(0, 400_000)
  }

  async diff(sourceId: string, cardId: string | null, path: string, staged: boolean): Promise<string> {
    const target = await this.target(this.source(sourceId), cardId)
    const out = await this.run(target.dir, ['diff', ...(staged ? ['--cached'] : []), '--no-ext-diff', '--', path])
    if (out.trim() || staged) return out.slice(0, 400_000)
    if (await this.tryRun(target.dir, ['ls-files', '--error-unmatch', '--', path]) !== null) return ''
    // fixo em português: o parseDiff do renderer (gitDiff.tsx) depende do prefixo 'Arquivo novo: '
    const text = await readFile(join(target.dir, path), 'utf8').catch(() => '')
    return `Arquivo novo: ${path}\n${text.slice(0, 200_000).split(/\r?\n/).map((line) => `+${line}`).join('\n')}`
  }

  /** Caminho do arquivo dentro da pasta de trabalho (worktree do card ou repositório); nada fora dela. */
  private async inside(sourceId: string, cardId: string | null, path: string): Promise<string> {
    const target = await this.target(this.source(sourceId), cardId), full = resolve(target.dir, path), rel = relative(target.dir, full)
    if (!path.trim() || !rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(tm().git.fileOutsideProject)
    return full
  }

  /** Texto atual do arquivo, para editar na mão. */
  async readFileText(sourceId: string, cardId: string | null, path: string): Promise<string> {
    const full = await this.inside(sourceId, cardId, path)
    if ((await stat(full)).size > 2_000_000) throw new Error(tm().git.fileTooLargeToEdit)
    const buffer = await readFile(full)
    if (buffer.subarray(0, 8000).includes(0)) throw new Error(tm().git.binaryNotEditableHere)
    return buffer.toString('utf8')
  }

  /** Caminho absoluto, na worktree do card ou no repositório, para abrir o arquivo no editor. */
  async filePath(sourceId: string, cardId: string | null, path: string): Promise<{ projectId: string; path: string }> { return { projectId: this.source(sourceId).projectId, path: await this.inside(sourceId, cardId, path) } }

  async writeFileText(sourceId: string, cardId: string | null, path: string, content: string): Promise<void> {
    if (cardId) this.assertIdle(sourceId, (await this.target(this.source(sourceId), cardId)).dir)
    await writeFile(await this.inside(sourceId, cardId, path), content, 'utf8')
  }

  async stage(sourceId: string, cardId: string | null, paths: string[], stage: boolean): Promise<GitChanges> {
    const target = await this.target(this.source(sourceId), cardId)
    const scope = paths.length ? paths : ['.']
    for (let i = 0; i < scope.length; i += 200) {
      const chunk = scope.slice(i, i + 200)
      if (stage) await this.run(target.dir, ['add', '-A', '--', ...chunk])
      else if (await this.tryRun(target.dir, ['restore', '--staged', '--', ...chunk]) === null) await this.run(target.dir, ['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', ...chunk])
    }
    return this.changes(sourceId, cardId)
  }

  async discardUnstaged(sourceId: string, cardId: string | null, paths: string[]): Promise<GitChanges> {
    const target = await this.busyTarget(this.source(sourceId), cardId)
    const available = new Set((await this.listChanges(target.dir)).filter((file) => !file.staged).map((file) => file.path))
    for (const path of paths) {
      if (!available.has(path)) throw new Error(tm().git.noUnstagedChangesFor(path))
      await this.inside(sourceId, cardId, path)
    }
    // A cópia do desfazer sai ANTES de descartar (depois, o arquivo novo já estaria na Lixeira). Sem pasta de cópias, o descarte não se desfaz.
    const key = this.keyOf(sourceId, cardId), id = randomUUID(), before = await this.state(target.dir)
    const files = await this.backupForDiscard(sourceId, cardId, target.dir, id, paths)
    try { await this.discardPaths(sourceId, cardId, target.dir, paths) } catch (error) { await this.dropBackup(id); throw error }
    if (files) await this.record(key, target.dir, 'discard', before, { files }, [], id); else await this.forget(key)
    return this.changes(sourceId, cardId)
  }

  private async discardPaths(sourceId: string, cardId: string | null, dir: string, paths: string[]): Promise<void> {
    for (const path of paths) {
      const literal = `:(literal)${path}`
      if (await this.tryRun(dir, ['ls-files', '--error-unmatch', '--', literal]) !== null) await this.run(dir, ['restore', '--worktree', '--', literal])
      else {
        // Arquivo novo não existe no Git: vai para a Lixeira do sistema (quando o app a oferece), não é apagado de vez.
        const file = await this.inside(sourceId, cardId, path)
        if (this.trashItem) await this.trashItem(file); else await unlink(file)
      }
    }
  }

  /** Copia os arquivos que serão descartados para `<backupDir>/<id>/files/<n>` e anota como cada um deve ficar depois (`afterHash`). `null` = sem cópia (sem pasta, grande demais ou erro). */
  private async backupForDiscard(sourceId: string, cardId: string | null, dir: string, id: string, paths: string[]): Promise<DiscardFile[] | null> {
    if (!this.backupDir) return null
    try {
      await mkdir(join(this.backupDir, id, 'files'), { recursive: true })
      const files: DiscardFile[] = []
      let total = 0
      for (const [index, path] of paths.entries()) {
        const full = await this.inside(sourceId, cardId, path), literal = `:(literal)${path}`, info = await stat(full).catch(() => null)
        const tracked = await this.tryRun(dir, ['ls-files', '--error-unmatch', '--', literal]) !== null
        let backup: string | null = null
        if (info) {
          total += info.size
          if (!info.isFile() || total > maxDiscardBackup) throw new Error('backup')
          backup = `files/${index}`
          await copyFile(full, join(this.backupDir, id, backup))
        }
        // Rastreado volta ao que está no índice; arquivo novo deixa de existir.
        const afterHash = tracked ? (await this.tryRun(dir, ['ls-files', '-s', '--', literal]))?.trim().split(/\s+/)[1] ?? null : null
        if (tracked && !afterHash) throw new Error('backup')
        files.push({ path, tracked, backup, afterHash })
      }
      return files
    } catch { await this.dropBackup(id); return null }
  }

  async stashFile(sourceId: string, cardId: string | null, path: string): Promise<GitChanges> {
    const target = await this.busyTarget(this.source(sourceId), cardId)
    await this.inside(sourceId, cardId, path)
    if (!(await this.listChanges(target.dir)).some((file) => file.path === path)) throw new Error(tm().git.fileHasNoChanges)
    const before = await this.state(target.dir)
    await this.run(target.dir, ['stash', 'push', '--include-untracked', '--', `:(literal)${path}`])
    await this.recordStash(this.keyOf(sourceId, cardId), target.dir, before, [path])
    return this.changes(sourceId, cardId)
  }

  /** Grava o stash que acabou de ser criado (o `stash@{0}`); `paths` = só esses arquivos, para o refazer guardar os mesmos. */
  private async recordStash(key: string, dir: string, before: GitState, paths?: string[]): Promise<void> {
    const hash = (await this.tryRun(dir, ['rev-parse', '-q', '--verify', 'stash@{0}']))?.trim()
    if (hash) await this.record(key, dir, 'stash', before, { hash, ...(paths ? { paths } : {}) }, [hash]); else await this.forget(key)
  }

  async ignoreFile(sourceId: string, cardId: string | null, path: string, kind: 'file' | 'directory' | 'extension'): Promise<GitChanges> {
    const target = await this.target(this.source(sourceId), cardId)
    await this.inside(sourceId, cardId, path)
    if (!(await this.listChanges(target.dir)).some((file) => file.path === path)) throw new Error(tm().git.fileHasNoChanges)
    const slash = path.replace(/\\/g, '/'), directory = slash.includes('/') ? slash.slice(0, slash.lastIndexOf('/')) : '', extension = extname(slash)
    if (/[\r\n]/.test(slash) || (kind === 'directory' && !directory) || (kind === 'extension' && !extension)) throw new Error(tm().git.cannotCreateIgnoreRule)
    const escape = (value: string): string => value.replace(/[\\*?[\] !#]/g, '\\$&')
    const pattern = kind === 'extension' ? `*${escape(extension)}` : `/${escape(kind === 'file' ? slash : directory)}${kind === 'directory' ? '/' : ''}`
    const ignorePath = join(target.dir, '.gitignore'), existing = await readFile(ignorePath, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error }), current = existing ?? ''
    if (!current.split(/\r?\n/).includes(pattern)) {
      const next = `${current}${current && !current.endsWith('\n') ? '\n' : ''}${pattern}\n`, before = await this.state(target.dir)
      await writeFile(ignorePath, next, 'utf8')
      await this.record(this.keyOf(sourceId, cardId), target.dir, 'ignore', before, { pattern, previous: existing, next })
    }
    return this.changes(sourceId, cardId)
  }

  private async commitAt(dir: string, input: { message: string; description?: string; amend?: boolean; paths?: string[] }): Promise<string> {
    const { subject, body } = splitMessage(input.message), description = [body, input.description?.trim()].filter(Boolean).join('\n\n')
    if (!subject && !input.amend) throw new Error(tm().git.writeCommitSummary)
    const paths = input.paths ?? []
    for (let i = 0; i < paths.length; i += 200) await this.run(dir, ['add', '-A', '--', ...paths.slice(i, i + 200)])
    const args = ['commit']
    if (subject) args.push('-m', subject, ...(description ? ['-m', description] : []))
    if (input.amend) args.push('--amend', ...(subject ? [] : ['--no-edit']))
    // Lista longa não cabe na linha de comando do Windows: vai por arquivo (separada por NUL), sempre com --only para não levar o resto do index.
    let listDir: string | null = null
    if (paths.length && paths.length <= 400) args.push('--only', '--', ...paths)
    else if (paths.length) {
      listDir = await mkdtemp(join(tmpdir(), 'agentboard-paths-'))
      const list = join(listDir, 'paths')
      await writeFile(list, `${paths.join('\0')}\0`, 'utf8')
      args.push('--only', `--pathspec-from-file=${list}`, '--pathspec-file-nul')
    }
    else if (!input.amend && !(await this.run(dir, ['diff', '--cached', '--name-only'])).trim()) throw new Error(tm().git.nothingStaged)
    try { await this.run(dir, args) } finally { if (listDir) await rm(listDir, { recursive: true, force: true }).catch(() => undefined) }
    return (await this.run(dir, ['rev-parse', 'HEAD'])).trim()
  }

  async commit(input: { sourceId: string; cardId: string | null; message: string; description?: string; amend?: boolean; paths?: string[] }): Promise<{ hash: string }> {
    const target = await this.target(this.source(input.sourceId), input.cardId), before = await this.state(target.dir)
    const hash = await this.commitAt(target.dir, input)
    // Amend sem mensagem nova (--no-edit) mantém o resumo do commit antigo: lê do commit que ficou.
    const message = (await this.tryRun(target.dir, ['log', '-1', '--format=%s']))?.trim() || splitMessage(input.message).subject
    await this.record(this.keyOf(input.sourceId, input.cardId), target.dir, 'commit', before, { message, amend: Boolean(input.amend), hash })
    return { hash }
  }

  async renameCommit(input: { sourceId: string; cardId: string | null; hash: string; message: string }): Promise<{ hash: string }> {
    const dir = (await this.target(this.source(input.sourceId), input.cardId)).dir
    if (!/^[0-9a-f]{40,64}$/.test(input.hash) || (await this.run(dir, ['rev-parse', 'HEAD'])).trim() !== input.hash) throw new Error(tm().git.onlyLastCommitEditable)
    if (!(await this.tryRun(dir, ['symbolic-ref', '-q', 'HEAD']))?.trim()) throw new Error(tm().git.checkoutBranchFirstToEdit)
    const subject = input.message.trim()
    if (!subject || /[\r\n]/.test(subject)) throw new Error(tm().git.singleLineSummary)
    const body = (await this.run(dir, ['show', '-s', '--format=%b', input.hash])).trim(), before = await this.state(dir)
    await this.run(dir, ['commit', '--amend', '--only', '-m', subject, ...(body ? ['-m', body] : [])])
    const hash = (await this.run(dir, ['rev-parse', 'HEAD'])).trim()
    await this.record(this.keyOf(input.sourceId, input.cardId), dir, 'commit', before, { message: subject, rename: true, hash })
    return { hash }
  }

  async sync(sourceId: string, cardId: string | null, action: 'fetch' | 'pull' | 'push' | 'stash' | 'pop', pull: 'ff' | 'ff-only' | 'rebase' = 'ff-only', force = false): Promise<{ output: string; conflicts?: number }> {
    const source = this.source(sourceId), target = await (action === 'fetch' || action === 'push' ? this.target(source, cardId) : this.busyTarget(source, cardId))
    if (action === 'stash') {
      // Guarda também os não rastreados (-u): eles saem da pasta, então a mensagem diz quantos foram junto.
      if (!(await this.run(target.dir, ['status', '--porcelain'])).trim()) return { output: tm().git.nothingToStash }
      const untracked = (await this.run(target.dir, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean).length
      const before = await this.state(target.dir)
      await this.run(target.dir, ['stash', 'push', '--include-untracked'])
      await this.recordStash(this.keyOf(sourceId, cardId), target.dir, before)
      return { output: untracked ? tm().git.stashSavedWithNew(untracked) : tm().git.stashSaved }
    }
    if (action === 'pop') { await this.forget(this.keyOf(sourceId, cardId)); return this.applyStash(target.dir, ['stash', 'pop'], tm().git.stashAppliedRemoved) }
    if (!(await this.tryRun(source.path, ['remote']))?.trim()) throw new Error(tm().git.noRemoteAddOrigin)
    if (action === 'fetch') return { output: (await this.run(source.path, ['fetch', '--all', '--prune'])).trim() || tm().git.allUpToDate }
    if (action === 'pull') { await this.forget(this.keyOf(sourceId, cardId)); return { output: (await this.run(target.dir, ['pull', pull === 'rebase' ? '--rebase' : pull === 'ff' ? '--ff' : '--ff-only'])).trim() || tm().git.allUpToDate } }
    const branch = target.branch ?? (await this.run(target.dir, ['branch', '--show-current'])).trim()
    if (!branch) throw new Error(tm().git.detachedHeadBeforePublish)
    // Forçar usa --force-with-lease: só sobrescreve se o remoto ainda estiver como o último fetch (não atropela o que chegou depois).
    const output = (await this.run(target.dir, ['push', '-u', ...(force ? ['--force-with-lease'] : []), 'origin', branch])).trim() || (force ? tm().git.branchForcePublished(branch) : tm().git.branchPublished(branch))
    await this.forget(this.keyOf(sourceId, cardId))
    return { output }
  }

  /** Branch atual (da pasta principal ou da worktree do card), a remota que ela acompanha (null se nenhuma) e os remotos do repositório. */
  async upstream(sourceId: string, cardId: string | null): Promise<{ branch: string | null; upstream: string | null; remotes: string[] }> {
    const source = this.source(sourceId), target = await this.target(source, cardId)
    const branch = target.branch ?? ((await this.tryRun(target.dir, ['branch', '--show-current']))?.trim() || null)
    const upstream = branch ? (await this.tryRun(target.dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`]))?.trim() || null : null
    const remotes = ((await this.tryRun(source.path, ['remote'])) ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    return { branch, upstream, remotes }
  }

  /** Liga a branch atual a remoto/branch (para o pull e o push saberem para onde ir). Busca a branch remota antes; se ela não existe, explica. */
  async setUpstream(input: { sourceId: string; cardId: string | null; remote: string; branch: string }): Promise<{ upstream: string }> {
    const source = this.source(input.sourceId), target = await this.target(source, input.cardId)
    const current = target.branch ?? (await this.run(target.dir, ['branch', '--show-current'])).trim()
    if (!current) throw new Error(tm().git.detachedHeadPickBranch)
    const remote = input.remote.trim(), branch = input.branch.trim()
    for (const ref of [remote, branch]) if (!ref || ref.startsWith('-') || await this.tryRun(source.path, ['check-ref-format', '--allow-onelevel', ref]) === null) throw new Error(ref ? tm().git.invalidNameValue(ref) : tm().git.invalidNameEmpty)
    if (!((await this.tryRun(source.path, ['remote'])) ?? '').split(/\r?\n/).map((item) => item.trim()).includes(remote)) throw new Error(tm().git.remoteNotInRepo(remote))
    try { await this.run(target.dir, ['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]) }
    catch { throw new Error(tm().git.branchNotOnRemote(branch, remote)) }
    await this.run(target.dir, ['branch', `--set-upstream-to=${remote}/${branch}`, current])
    return { upstream: `${remote}/${branch}` }
  }

  /** Trava: não atualiza a pasta de um card enquanto um agente (dele, ou de quem usa a worktree dele) está rodando, para não trocar arquivos debaixo dele. */
  private assertIdle(sourceId: string, folder: string): void {
    const normal = (value: string): string => value.split(String.fromCharCode(92)).join('/').toLowerCase().replace(/\/+$/, '')
    const owner = this.members(this.source(sourceId).projectId).find((member) => normal(member.path) === normal(folder))
    if (!owner) return
    const busy = this.database.db.prepare(`SELECT c.title FROM cards c WHERE (c.id = ? OR c.worktree_card_id = ?)
      AND EXISTS (SELECT 1 FROM runs r WHERE r.card_id = c.id AND r.status IN ('queued', 'running')) LIMIT 1`).pluck().get(owner.cardId, owner.cardId) as string | undefined
    if (busy !== undefined) throw new Error(tm().git.cardAgentBusy(busy || tm().common.untitled))
  }

  /** O que se perde ao apagar a worktree do card: commits só dela (sem push) e arquivos sem commit, por repositório. */
  projectOfCard(cardId: string): string {
    const projectId = this.database.db.prepare('SELECT project_id FROM cards WHERE id = ?').pluck().get(cardId) as string | undefined
    if (!projectId) throw new Error(tm().common.cardNotFound)
    return projectId
  }

  /** Pastas da worktree do card; com `sourceId`, só a do repositório escolhido. */
  private worktreeMembers(projectId: string, cardId: string, sourceId?: string): Member[] {
    const all = this.members(projectId, cardId)
    if (!sourceId) return all
    const path = this.source(sourceId).path
    return all.filter((member) => same(member.repoPath, path))
  }

  async worktreeInfo(projectId: string, cardId: string, sourceId?: string): Promise<GitWorktreeInfo> {
    const members = this.worktreeMembers(projectId, cardId, sourceId)
    if (!members.length) throw new Error(tm().git.cardHasNoWorktree)
    const sharedWith = this.database.db.prepare('SELECT title FROM cards WHERE worktree_card_id = ? ORDER BY title').pluck().all(cardId) as string[]
    const repos = await Promise.all(members.map(async (member) => {
      const name = basename(member.repoPath), exists = await isDir(member.path)
      if (!exists) return { name, branch: member.branch, unpushed: 0, files: 0, exists }
      const branch = (await this.tryRun(member.path, ['branch', '--show-current']))?.trim() || member.branch
      const count = (await this.tryRun(member.path, ['rev-list', '--count', ...cardRevs(branch, member.baseRef)]))?.trim()
      const files = await this.listChanges(member.path).catch(() => [] as GitChange[])
      return { name, branch, unpushed: Number(count) || 0, files: new Set(files.map((file) => file.path)).size, exists }
    }))
    return { cardId, title: members[0]!.title, branch: repos[0]!.branch, sharedWith, repos }
  }

  /**
   * Apaga a worktree do card (todas as pastas dela) e libera o espaço. O card e o histórico dele ficam; só o vínculo vira "removida".
   * A branch local só é apagada se `deleteBranch`; sem isso ela guarda os commits que não foram enviados.
   */
  async deleteWorktree(projectId: string, cardId: string, deleteBranch: boolean, sourceId?: string): Promise<{ output: string; keptBranches: string[] }> {
    const members = this.worktreeMembers(projectId, cardId, sourceId)
    const worktree = this.database.db.prepare(`SELECT id, path FROM worktrees WHERE card_id = ? AND cleanup_state != 'removed' ORDER BY created_at DESC LIMIT 1`).get(cardId) as { id: string; path: string } | undefined
    if (!members.length || !worktree) throw new Error(tm().git.cardHasNoWorktree)
    const busy = this.database.db.prepare(`SELECT c.title FROM cards c WHERE (c.id = ? OR c.worktree_card_id = ?)
      AND EXISTS (SELECT 1 FROM runs r WHERE r.card_id = c.id AND r.status IN ('queued', 'running')) LIMIT 1`).pluck().get(cardId, cardId) as string | undefined
    if (busy !== undefined) throw new Error(tm().git.worktreeAgentBusy(busy || tm().common.untitled))
    const info = await this.worktreeInfo(projectId, cardId, sourceId), kept: string[] = []
    // As pastas do card vão sumir: o histórico de desfazer delas não serve mais.
    await this.release(this.undo.clearWhere((key) => key.endsWith(`:${cardId}`)))
    for (const member of members) {
      const branch = info.repos.find((repo) => repo.name === basename(member.repoPath))?.branch ?? member.branch
      await this.tryRun(member.repoPath, ['worktree', 'remove', '--force', member.path])
      await rm(member.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined)
      await this.tryRun(member.repoPath, ['worktree', 'prune'])
      if (existsSyncDir(member.path)) throw new Error(tm().git.worktreeFolderLocked(member.path))
      this.database.db.prepare('DELETE FROM worktree_members WHERE worktree_id = ? AND path = ?').run(worktree.id, member.path)
      try { this.onFolderRemoved?.(member.path) } catch { /* o índice é informativo */ }
      if (deleteBranch && await this.tryRun(member.repoPath, ['branch', '-d', branch]) === null && await this.tryRun(member.repoPath, ['show-ref', '--verify', '-q', `refs/heads/${branch}`]) !== null) kept.push(branch)
    }
    // Só apagou uma pasta e ainda restam outras: a worktree do card continua valendo.
    const remaining = this.database.db.prepare('SELECT COUNT(*) FROM worktree_members WHERE worktree_id = ?').pluck().get(worktree.id) as number
    if (remaining > 0) return { output: tm().git.worktreeDeleted(info.title), keptBranches: kept }
    // A pasta-mãe (uma por card) só some se não for o próprio repositório de ninguém.
    if (!members.some((member) => same(member.repoPath, worktree.path)) && !existsSyncDir(join(worktree.path, '.git'))) await rm(worktree.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined)
    this.database.db.transaction(() => {
      this.database.db.prepare(`UPDATE worktrees SET cleanup_state = 'removed' WHERE id = ?`).run(worktree.id)
      this.database.db.prepare('UPDATE cards SET worktree_card_id = NULL WHERE worktree_card_id = ?').run(cardId)
    })()
    return { output: tm().git.worktreeDeleted(info.title), keptBranches: kept }
  }

  /** Pasta (worktree) onde a branch está aberta, se não for a pasta principal; `null` se não estiver aberta em lugar nenhum. */
  private async worktreeOf(dir: string, branch: string): Promise<string | null> {
    let path = ''
    for (const line of ((await this.tryRun(dir, ['worktree', 'list', '--porcelain'])) ?? '').split(/\r?\n/)) {
      if (line.startsWith('worktree ')) path = line.slice(9)
      else if (line === `branch refs/heads/${branch}`) return path && path !== dir ? path : null
    }
    return null
  }

  /** Atualiza a branch escolhida somente por fast-forward antes de abri-la. */
  async checkoutRemote(sourceId: string, cardId: string | null, name: string): Promise<{ output: string }> {
    const dir = (await this.busyTarget(this.source(sourceId), cardId)).dir, slash = name.indexOf('/')
    const remote = name.slice(0, slash), local = name.slice(slash + 1)
    if (slash <= 0 || !local || local === 'HEAD' || name.startsWith('-') || await this.tryRun(dir, ['check-ref-format', '--allow-onelevel', name]) === null) throw new Error(tm().git.invalidRemoteBranch)
    if (!(await this.tryRun(dir, ['remote']))?.split(/\r?\n/).includes(remote)) throw new Error(tm().git.remoteDoesNotExist(remote))
    await this.run(dir, ['fetch', remote])
    const remoteRef = `refs/remotes/${name}`, localRef = `refs/heads/${local}`
    if (await this.tryRun(dir, ['show-ref', '--verify', '-q', remoteRef]) === null) throw new Error(tm().git.remoteBranchDoesNotExist(name))
    const key = this.keyOf(sourceId, cardId), before = await this.state(dir)
    if (await this.tryRun(dir, ['show-ref', '--verify', '-q', localRef]) === null) {
      await this.run(dir, ['checkout', '--track', name])
      await this.record(key, dir, 'checkout', before, { to: local, createdLocal: local, createdAt: (await this.tryRun(dir, ['rev-parse', localRef]))?.trim() ?? '', remote: name })
      return { output: tm().git.branchCreatedAndOpenedFrom(local, name) }
    }
    const upstream = (await this.tryRun(dir, ['rev-parse', '--abbrev-ref', `${local}@{upstream}`]))?.trim()
    if (upstream && upstream !== name) throw new Error(tm().git.tracksOther(local, upstream, name))
    const isBehind = await this.tryRun(dir, ['merge-base', '--is-ancestor', localRef, remoteRef]) !== null
    const isAhead = await this.tryRun(dir, ['merge-base', '--is-ancestor', remoteRef, localRef]) !== null
    if (!isBehind && !isAhead) throw new Error(tm().git.branchesDiverged(local, name))
    const current = (await this.run(dir, ['branch', '--show-current'])).trim()
    if (isBehind && !isAhead) {
      if (current === local) await this.run(dir, ['merge', '--ff-only', remoteRef])
      else await this.run(dir, ['branch', '-f', local, remoteRef])
    }
    if (current !== local) await this.run(dir, ['checkout', local])
    // A branch andou por fast-forward: só o checkout não desfaz isso, então a pilha é limpa.
    if (isBehind && !isAhead) await this.forget(key); else await this.record(key, dir, 'checkout', before, { to: local })
    return { output: isBehind && !isAhead ? tm().git.branchFastForwardedOpened(local) : tm().git.branchOpenedContains(local, name) }
  }

  /** Ações do menu de uma branch na pasta principal do repositório. Merge e rebase com conflito são desfeitos, para não deixar a pasta no meio do caminho. */
  async branchAction(sourceId: string, input: { cardId?: string | null; action: 'checkout' | 'pull' | 'pull-rebase' | 'push' | 'rebase-onto' | 'merge' | 'create' | 'delete' | 'delete-remote'; name: string; newName?: string }): Promise<{ output: string }> {
    const dir = (await (input.action === 'push' || input.action === 'delete-remote' ? this.target(this.source(sourceId), input.cardId ?? null) : this.busyTarget(this.source(sourceId), input.cardId ?? null))).dir, { action, name } = input
    const valid = async (ref: string): Promise<void> => { if (ref.startsWith('-') || await this.tryRun(dir, ['check-ref-format', '--allow-onelevel', ref]) === null) throw new Error(tm().git.invalidBranchName(ref)) }
    await valid(name)
    const current = (await this.run(dir, ['branch', '--show-current'])).trim(), isHead = current === name
    const last = (text: string, fallback: string): string => text.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? fallback
    const needRemote = async (): Promise<void> => { if (!(await this.tryRun(dir, ['remote']))?.trim()) throw new Error(tm().git.noRemoteOrigin) }
    const key = this.keyOf(sourceId, input.cardId), before = await this.state(dir)
    if (action === 'checkout') {
      const remote = await this.tryRun(dir, ['show-ref', '--verify', '-q', `refs/heads/${name}`]) === null && await this.tryRun(dir, ['show-ref', '--verify', '-q', `refs/remotes/${name}`]) !== null
      if (!remote) { await this.run(dir, ['checkout', name]); await this.record(key, dir, 'checkout', before, { to: name }); return { output: tm().git.nowOn(name) } }
      // Branch remota: cria a local acompanhando a remota e muda para ela; se a local já existe, só muda para ela.
      const local = name.replace(/^[^/]+\//, '')
      const exists = await this.tryRun(dir, ['show-ref', '--verify', '-q', `refs/heads/${local}`]) !== null
      await this.run(dir, exists ? ['checkout', local] : ['checkout', '--track', name])
      await this.record(key, dir, 'checkout', before, exists ? { to: local } : { to: local, createdLocal: local, createdAt: (await this.tryRun(dir, ['rev-parse', `refs/heads/${local}`]))?.trim() ?? '', remote: name })
      return { output: exists ? tm().git.nowOnExisting(local) : tm().git.branchCreatedFromNowOn(local, name, local) }
    }
    if (action === 'delete-remote') {
      // `name` vem como origem/branch (ex.: origin/feature/x). Apaga no servidor; nunca o HEAD nem a branch padrão do remoto.
      const slash = name.indexOf('/'), remoteName = name.slice(0, slash), branch = name.slice(slash + 1)
      if (slash <= 0 || !branch) throw new Error(tm().git.enterRemoteBranchFormat)
      await valid(remoteName); await valid(branch)
      if (branch === 'HEAD') throw new Error(tm().git.cannotDeleteRemoteHead)
      if (!(await this.tryRun(dir, ['remote']))?.split(/\r?\n/).includes(remoteName)) throw new Error(tm().git.remoteNotInRepo(remoteName))
      if (await this.tryRun(dir, ['show-ref', '--verify', '-q', `refs/remotes/${name}`]) === null) throw new Error(tm().git.remoteBranchDoesNotExist(name))
      if ((await this.tryRun(dir, ['symbolic-ref', '--short', `refs/remotes/${remoteName}/HEAD`]))?.trim() === name) throw new Error(tm().git.remoteDefaultBranch(branch))
      await this.run(dir, ['push', remoteName, '--delete', branch])
      await this.forget(key)
      return { output: tm().git.branchDeletedOnRemote(branch, remoteName) }
    }
    if (action === 'pull') { await needRemote(); await this.forget(key); return { output: last(await this.fastForwardBranch(sourceId, dir, name, current), tm().git.allUpToDate) } }
    if (action === 'pull-rebase') {
      await needRemote(); await this.forget(key)
      const place = isHead ? dir : await this.worktreeOf(dir, name)
      if (!place) throw new Error(tm().git.checkoutBeforeRebasePull)
      if (place !== dir) this.assertIdle(sourceId, place)
      return { output: last(await this.run(place, ['pull', '--rebase']), tm().git.allUpToDate) }
    }
    if (action === 'push') { await needRemote(); const output = last(await this.run(dir, ['push', '-u', 'origin', name]), tm().git.branchPublished(name)); await this.forget(key); return { output } }
    if (action === 'rebase-onto' || action === 'merge') {
      if (!current) throw new Error(tm().git.mainFolderDetached)
      if (isHead) throw new Error(tm().git.pickOtherBranch)
      await this.forget(key)
      if (action === 'rebase-onto') await this.updateIfBehind(sourceId, dir, name, current)
      try { return { output: last(await this.run(dir, action === 'merge' ? ['merge', '--no-edit', name] : ['rebase', name]), tm().git.done) } } catch (error) { throw await this.afterFailure(dir, action === 'merge' ? 'merge' : 'rebase', error) }
    }
    if (action === 'create') {
      const created = input.newName?.trim() ?? ''
      if (!created) throw new Error(tm().git.typeNewBranchName)
      await valid(created)
      await this.run(dir, ['checkout', '-b', created, name])
      await this.record(key, dir, 'create-branch', before, { name: created, hash: (await this.tryRun(dir, ['rev-parse', 'HEAD']))?.trim() ?? '' })
      return { output: tm().git.branchCreatedFromOpened(created, name) }
    }
    if (isHead) throw new Error(tm().git.cannotDeleteCurrentBranch)
    const hash = (await this.tryRun(dir, ['rev-parse', '-q', '--verify', `refs/heads/${name}`]))?.trim() ?? '', remote = (await this.tryRun(dir, ['config', `branch.${name}.remote`]))?.trim() ?? '', merge = (await this.tryRun(dir, ['config', `branch.${name}.merge`]))?.trim() ?? ''
    await this.run(dir, ['branch', '-d', name])
    if (hash) await this.record(key, dir, 'delete-branch', before, { name, hash, remote, merge }, [hash]); else await this.forget(key)
    return { output: tm().git.branchDeleted(name) }
  }

  /** Atualiza a branch local pelo remoto só com fast-forward. Se estiver aberta numa worktree, o pull roda dentro dela (o Git não deixa fazer `fetch name:name` nesse caso). */
  private async fastForwardBranch(sourceId: string, dir: string, name: string, current: string): Promise<string> {
    if (current === name) return this.run(dir, ['pull', '--ff-only'])
    const inWorktree = await this.worktreeOf(dir, name)
    if (inWorktree) { this.assertIdle(sourceId, inWorktree); return this.run(inWorktree, ['pull', '--ff-only']) }
    const remote = (await this.tryRun(dir, ['config', `branch.${name}.remote`]))?.trim() || 'origin'
    return this.run(dir, ['fetch', remote, `${name}:${name}`])
  }

  /** Antes de um rebase sobre uma branch local, baixa as novidades dela se o upstream estiver à frente (sem upstream ou sem remoto, não faz nada). */
  private async updateIfBehind(sourceId: string, dir: string, name: string, current: string): Promise<void> {
    if (await this.tryRun(dir, ['show-ref', '--verify', '-q', `refs/heads/${name}`]) === null) return
    const behind = Number((await this.tryRun(dir, ['rev-list', '--count', `${name}..${name}@{upstream}`]))?.trim() ?? 0)
    if (behind > 0) await this.fastForwardBranch(sourceId, dir, name, current)
  }

  /** Ações do menu de um commit na pasta principal. Cherry-pick, revert e rebase com conflito ficam abertos para a tela de conflitos, ou são desfeitos se não houver conflito. */
  async commitAction(sourceId: string, input: { cardId?: string | null; action: 'checkout' | 'cherry-pick' | 'revert' | 'rebase' | 'reset-soft' | 'reset-mixed' | 'reset-hard' | 'branch' | 'tag'; hash: string; name?: string }): Promise<{ output: string }> {
    const dir = (await (action_ => action_ === 'branch' || action_ === 'tag' ? this.target(this.source(sourceId), input.cardId ?? null) : this.busyTarget(this.source(sourceId), input.cardId ?? null))(input.action)).dir, { action, hash } = input
    if (!/^[0-9a-f]{7,64}$/.test(hash)) throw new Error(tm().git.invalidCommit)
    const name = input.name?.trim() ?? ''
    const key = this.keyOf(sourceId, input.cardId), before = await this.state(dir)
    if (action === 'branch' || action === 'tag') {
      if (!name || name.startsWith('-') || await this.tryRun(dir, ['check-ref-format', '--allow-onelevel', name]) === null) throw new Error(tm().git.invalidName)
      if (action === 'tag') { await this.run(dir, ['tag', name, hash]); await this.record(key, dir, 'tag', before, { name, hash: (await this.tryRun(dir, ['rev-parse', '-q', '--verify', `refs/tags/${name}`]))?.trim() ?? '' }); return { output: tm().git.tagCreatedAt(name, hash.slice(0, 7)) } }
      await this.run(dir, ['checkout', '-b', name, hash]); await this.record(key, dir, 'create-branch', before, { name, hash: (await this.tryRun(dir, ['rev-parse', 'HEAD']))?.trim() ?? '' }); return { output: tm().git.branchCreatedAtOpened(name, hash.slice(0, 7)) }
    }
    if (action === 'checkout') { await this.run(dir, ['checkout', '--detach', hash]); await this.record(key, dir, 'checkout', before, { to: hash.slice(0, 7) }); return { output: tm().git.mainFolderAtDetached(hash.slice(0, 7)) } }
    if (action.startsWith('reset-')) {
      // Reset hard descarta o que não foi commitado: antes, guarda uma cópia recuperável (o commit antigo continua no reflog).
      const saved = action === 'reset-hard' ? await this.saveRecovery(dir, 'reset') : null
      const snapshot = saved ? (await this.tryRun(dir, ['rev-parse', '-q', '--verify', saved]))?.trim() || null : null
      await this.run(dir, ['reset', `--${action.slice(6)}`, hash])
      // Com alterações, a cópia do `stash create` é o que permite desfazer; sem elas e sem mudar o HEAD, não há o que desfazer.
      const to = (await this.tryRun(dir, ['rev-parse', 'HEAD']))?.trim() ?? ''
      if (snapshot) await this.record(key, dir, 'reset-hard-dirty', before, { mode: 'hard', from: before.head, to, snapshot }, [snapshot])
      else if (to && to !== before.head) await this.record(key, dir, 'reset', before, { mode: action.slice(6), from: before.head, to })
      return { output: `${tm().git.branchMovedTo(hash.slice(0, 7), action.slice(6))}${saved ? ` ${tm().git.recoveryRef(saved)}` : ''}` }
    }
    await this.forget(key)
    if (action === 'rebase') {
      const current = (await this.run(dir, ['branch', '--show-current'])).trim()
      if (!current) throw new Error(tm().git.mainFolderDetached)
      // Se o commit é a ponta de uma branch local atrasada em relação ao remoto, baixa essa branch antes e rebaseia sobre a ponta nova.
      let onto = hash
      const tips = ((await this.tryRun(dir, ['for-each-ref', '--points-at', hash, '--format=%(refname:short)', 'refs/heads'])) ?? '').split(/\r?\n/).filter((ref) => ref && ref !== current)
      for (const tip of tips) {
        const behind = Number((await this.tryRun(dir, ['rev-list', '--count', `${tip}..${tip}@{upstream}`]))?.trim() ?? 0)
        if (behind > 0) { await this.fastForwardBranch(sourceId, dir, tip, current); onto = (await this.run(dir, ['rev-parse', tip])).trim(); break }
      }
      if (onto === (await this.run(dir, ['rev-parse', 'HEAD'])).trim()) throw new Error(tm().git.pickOtherBranch)
      try { await this.run(dir, ['rebase', onto]); return { output: tm().git.branchRebasedOnto(current, onto.slice(0, 7)) } } catch (error) { throw await this.afterFailure(dir, 'rebase', error) }
    }
    try { await this.run(dir, action === 'revert' ? ['revert', '--no-edit', hash] : ['cherry-pick', hash]); return { output: action === 'revert' ? tm().git.commitReverted(hash.slice(0, 7)) : tm().git.commitCherryPicked(hash.slice(0, 7)) } } catch (error) { throw await this.afterFailure(dir, action as 'cherry-pick' | 'revert', error) }
  }

  /** Guarda em `refs/agentboard/backup/*` o que uma ação destrutiva vai descartar (alterações do `git stash create`, ou o stash indicado). Devolve o nome da ref. */
  private async saveRecovery(dir: string, kind: 'reset' | 'stash', stashRef?: string): Promise<string | null> {
    const commit = (kind === 'stash' ? await this.tryRun(dir, ['rev-parse', '--verify', stashRef!]) : await this.tryRun(dir, ['stash', 'create']))?.trim()
    if (!commit) return null
    const ref = `refs/agentboard/backup/${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}`
    return await this.tryRun(dir, ['update-ref', ref, commit]) === null ? null : ref
  }

  /** Falha de merge/rebase/cherry-pick/revert: com conflito a operação fica aberta para a tela de conflitos; sem conflito é desfeita. */
  private async afterFailure(dir: string, kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert', error: unknown): Promise<Error> {
    const state = await this.conflictState(dir)
    if (state.operation && state.files.length) return new Error(tm().git.conflictInFiles(state.files.length))
    await this.tryRun(dir, [kind, '--abort'])
    return error instanceof Error ? error : new Error(String(error))
  }

  /**
   * Operação com conflito em andamento. `stash` = há arquivos não mesclados sem MERGE_HEAD etc. (stash apply/pop que conflitou):
   * não existe operação para continuar nem abortar, só marcar os arquivos como resolvidos.
   */
  private async conflictState(dir: string): Promise<{ operation: ConflictOperation | null; files: string[] }> {
    const gitDir = ((await this.tryRun(dir, ['rev-parse', '--absolute-git-dir'])) ?? '').trim()
    if (!gitDir) return { operation: null, files: [] }
    const has = (name: string): Promise<boolean> => stat(join(gitDir, name)).then(() => true, () => false)
    const found = await has('MERGE_HEAD') ? 'merge' : await has('rebase-merge') || await has('rebase-apply') ? 'rebase' : await has('CHERRY_PICK_HEAD') ? 'cherry-pick' : await has('REVERT_HEAD') ? 'revert' : null
    const files = ((await this.tryRun(dir, ['diff', '--name-only', '--diff-filter=U'])) ?? '').split(/\r?\n/).filter(Boolean)
    const operation: ConflictOperation | null = found ?? (files.length ? 'stash' : null)
    return { operation, files: operation ? files : [] }
  }

  /** Pasta onde o conflito vive: o repositório do projeto ou, com `cardId`, a worktree do card nesse repositório. */
  private async conflictDir(sourceId: string, cardId?: string | null, write = true): Promise<string> { return (await (write ? this.busyTarget : this.target).call(this, this.source(sourceId), cardId ?? null)).dir }

  async conflicts(sourceId: string, cardId?: string | null): Promise<{ operation: ConflictOperation | null; files: string[] }> { return this.conflictState(await this.conflictDir(sourceId, cardId, false)) }

  /** Repositórios (e worktrees de card) do projeto com merge/rebase/cherry-pick/revert em andamento, para marcar a lista da página Git. */
  async conflictsAll(projectId: string): Promise<Array<{ sourceId: string; cardId: string | null; repo: string; cardTitle: string | null; operation: ConflictOperation; files: string[] }>> {
    const sources = this.database.db.prepare(`SELECT id, project_id AS projectId, name, local_path AS path FROM project_sources WHERE project_id = ? AND is_git_repository = 1 ORDER BY sort_order`).all(projectId) as Source[]
    const found: Array<{ sourceId: string; cardId: string | null; repo: string; cardTitle: string | null; operation: ConflictOperation; files: string[] }> = []
    for (const source of sources) {
      const state = await this.conflictState(source.path)
      if (state.operation) found.push({ sourceId: source.id, cardId: null, repo: source.name, cardTitle: null, operation: state.operation, files: state.files })
    }
    for (const member of this.members(projectId)) {
      const source = sources.find((item) => same(item.path, member.repoPath))
      if (!source || member.status !== 'active' || !await isDir(member.path)) continue
      const state = await this.conflictState(member.path)
      if (state.operation) found.push({ sourceId: source.id, cardId: member.cardId, repo: source.name, cardTitle: member.title, operation: state.operation, files: state.files })
    }
    return found
  }

  /** Conteúdo do arquivo em conflito, com os marcadores do Git. */
  async conflictFile(sourceId: string, path: string, cardId?: string | null): Promise<string> {
    const dir = await this.conflictDir(sourceId, cardId, false)
    if (!(await this.conflictState(dir)).files.includes(path)) throw new Error(tm().git.fileNotInConflict)
    return (await readFile(join(dir, path), 'utf8').catch(() => '')).slice(0, 400_000)
  }

  /** Grava o texto editado de um arquivo que ainda está em conflito (sem `git add`) e diz quantos continuam em conflito. */
  async saveConflict(sourceId: string, path: string, content: string, cardId?: string | null): Promise<{ left: number }> {
    const dir = await this.conflictDir(sourceId, cardId), state = await this.conflictState(dir)
    if (!state.files.includes(path)) throw new Error(tm().git.fileNotInConflict)
    await writeFile(join(dir, path), content, 'utf8')
    return { left: state.files.length }
  }

  async resolveConflict(sourceId: string, path: string, side: 'ours' | 'theirs' | 'marked', cardId?: string | null): Promise<{ left: number }> {
    const dir = await this.conflictDir(sourceId, cardId), state = await this.conflictState(dir)
    if (!state.files.includes(path)) throw new Error(tm().git.fileNotInConflict)
    if (side === 'marked') {
      if (/^(<{7}|>{7}) /m.test(await readFile(join(dir, path), 'utf8').catch(() => ''))) throw new Error(tm().git.conflictMarkersRemain)
      await this.run(dir, ['add', '--', path])
    } else if (await this.tryRun(dir, ['checkout', `--${side}`, '--', path]) === null) await this.run(dir, ['rm', '-f', '--', path]) // um dos lados apagou o arquivo
    else await this.run(dir, ['add', '--', path])
    return { left: (await this.conflictState(dir)).files.length }
  }

  async finishConflicts(sourceId: string, action: 'continue' | 'abort', cardId?: string | null): Promise<{ output: string }> {
    const dir = await this.conflictDir(sourceId, cardId), state = await this.conflictState(dir)
    if (!state.operation) throw new Error(tm().git.noOperationInProgress)
    // Stash com conflito: não há "stash --abort/--continue"; cada arquivo resolvido já foi marcado com git add e o stash continua guardado.
    if (state.operation === 'stash') throw new Error(action === 'abort' ? tm().git.stashConflictNoAbort : tm().git.stillInConflict(state.files.length))
    if (action === 'abort') { await this.run(dir, [state.operation, '--abort']); await this.forget(this.keyOf(sourceId, cardId)); return { output: tm().git.mergeAborted } }
    if (state.files.length) throw new Error(tm().git.stillInConflict(state.files.length))
    const out = await this.run(dir, ['-c', 'core.editor=true', state.operation === 'merge' ? 'commit' : state.operation, ...(state.operation === 'merge' ? ['--no-edit'] : ['--continue'])])
    await this.forget(this.keyOf(sourceId, cardId))
    return { output: out.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? tm().git.conflictsResolved }
  }

  /**
   * As duas versões de um arquivo para o `DiffEditor` da página Git: `unstaged` = índice × disco, `staged` = HEAD × índice e `commit` = pai × commit
   * (seguindo renomeações). `null` num lado = arquivo novo ou apagado; binário ou acima de 1 MB não manda conteúdo.
   */
  async fileVersions(sourceId: string, cardId: string | null, path: string, mode: 'unstaged' | 'staged' | 'commit', hash?: string): Promise<{ before: string | null; after: string | null; binary: boolean; truncated: boolean }> {
    const target = await this.target(this.source(sourceId), cardId)
    const show = (spec: string): Promise<string | null> => this.tryRun(target.dir, ['show', spec])
    let before: string | null, after: string | null
    if (mode === 'unstaged') { before = await show(`:${path}`); after = await readFile(await this.inside(sourceId, cardId, path), 'utf8').catch(() => null) }
    else if (mode === 'staged') { before = await show(`HEAD:${path}`); after = await show(`:${path}`) }
    else {
      if (!hash || !/^[0-9a-f]{7,64}$/.test(hash)) throw new Error(tm().git.invalidCommit)
      const renames = (await this.tryRun(target.dir, ['show', '--name-status', '-M', '--format=', hash])) ?? '', moved = renames.split(/\r?\n/).map((line) => line.split('\t')).find((cols) => cols[0]?.startsWith('R') && cols[2] === path)
      before = await show(`${hash}^:${moved?.[1] ?? path}`); after = await show(`${hash}:${path}`)
    }
    const binary = (before ?? '').includes('\0') || (after ?? '').includes('\0'), truncated = !binary && (Buffer.byteLength(before ?? '') > 1_000_000 || Buffer.byteLength(after ?? '') > 1_000_000)
    return binary || truncated ? { before: null, after: null, binary, truncated } : { before, after, binary: false, truncated: false }
  }

  async stashAction(sourceId: string, input: { cardId?: string | null; action: 'apply' | 'pop' | 'drop'; ref: string }): Promise<{ output: string; conflicts?: number }> {
    const dir = (await (input.action === 'drop' ? this.target(this.source(sourceId), input.cardId ?? null) : this.busyTarget(this.source(sourceId), input.cardId ?? null))).dir
    if (!/^stash@\{\d+\}$/.test(input.ref)) throw new Error(tm().git.invalidStash)
    const key = this.keyOf(sourceId, input.cardId)
    if (input.action === 'drop') {
      const [hash = '', ...subject] = ((await this.tryRun(dir, ['stash', 'list', '--format=%H%x09%gs']))?.split(/\r?\n/).filter(Boolean)[Number(/\d+/.exec(input.ref)![0])] ?? '').split('\t')
      const saved = await this.saveRecovery(dir, 'stash', input.ref), before = await this.state(dir)
      await this.run(dir, ['stash', 'drop', input.ref])
      if (hash) await this.record(key, dir, 'stash-drop', before, { hash, message: subject.join('\t') }, [hash]); else await this.forget(key)
      return { output: `${tm().git.stashDropped}${saved ? ` ${tm().git.recoveryRef(saved)}` : ''}` }
    }
    await this.forget(key)
    return this.applyStash(dir, ['stash', input.action, input.ref], input.action === 'pop' ? tm().git.stashAppliedRemoved : tm().git.stashApplied)
  }

  /** Aplica um stash (apply/pop). Se sobrar conflito, não é erro: o Git mantém o stash e a tela de conflitos assume (`conflicts` > 0). */
  private async applyStash(dir: string, args: string[], ok: string): Promise<{ output: string; conflicts?: number }> {
    try { await this.run(dir, args); return { output: ok } } catch (error) {
      const state = await this.conflictState(dir)
      if (state.operation === 'stash' && state.files.length) return { output: tm().git.stashAppliedWithConflicts(state.files.length), conflicts: state.files.length }
      throw error
    }
  }

  private async checkedStash(dir: string, ref: string, commit: string): Promise<void> {
    if (!/^stash@\{\d+\}$/.test(ref) || !/^[0-9a-f]{40,64}$/.test(commit) || (await this.run(dir, ['rev-parse', '--verify', ref])).trim() !== commit) throw new Error(tm().git.stashChanged)
  }

  async stashDetail(sourceId: string, cardId: string | null, ref: string, commit: string): Promise<{ files: GitCommitFile[] }> {
    const dir = (await this.target(this.source(sourceId), cardId)).dir
    await this.checkedStash(dir, ref, commit)
    const [names, nums] = await Promise.all([this.run(dir, ['stash', 'show', '--include-untracked', '--name-status', '-z', '--no-renames', ref]), this.run(dir, ['stash', 'show', '--include-untracked', '--numstat', '-z', '--no-renames', ref])])
    const counts = parseNumstat(nums), parts = names.split('\0').filter(Boolean), files: GitCommitFile[] = []
    for (let i = 0; i + 1 < parts.length; i += 2) { const path = parts[i + 1]!, found = counts.get(path); files.push({ path, status: statusOf(parts[i]!.charAt(0)), additions: found?.[0] ?? 0, deletions: found?.[1] ?? 0 }) }
    return { files }
  }

  async renameStash(sourceId: string, cardId: string | null, ref: string, commit: string, message: string): Promise<{ ref: string; commit: string }> {
    const dir = (await this.target(this.source(sourceId), cardId)).dir
    if (!message.trim() || /[\r\n]/.test(message)) throw new Error(tm().git.singleLineName)
    await this.checkedStash(dir, ref, commit)
    const index = Number(/^stash@\{(\d+)\}$/.exec(ref)![1])
    const tree = (await this.run(dir, ['rev-parse', `${commit}^{tree}`])).trim()
    const parents = (await this.run(dir, ['rev-list', '--parents', '-n', '1', commit])).trim().split(' ').slice(1)
    const replacement = (await this.run(dir, ['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent]), '-m', message.trim()])).trim()
    await this.run(dir, ['stash', 'store', '-m', message.trim(), replacement])
    const oldRef = `stash@{${index + 1}}`
    await this.checkedStash(dir, oldRef, commit)
    await this.run(dir, ['stash', 'drop', oldRef])
    return { ref: 'stash@{0}', commit: replacement }
  }

  // ---------- origem de cada repositório do card ----------
  /** Branches que servem de origem num repositório (locais e de origin), sem repetir. */
  async baseOptions(sourceId: string): Promise<string[]> {
    const source = this.source(sourceId)
    const out = await this.tryRun(source.path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin'])
    return [...new Set((out ?? '').split(/\r?\n/).map((line) => line.trim()).filter((name) => name && name !== 'origin' && name !== 'origin/HEAD' && !name.startsWith('agentboard/')))]
  }

  /** Troca a origem de UM repositório do card (a dos outros não muda): os commits do card passam a ser contados a partir dela. */
  async setBase(cardId: string, sourceId: string, baseRef: string): Promise<{ baseRef: string }> {
    const source = this.source(sourceId), wt = this.latestWorktree(cardId)
    if (!wt) throw new Error(tm().git.cardHasNoWorktree)
    if (await this.tryRun(source.path, ['rev-parse', '--verify', '-q', baseRef]) === null) throw new Error(tm().git.baseBranchMissing(baseRef, source.name))
    const members = this.database.db.prepare('SELECT id, repo_path AS repoPath FROM worktree_members WHERE worktree_id = ?').all(wt.id) as Array<{ id: string; repoPath: string }>
    const member = members.find((item) => same(item.repoPath, source.path))
    if (!member) throw new Error(tm().git.repoNotInCardWorktree(source.name))
    this.database.db.prepare('UPDATE worktree_members SET base_ref = ? WHERE id = ?').run(baseRef, member.id)
    return { baseRef }
  }

  // ---------- painel do card ----------
  async card(cardId: string): Promise<GitCard> {
    const card = this.database.db.prepare('SELECT project_id AS projectId FROM cards WHERE id = ?').get(cardId) as { projectId: string } | undefined
    if (!card) throw new Error(tm().common.cardNotFound)
    const policy = this.policy(card.projectId), wt = this.latestWorktree(cardId)
    if (!wt) return { branch: null, baseBranch: null, rule: { rule: policy.def, why: tm().git.projectDefault }, repos: [], delivery: { complete: false, pending: [] } }
    const sources = this.database.db.prepare('SELECT id, project_id AS projectId, name, local_path AS path FROM project_sources WHERE project_id = ?').all(card.projectId) as Source[]
    const agents = this.database.db.prepare('SELECT repo_path AS repoPath, hash, profile_id AS profileId FROM git_commit_agents').all() as Array<{ repoPath: string; hash: string; profileId: string }>
    const pending = this.requests(cardId).filter((item) => item.status === 'pending')
    const members = this.members(card.projectId, cardId)
    const repos = await Promise.all(members.map(async (member) => {
      const source = sources.find((item) => same(item.path, member.repoPath))
      if (!source) return null
      const empty = { sourceId: source.id, name: source.name, repoPath: source.path, worktreePath: member.path, ahead: 0, behind: 0, published: false, hasRemote: false, commits: [] as GitCard['repos'][number]['commits'], files: [] as GitChange[], request: null as GitRequest | null, state: member.status as 'active' | 'failed' | 'missing', error: member.error, prUrl: member.prUrl, baseRef: member.baseRef.replace(/^origin\//, '') }
      if (!await isDir(member.path)) return { ...empty, state: member.status === 'failed' ? 'failed' as const : 'missing' as const }
      const [log, behind, remote, published, files] = await Promise.all([
        this.tryRun(member.path, ['log', ...cardRevs(member.branch, member.baseRef, 'HEAD'), '--format=%H%x1f%an%x1f%aI%x1f%s']),
        this.tryRun(member.path, ['rev-list', '--count', `HEAD..${member.baseRef}`]),
        this.tryRun(member.path, ['remote']),
        this.tryRun(member.path, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${member.branch}`]),
        this.listChanges(member.path).catch(() => [] as GitChange[])
      ])
      const commits = (log ?? '').split(/\r?\n/).filter(Boolean).map((line) => {
        const [hash = '', author = '', date = '', subject = ''] = line.split('\x1f')
        return { hash, short: hash.slice(0, 7), subject, author, date: new Date(date).toISOString(), agentProfileId: agents.find((item) => item.hash === hash && same(item.repoPath, source.path))?.profileId ?? null }
      })
      return { ...empty, ahead: commits.length, behind: Number.parseInt(behind ?? '0', 10) || 0, published: Boolean(published?.trim()), hasRemote: Boolean(remote?.trim()), commits, files, request: pending.find((item) => item.sourceId === source.id) ?? null }
    }))
    const base = members[0]?.baseRef, list = repos.filter((item): item is NonNullable<typeof item> => Boolean(item))
    // Entrega por repositório: o card só está entregue quando todos estão prontos, commitados e sem pendência.
    const missing = list.flatMap((repo) => repo.state === 'failed' ? [tm().git.deliveryWorktreeFailed(repo.name, repo.error ?? tm().git.unknownError)] : repo.state === 'missing' ? [tm().git.deliveryWorktreeFolderGone(repo.name)] : repo.files.length ? [tm().git.deliveryUncommitted(repo.name, repo.files.length)] : [])
    return { branch: wt.branch, baseBranch: base ? base.replace(/^origin\//, '') : null, rule: resolveRule(policy, wt.branch), repos: list, delivery: { complete: !missing.length && list.some((repo) => repo.ahead > 0), pending: missing } }
  }

  // ---------- pull requests ----------
  /** Só abre no navegador um endereço de PR que o próprio card registrou (nunca um link qualquer vindo da tela). */
  prUrlOf(cardId: string, url: string): string {
    const known = this.database.db.prepare('SELECT m.pr_url FROM worktree_members m JOIN worktrees w ON w.id = m.worktree_id WHERE w.card_id = ? AND m.pr_url IS NOT NULL').pluck().all(cardId) as string[]
    if (!known.includes(url) || !/^https:\/\//.test(url)) throw new Error(tm().git.unknownPrUrl)
    return url
  }

  /**
   * Um PR (GitHub, pelo gh) ou MR (GitLab, pelo glab) por repositório do card que tem commits. Só roda quando o usuário pede:
   * publica a branch e abre o PR em rascunho por padrão. Falha num repositório não impede os outros; o resultado diz o que faltou.
   */
  async createPullRequests(cardId: string, input: { draft: boolean; title?: string; body?: string; sourceId?: string }): Promise<{ results: Array<{ repo: string; url: string | null; error: string | null }> }> {
    const card = this.database.db.prepare('SELECT project_id AS projectId, title FROM cards WHERE id = ?').get(cardId) as { projectId: string; title: string } | undefined
    if (!card) throw new Error(tm().common.cardNotFound)
    const members = this.members(card.projectId, cardId)
    if (!members.length) throw new Error(tm().git.cardHasNoWorktreeYet)
    const names = members.map((member) => member.repoPath.split(/[\\/]/).pop() ?? member.repoPath)
    const summary = (this.database.db.prepare("SELECT content_md FROM card_documents WHERE card_id = ? AND kind = 'resumo'").pluck().get(cardId) as string | undefined)?.trim() ?? ''
    const title = input.title?.trim() || card.title || 'Alterações do AgentBoard'
    const body = input.body ?? `${summary}${members.length > 1 ? `\n\nEste card altera ${members.length} repositórios (${names.join(', ')}); cada um tem o seu PR na mesma branch.` : ''}\n\n_Aberto pelo AgentBoard._`
    const results: Array<{ repo: string; url: string | null; error: string | null }> = []
    // Com `sourceId`, só esse repositório; sem ele, todos os do card.
    const only = input.sourceId ? resolve(this.source(input.sourceId).path) : null
    for (const [index, member] of members.entries()) {
      if (only && resolve(member.repoPath) !== only) continue
      const repo = names[index]!
      try {
        if (member.status === 'failed') throw new Error(tm().git.prWorktreeFailed(member.error ?? ''))
        if (member.prUrl) { results.push({ repo, url: member.prUrl, error: null }); continue }
        const ahead = Number.parseInt((await this.tryRun(member.path, ['rev-list', '--count', ...cardRevs(member.branch, member.baseRef, 'HEAD')]))?.trim() ?? '0', 10) || 0
        if (!ahead) throw new Error(tm().git.prNoCommits)
        const remote = (await this.tryRun(member.path, ['remote', 'get-url', 'origin']))?.trim()
        if (!remote) throw new Error(tm().git.prNoOrigin)
        await this.run(member.path, ['push', '-u', 'origin', member.branch])
        const target = member.baseRef.replace(/^origin\//, ''), gitlab = /gitlab/i.test(remote)
        const args = gitlab
          ? ['mr', 'create', '--source-branch', member.branch, '--target-branch', target, '--title', title, '--description', body, '--yes', ...(input.draft ? ['--draft'] : [])]
          : ['pr', 'create', '--head', member.branch, '--base', target, '--title', title, '--body', body, ...(input.draft ? ['--draft'] : [])]
        let output: string
        try { output = await this.cli.run(gitlab ? 'glab' : 'gh', args, member.path) }
        catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          if (/ENOENT|not recognized|não é reconhecido/i.test(text)) throw new Error(gitlab ? tm().git.installGlab : tm().git.installGh)
          // PR já aberto para a branch: reaproveita o endereço dele.
          if (!gitlab && /already exists/i.test(text)) output = await this.cli.run('gh', ['pr', 'view', member.branch, '--json', 'url', '-q', '.url'], member.path)
          else throw new Error(text.split(/\r?\n/).find((line) => line.trim())?.slice(0, 300) ?? text)
        }
        const url = output.match(/https?:\/\/\S+/g)?.at(-1) ?? null
        if (!url) throw new Error(tm().git.prCliNoUrl)
        this.database.db.prepare('UPDATE worktree_members SET pr_url = ? WHERE path = ?').run(url, member.path)
        results.push({ repo, url, error: null })
      } catch (error) { results.push({ repo, url: null, error: error instanceof Error ? error.message : String(error) }) }
    }
    return { results }
  }

  // ---------- pedidos de commit do agente ----------
  private toRequest(row: RequestRow): GitRequest {
    return { id: row.id, cardId: row.cardId, sourceId: row.sourceId, repoName: row.repoName, message: row.message, files: JSON.parse(row.files) as string[], status: row.status, agentProfileId: row.profileId, hash: row.hash, error: row.error, createdAt: row.createdAt }
  }

  /** Pedidos pendentes do card e os 10 mais recentes já decididos (o chat mostra o resultado). */
  requests(cardId: string): GitRequest[] {
    const sql = 'SELECT id, card_id AS cardId, source_id AS sourceId, repo_name AS repoName, message, files, status, profile_id AS profileId, hash, error, created_at AS createdAt FROM git_commit_requests'
    const pending = this.database.db.prepare(`${sql} WHERE card_id = ? AND status = 'pending' ORDER BY created_at`).all(cardId) as RequestRow[]
    const decided = (this.database.db.prepare(`${sql} WHERE card_id = ? AND status != 'pending' ORDER BY created_at DESC LIMIT 10`).all(cardId) as RequestRow[]).reverse()
    return [...decided, ...pending].map((row) => this.toRequest(row))
  }

  /** Ferramenta do agente: segue a regra da branch (nunca / pedir / automático). Devolve o texto para o agente. */
  async agentCommit(input: { cardId: string; chatId: string; message: string; files?: string[]; repo?: string }): Promise<{ rule: GitRule; text: string }> {
    const card = this.database.db.prepare('SELECT project_id AS projectId FROM cards WHERE id = ?').get(input.cardId) as { projectId: string } | undefined
    const wt = this.latestWorktree(input.cardId)
    if (!card || !wt) throw new Error('This card has no worktree yet; there is nothing to commit.')
    const { rule, why } = this.ruleFor(card.projectId, wt.branch)
    if (rule === 'never') throw new Error(`Agent commits are turned off on branch ${wt.branch} (${why}). Leave the changes in the worktree: the user does the committing.`)
    const message = input.message.trim()
    if (!message || message.length > 2000) throw new Error('mensagem must be a text of 1 to 2000 characters (first line = summary)')
    const profileId = (this.database.db.prepare('SELECT profile_id AS profileId FROM chats WHERE id = ?').get(input.chatId) as { profileId: string } | undefined)?.profileId ?? null
    const wanted = input.files?.map((item) => item.replace(/\\/g, '/').replace(/^\.\//, ''))
    const sources = this.database.db.prepare('SELECT id, project_id AS projectId, name, local_path AS path FROM project_sources WHERE project_id = ?').all(card.projectId) as Source[]
    const plan: Array<{ source: Source; dir: string; paths: string[] }> = []
    for (const member of this.members(card.projectId, input.cardId)) {
      const source = sources.find((item) => same(item.path, member.repoPath))
      if (!source || !await isDir(member.path)) continue
      if (input.repo && !(source.name.toLowerCase() === input.repo.toLowerCase() || source.path.toLowerCase().includes(input.repo.toLowerCase()))) continue
      const all = [...new Set((await this.listChanges(member.path)).map((file) => file.path))]
      const paths = wanted ? all.filter((path) => wanted.includes(path)) : all
      if (paths.length) plan.push({ source, dir: member.path, paths })
    }
    if (!plan.length) throw new Error(tm().git.nothingToCommitInPlan)
    // S13: segredo no que vai ser commitado barra o commit do agente (automático ou com pedido); o usuário decide pela página Git.
    const found = (await Promise.all(plan.map(async (item) => (await scanForSecrets(item.dir, item.paths)).map((hit) => `${hit.path}:${hit.line}`)))).flat()
    if (found.length) throw new Error(tm().git.secretsFound(found.slice(0, 5).join(', ')))
    if (rule === 'auto') {
      const done: string[] = []
      for (const item of plan) {
        const hash = await this.commitAt(item.dir, { message, paths: item.paths })
        if (profileId) this.database.db.prepare('INSERT OR REPLACE INTO git_commit_agents(repo_path, hash, profile_id) VALUES (?, ?, ?)').run(item.source.path, hash, profileId)
        done.push(`${item.source.name} (${hash.slice(0, 7)}, ${item.paths.length} file${item.paths.length > 1 ? 's' : ''})`)
      }
      return { rule, text: `Commit done (automatic rule): ${done.join('; ')}.` }
    }
    const insert = this.database.db.prepare(`INSERT INTO git_commit_requests(id, card_id, source_id, repo_name, repo_path, chat_id, profile_id, message, files, status, approval_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    const drop = this.database.db.prepare(`DELETE FROM git_commit_requests WHERE card_id = ? AND source_id = ? AND status = 'pending'`)
    for (const item of plan) {
      const requestId = randomUUID()
      // Auditoria unificada (S06): o pedido de commit também vira uma approval_record; a UX de decisão continua sendo a do card (`decide`).
      const approval = this.approvals.request({ kind: 'git-commit', subjectRef: requestId, payload: { message, files: item.paths, repo: item.source.name }, requestedActor: 'agent', cardId: input.cardId, projectId: card.projectId })
      this.database.db.transaction(() => {
        drop.run(input.cardId, item.source.id)
        insert.run(requestId, input.cardId, item.source.id, item.source.name, item.source.path, input.chatId, profileId, message, JSON.stringify(item.paths), approval.id, new Date().toISOString())
      })()
    }
    return { rule, text: `Commit request registered (${plan.map((item) => item.source.name).join(', ')}). The user authorizes it on the card; this branch's rule is to ask for permission. Do NOT run git commit. Continue with whatever does not depend on the commit.` }
  }

  async decide(requestId: string, decision: 'allow' | 'deny', message?: string): Promise<GitRequest> {
    const row = this.database.db.prepare('SELECT id, card_id AS cardId, source_id AS sourceId, repo_name AS repoName, message, files, status, profile_id AS profileId, hash, error, created_at AS createdAt, approval_id AS approvalId FROM git_commit_requests WHERE id = ?').get(requestId) as RequestRow | undefined
    if (!row) throw new Error(tm().git.commitRequestNotFound)
    if (row.status !== 'pending') return this.toRequest(row)
    // Auditoria unificada (S06): a decisão do card também fecha a approval_record, sem mudar a UX deste fluxo.
    if (row.approvalId) try { this.approvals.decide(row.approvalId, decision === 'allow') } catch { /* auditoria é best-effort; nunca bloqueia a decisão do usuário */ }
    const finish = (status: GitRequest['status'], extra: { hash?: string; error?: string } = {}): GitRequest => {
      this.database.db.prepare('UPDATE git_commit_requests SET status = ?, hash = ?, error = ?, decided_at = ? WHERE id = ?').run(status, extra.hash ?? null, extra.error ?? null, new Date().toISOString(), requestId)
      return this.toRequest({ ...row, status, hash: extra.hash ?? null, error: extra.error ?? null })
    }
    if (decision === 'deny') return finish('denied')
    try {
      const source = this.source(row.sourceId), target = await this.target(source, row.cardId)
      const current = new Set((await this.listChanges(target.dir)).map((file) => file.path))
      const paths = (JSON.parse(row.files) as string[]).filter((path) => current.has(path))
      if (!paths.length) throw new Error('Os arquivos do pedido já não têm alterações.')
      const hash = await this.commitAt(target.dir, { message: message?.trim() || row.message, paths })
      if (row.profileId) this.database.db.prepare('INSERT OR REPLACE INTO git_commit_agents(repo_path, hash, profile_id) VALUES (?, ?, ?)').run(source.path, hash, row.profileId)
      return finish('done', { hash })
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      // Sem alterações restantes não há o que tentar de novo; qualquer outro erro (identidade do Git, hook) deixa o pedido pendente para nova tentativa.
      if (text.includes('já não têm alterações')) finish('failed', { error: text })
      else this.database.db.prepare('UPDATE git_commit_requests SET error = ? WHERE id = ?').run(text, requestId)
      throw error
    }
  }
}

function parseNumstat(output: string): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>()
  for (const entry of output.split('\0').filter(Boolean)) {
    const [added = '0', removed = '0', ...rest] = entry.split('\t')
    map.set(rest.join('\t'), [Number.parseInt(added, 10) || 0, Number.parseInt(removed, 10) || 0])
  }
  return map
}

async function countLines(path: string): Promise<number> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > 1_000_000) return 0
    const buffer = await readFile(path)
    if (buffer.includes(0)) return 0
    const text = buffer.toString('utf8')
    return text ? text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0) : 0
  } catch { return 0 }
}
