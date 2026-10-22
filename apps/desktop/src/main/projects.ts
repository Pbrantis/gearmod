import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { defaultAgentColor, type CardRunState, type AgentProfile, BoardColumn, Card, Project, ProjectBoard, ProjectSource } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import { DocumentRepository } from './documents'
import { countTasks } from './tasks'
import type Database from 'better-sqlite3'

const execFileAsync = promisify(execFile)
const defaultColumns = [
  ['Backlog', 'backlog'], ['To do', 'todo'], ['Doing', 'doing'], ['Test', 'test'], ['Done', 'done']
] as const

export class GitService {
  async inspect(localPath: string): Promise<{ localPath: string; name: string; repositories: Array<{ localPath: string; name: string; currentBranch: string; branches: string[] }> }> {
    const folder = await stat(localPath).catch(() => undefined)
    if (!folder?.isDirectory()) throw new Error('A pasta do projeto não existe')
    const root = resolve(localPath)
    const direct = await this.repository(root)
    if (direct) return { localPath: root, name: basename(root), repositories: [direct] }
    const children = await readdir(root, { withFileTypes: true })
    const repositories = (await Promise.all(children.filter((item) => item.isDirectory() && item.name !== '.git').map((item) => this.repository(resolve(root, item.name))))).filter((item): item is NonNullable<typeof item> => Boolean(item))
    return { localPath: root, name: basename(root), repositories }
  }

  private async repository(localPath: string): Promise<{ localPath: string; name: string; currentBranch: string; branches: string[] } | null> {
    try {
      const [{ stdout: rootOutput }, { stdout: branchOutput }] = await Promise.all([
        execFileAsync('git', ['-C', localPath, 'rev-parse', '--show-toplevel']),
        execFileAsync('git', ['-C', localPath, 'branch', '--show-current'])
      ])
      const root = resolve(rootOutput.trim())
      const currentBranch = branchOutput.trim()
      if (!currentBranch) return null
      return { localPath: root, name: basename(root), currentBranch, branches: await this.branches(root) }
    } catch { return null }
  }

  async branches(localPath: string): Promise<string[]> {
    const folder = await stat(localPath).catch(() => undefined)
    if (!folder?.isDirectory()) throw new Error('A pasta do projeto não existe')
    try {
      const { stdout } = await execFileAsync('git', ['-C', localPath, 'for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'])
      const branches = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).map((item) => item.replace(/^origin\//, ''))
      return [...new Set(branches)].sort()
    } catch { throw new Error('A pasta selecionada não é um repositório Git acessível') }
  }

  async validate(localPath: string, baseBranch: string): Promise<void> {
    const branches = await this.branches(localPath)
    if (!branches.includes(baseBranch)) throw new Error(`A branch base “${baseBranch}” não existe no repositório`)
  }
}

export class ProfileRepository {
  constructor(private readonly database: AppDatabase, private readonly homeDir: string) {}

  setExecutable(id: string, path: string): void {
    this.database.db.prepare('UPDATE agent_profiles SET executable_path = ? WHERE id = ?').run(path, id)
  }

  create(input: { provider: 'codex' | 'claude'; label: string; scope: string; useExistingSession: boolean; color?: string }): AgentProfile {
    const id = randomUUID()
    const configDir = input.useExistingSession
      ? join(this.homeDir, input.provider === 'codex' ? '.codex' : '.claude')
      : join(this.homeDir, '.agentboard', 'profiles', id)
    if (input.useExistingSession) {
      const existing = this.database.db.prepare('SELECT 1 FROM agent_profiles WHERE provider = ? AND config_dir = ?').get(input.provider, configDir)
      if (existing) throw new Error(`A sessão atual de ${input.provider === 'codex' ? 'Codex' : 'Claude'} já foi adicionada`)
    }
    const now = new Date().toISOString()
    this.database.db.prepare(`INSERT INTO agent_profiles
      (id, provider, label, scope, color, config_dir, executable_path, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`).run(id, input.provider, input.label.trim(), input.scope, input.color ?? defaultAgentColor(input.provider), configDir, now, now)
    return this.get(id)
  }

  update(input: { profileId: string; label: string; scope: string; color?: string }): AgentProfile {
    const current = this.get(input.profileId)
    this.database.db.prepare('UPDATE agent_profiles SET label = ?, scope = ?, color = ?, updated_at = ? WHERE id = ?')
      .run(input.label.trim(), input.scope.trim(), input.color ?? current.color, new Date().toISOString(), input.profileId)
    return this.get(input.profileId)
  }

  /**
   * Remove o agente. Sem histórico, apaga de vez; com conversas, planos ou execuções, só desativa (`archived`): ele sai das listas e dos
   * projetos e não executa mais, mas continua aparecendo como "desativado" nos cards onde trabalhou. Com execução em andamento, recusa.
   */
  delete(id: string): { deleted: boolean; archived: boolean } {
    this.get(id)
    const running = this.database.db.prepare(`SELECT COALESCE(k.title, '') AS title FROM runs r LEFT JOIN cards k ON k.id = r.card_id WHERE r.profile_id = ? AND r.status IN ('queued', 'running')`).all(id) as Array<{ title: string }>
    if (running.length) throw new Error(`Este agente está executando agora (${running.map((item) => `“${item.title || 'chat livre'}”`).join(', ')}). Pare a execução antes de remover o agente.`)
    const references = ['plans', 'chats', 'runs'].some((table) => {
      const column = table === 'plans' ? 'agent_profile_id' : 'profile_id'
      return Boolean(this.database.db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`).get(id))
    })
    return this.database.db.transaction(() => {
      this.database.db.prepare('DELETE FROM project_agent_profiles WHERE profile_id = ?').run(id)
      this.database.db.prepare('DELETE FROM card_agent_settings WHERE profile_id = ?').run(id)
      if (references) {
        this.database.db.prepare('UPDATE agent_profiles SET enabled = 0, removed_at = ?, updated_at = ? WHERE id = ?').run(new Date().toISOString(), new Date().toISOString(), id)
        return { deleted: true, archived: true }
      }
      return { deleted: this.database.db.prepare('DELETE FROM agent_profiles WHERE id = ?').run(id).changes > 0, archived: false }
    })()
  }

  /** Agentes removidos (desativados) que ainda têm histórico; só para mostrar quem executou. */
  removed(): AgentProfile[] {
    return this.database.db.prepare(`SELECT id, provider, label, scope, color, config_dir AS configDir,
      executable_path AS executablePath FROM agent_profiles WHERE removed_at IS NOT NULL ORDER BY created_at`).all()
      .map((row) => ({ ...(row as Omit<AgentProfile, 'enabled'>), enabled: false }))
  }

  list(): AgentProfile[] {
    return this.database.db.prepare(`SELECT id, provider, label, scope, color, config_dir AS configDir,
      executable_path AS executablePath, enabled FROM agent_profiles WHERE enabled = 1 AND removed_at IS NULL ORDER BY created_at`).all()
      .map((row) => ({ ...(row as Omit<AgentProfile, 'enabled'> & { enabled: number }), enabled: Boolean((row as { enabled: number }).enabled) }))
  }

  get(id: string): AgentProfile {
    const profile = this.list().find((item) => item.id === id)
    if (!profile) throw new Error('Perfil não encontrado')
    return profile
  }
}

/**
 * Estado de execução do card, derivado da última run: em andamento, pausado (parado pelo usuário ou interrompido),
 * terminado (execução concluída e ainda não vista) ou planejando.
 */
export function cardRunState(db: Database.Database, cardId: string): CardRunState {
  const row = db.prepare(`SELECT r.id, r.status, r.ended_at AS endedAt, r.profile_id AS profileId, ch.purpose, k.viewed_at AS viewedAt
    FROM runs r JOIN chats ch ON ch.id = r.chat_id JOIN cards k ON k.id = r.card_id WHERE r.card_id = ? ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1`).get(cardId) as
    { id: string; status: string; endedAt: string | null; profileId: string; purpose: string; viewedAt: string | null } | undefined
  const none = { state: 'idle' as const, runId: null, profileId: null, purpose: null }
  if (!row) return none
  const purpose = row.purpose === 'test' ? 'test' as const : row.purpose === 'planning' ? 'planning' as const : 'execution' as const
  const base = { runId: row.id, profileId: row.profileId, purpose }
  const active = row.status === 'queued' || row.status === 'running'
  if (row.purpose === 'planning') return active ? { state: 'planning', ...base } : none
  if (active) return { state: 'running', ...base }
  if (row.status === 'completed') return row.endedAt && (!row.viewedAt || row.endedAt > row.viewedAt) ? { state: 'finished', ...base } : none
  return { state: 'paused', ...base }
}

export class ProjectRepository {
  constructor(private readonly database: AppDatabase, private readonly git: Pick<GitService, 'inspect' | 'validate'>) {}

  list(): Project[] {
    const rows = this.database.db.prepare(`SELECT id, name, local_path AS localPath, base_branch AS baseBranch,
      remote_provider AS remoteProvider, created_at AS createdAt, updated_at AS updatedAt FROM projects ORDER BY updated_at DESC`).all() as Omit<Project, 'allowedProfileIds' | 'sources' | 'activity'>[]
    const allowed = this.database.db.prepare('SELECT profile_id AS profileId FROM project_agent_profiles WHERE project_id = ? AND allowed = 1')
    const sources = this.database.db.prepare(`SELECT id, project_id AS projectId, name, local_path AS localPath,
      is_git_repository AS isGitRepository, current_branch AS currentBranch, sort_order AS sortOrder FROM project_sources WHERE project_id = ? ORDER BY sort_order`)
    const cards = this.database.db.prepare('SELECT id FROM cards WHERE project_id = ? AND archived_at IS NULL')
    return rows.map((row) => ({ ...row,
      activity: (cards.all(row.id) as { id: string }[]).reduce((total, card) => { const state = cardRunState(this.database.db, card.id).state; return { running: total.running + (state === 'running' ? 1 : 0), finished: total.finished + (state === 'finished' ? 1 : 0) } }, { running: 0, finished: 0 }),
      allowedProfileIds: (allowed.all(row.id) as { profileId: string }[]).map((item) => item.profileId),
      sources: (sources.all(row.id) as Array<Omit<ProjectSource, 'isGitRepository'> & { isGitRepository: number }>).map((item) => ({ ...item, isGitRepository: Boolean(item.isGitRepository) }))
    }))
  }

  get(id: string): Project {
    const project = this.list().find((item) => item.id === id)
    if (!project) throw new Error('Projeto não encontrado')
    return project
  }

  async create(input: { name?: string; sourcePaths?: string[]; profileIds?: string[]; localPath?: string; baseBranch?: string }): Promise<Project> {
    const paths = input.sourcePaths ?? (input.localPath ? [input.localPath] : [])
    if (!paths.length) throw new Error('Adicione pelo menos uma pasta de origem')
    const inspections = await Promise.all(paths.map((path) => this.git.inspect(path)))
    const first = inspections[0]!
    type DiscoveredSource = { localPath: string; name: string; currentBranch: string | null; branches: string[]; isGitRepository: boolean }
    const discovered: DiscoveredSource[] = inspections.flatMap<DiscoveredSource>((inspection) => inspection.repositories.length ? inspection.repositories.map((repository) => ({ ...repository, isGitRepository: true })) : [{ localPath: inspection.localPath, name: inspection.name, currentBranch: null, branches: [], isGitRepository: false }])
    const unique = [...new Map(discovered.map((source) => [source.localPath.toLocaleLowerCase(), source])).values()]
    const name = input.name?.trim() || first.name
    const baseBranch = input.baseBranch || unique.find((source) => source.isGitRepository)?.currentBranch || ''
    const selectedProfiles = input.profileIds ?? []
    const now = new Date().toISOString(), id = randomUUID()
    const create = this.database.db.transaction(() => {
      this.database.db.prepare(`INSERT INTO projects(id, name, local_path, base_branch, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(id, name, first.localPath, baseBranch, now, now)
      const insertSource = this.database.db.prepare(`INSERT INTO project_sources(id, project_id, name, local_path, is_git_repository, current_branch, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      unique.forEach((source, index) => insertSource.run(randomUUID(), id, source.name, source.localPath, source.isGitRepository ? 1 : 0, source.currentBranch, index))
      const insertColumn = this.database.db.prepare(`INSERT INTO board_columns(id, project_id, label, sort_order, semantic_state, is_default)
        VALUES (?, ?, ?, ?, ?, 1)`)
      defaultColumns.forEach(([label, state], index) => insertColumn.run(randomUUID(), id, label, index, state))
      const allow = this.database.db.prepare('INSERT INTO project_agent_profiles(project_id, profile_id, allowed) VALUES (?, ?, 1)')
      selectedProfiles.forEach((profileId) => allow.run(id, profileId))
    })
    create()
    return this.get(id)
  }

  async update(input: { projectId: string; name: string }): Promise<Project> {
    const result = this.database.db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run(input.name, new Date().toISOString(), input.projectId)
    if (!result.changes) throw new Error('Projeto não encontrado')
    return this.get(input.projectId)
  }

  setProfiles(projectId: string, profileIds: string[]): Project {
    this.get(projectId)
    const known = new Set((this.database.db.prepare('SELECT id FROM agent_profiles WHERE enabled = 1').all() as { id: string }[]).map((item) => item.id))
    if (profileIds.some((id) => !known.has(id))) throw new Error('Perfil desconhecido ou desabilitado')
    const update = this.database.db.transaction(() => {
      this.database.db.prepare('DELETE FROM project_agent_profiles WHERE project_id = ?').run(projectId)
      const insert = this.database.db.prepare('INSERT INTO project_agent_profiles(project_id, profile_id, allowed) VALUES (?, ?, 1)')
      profileIds.forEach((id) => insert.run(projectId, id))
      this.database.db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), projectId)
    })
    update()
    return this.get(projectId)
  }
}

/** Dentro de cada coluna os cards ficam por prioridade (urgente primeiro) e, na mesma prioridade, pela ordem manual. */
const priorityRank = `CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`

export class BoardRepository {
  readonly documents: DocumentRepository

  constructor(private readonly database: AppDatabase, private readonly projects: ProjectRepository) { this.documents = new DocumentRepository(database) }

  get(projectId: string): ProjectBoard {
    const columns = (this.database.db.prepare(`SELECT id, project_id AS projectId, label, sort_order AS sortOrder,
      semantic_state AS semanticState, is_default AS isDefault FROM board_columns WHERE project_id = ? AND semantic_state <> 'mr' ORDER BY sort_order`).all(projectId) as Array<Omit<BoardColumn, 'isDefault'> & { isDefault: number }>)
      .map((item) => ({ ...item, isDefault: Boolean(item.isDefault) }))
    const rows = this.database.db.prepare(`SELECT id FROM cards WHERE project_id = ? ORDER BY ${priorityRank}, order_key`).all(projectId) as { id: string }[]
    return { project: this.projects.get(projectId), columns, cards: rows.map((row) => this.card(row.id)) }
  }

  card(cardId: string): Card {
    const row = this.database.db.prepare(`SELECT id, project_id AS projectId, column_id AS columnId, source_id AS sourceId, type, title, description,
      priority, order_key AS orderKey, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt
      FROM cards WHERE id = ?`).get(cardId) as Omit<Card, 'acceptanceCriteria' | 'tasks' | 'run' | 'hasPlan' | 'planningOpen' | 'workspace' | 'pending' | 'execProfileId' | 'execModel'> | undefined
    if (!row) throw new Error('Card não encontrado')
    const criteria = (this.database.db.prepare(`SELECT id, card_id AS cardId, body, checked, sort_order AS sortOrder
      FROM card_acceptance_criteria WHERE card_id = ? ORDER BY sort_order`).all(cardId) as Array<{ id: string; cardId: string; body: string; checked: number; sortOrder: number }>)
      .map((item) => ({ ...item, checked: Boolean(item.checked) }))
    const tasks = countTasks(this.documents.read(cardId, 'tasks')), run = cardRunState(this.database.db, cardId), hasPlan = Boolean(this.database.db.prepare('SELECT plan_ready_at FROM cards WHERE id = ?').pluck().get(cardId))
    // Planejamento aberto: começou a planejar (card sem título ou com chat de planejamento) e ainda não saiu nada dele.
    const hasPlanningChat = Boolean(this.database.db.prepare("SELECT 1 FROM chats WHERE card_id = ? AND purpose = 'planning' LIMIT 1").get(cardId))
    const planningOpen = run.state === 'idle' && !hasPlan && tasks.total === 0 && !row.description.trim() && !this.documents.read(cardId, 'especificacao').trim() && (!row.title.trim() || hasPlanningChat)
    // Branch e worktree em que o card trabalha (a mais recente ativa), para mostrar no card.
    const workspace = (this.database.db.prepare("SELECT branch, base_ref AS baseRef, path FROM worktrees WHERE card_id = ? AND cleanup_state = 'active' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(cardId) as { branch: string; baseRef: string; path: string } | undefined) ?? null
    return { ...row, acceptanceCriteria: criteria, tasks, run, hasPlan, planningOpen, workspace, pending: this.pendingCounts(cardId), ...this.execSettings(cardId) }
  }

  private pendingCounts(cardId: string): { changes: number; questions: number } {
    const count = (sql: string): number => (this.database.db.prepare(sql).get(cardId) as { value: number }).value
    return { changes: count("SELECT COUNT(*) AS value FROM card_changes WHERE card_id = ? AND status = 'pending'"), questions: count("SELECT COUNT(*) AS value FROM card_questions WHERE card_id = ? AND status = 'user'") }
  }

  private execSettings(cardId: string): { execProfileId: string | null; execModel: string | null } {
    const row = this.database.db.prepare("SELECT profile_id AS profileId, model FROM card_agent_settings WHERE card_id = ? AND purpose = 'execution'").get(cardId) as { profileId: string; model: string | null } | undefined
    return { execProfileId: row?.profileId ?? null, execModel: row?.model ?? null }
  }

  create(input: { projectId: string; columnId: string; sourceId?: string | null; type: string; title: string; description: string; priority: string; acceptanceCriteria: { body: string; checked: boolean }[] }): Card {
    this.assertColumn(input.projectId, input.columnId)
    const sourceId = input.sourceId ?? (this.database.db.prepare('SELECT id FROM project_sources WHERE project_id = ? AND is_git_repository = 1 ORDER BY sort_order LIMIT 1').get(input.projectId) as { id: string } | undefined)?.id ?? null
    if (sourceId && !this.database.db.prepare('SELECT 1 FROM project_sources WHERE id = ? AND project_id = ?').get(sourceId, input.projectId)) throw new Error('Pasta de origem não pertence ao projeto')
    const id = randomUUID(), now = new Date().toISOString()
    const order = (this.database.db.prepare('SELECT COALESCE(MAX(order_key), 0) + 1024 AS value FROM cards WHERE column_id = ?').get(input.columnId) as { value: number }).value
    const create = this.database.db.transaction(() => {
      this.database.db.prepare(`INSERT INTO cards(id, project_id, column_id, source_id, type, title, description, priority, order_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.projectId, input.columnId, sourceId, input.type, input.title, input.description, input.priority, order, now, now)
      this.replaceCriteria(id, input.acceptanceCriteria)
    })
    create()
    if (input.description.trim()) this.documents.write(id, 'resumo', input.description, 'user')
    if (input.acceptanceCriteria.length) this.documents.write(id, 'tasks', input.acceptanceCriteria.map((item, index) => `- [${item.checked ? 'x' : ' '}] T${String(index + 1).padStart(3, '0')} ${item.body}`).join('\n'), 'user')
    return this.card(id)
  }

  baseBranch(cardId: string): string | null {
    return (this.database.db.prepare('SELECT base_branch FROM cards WHERE id = ?').pluck().get(cardId) as string | null | undefined) ?? null
  }

  setBaseBranch(cardId: string, branch: string | null): void {
    this.database.db.prepare('UPDATE cards SET base_branch = ? WHERE id = ?').run(branch, cardId)
  }

  /** O planejador só declara o plano concluído com Especificação, Plano e Tasks escritos; devolve o que falta. */
  markPlanReady(cardId: string): string[] {
    const missing = (['especificacao', 'plano', 'tasks'] as const).filter((kind) => !this.documents.read(cardId, kind).trim())
    if (!missing.length && countTasks(this.documents.read(cardId, 'tasks')).total === 0) missing.push('tasks')
    if (!missing.length) this.database.db.prepare("UPDATE cards SET plan_ready_at = COALESCE(plan_ready_at, ?) WHERE id = ?").run(new Date().toISOString(), cardId)
    return missing
  }

  update(input: { cardId: string; sourceId?: string | null; type: string; title: string; description: string; priority: string; acceptanceCriteria: { body: string; checked: boolean }[] }): Card {
    const current = this.card(input.cardId)
    const sourceId = input.sourceId === undefined ? current.sourceId : input.sourceId
    if (sourceId && !this.database.db.prepare('SELECT 1 FROM project_sources WHERE id = ? AND project_id = ?').get(sourceId, current.projectId)) throw new Error('Pasta de origem não pertence ao projeto')
    const update = this.database.db.transaction(() => {
      this.database.db.prepare('UPDATE cards SET source_id = ?, type = ?, title = ?, description = ?, priority = ?, updated_at = ? WHERE id = ?')
        .run(sourceId, input.type, input.title, input.description, input.priority, new Date().toISOString(), input.cardId)
      this.database.db.prepare('DELETE FROM card_acceptance_criteria WHERE card_id = ?').run(input.cardId)
      this.replaceCriteria(input.cardId, input.acceptanceCriteria)
    })
    update()
    if (input.description !== current.description) this.documents.write(input.cardId, 'resumo', input.description, 'user')
    return this.card(input.cardId)
  }

  move(cardId: string, columnId: string, beforeCardId: string | null, actor: 'user' | 'agent' = 'user'): Card {
    const current = this.card(cardId)
    this.assertColumn(current.projectId, columnId)
    const destination = this.database.db.prepare('SELECT semantic_state AS state FROM board_columns WHERE id = ?').get(columnId) as { state: string }
    if (destination.state === 'done') this.assertDoneGate(cardId)
    let orderKey: number, priority = current.priority
    if (beforeCardId) {
      const before = this.card(beforeCardId)
      if (before.columnId !== columnId) throw new Error('Card de referência pertence a outra coluna')
      priority = before.priority
      const prior = this.database.db.prepare('SELECT MAX(order_key) AS value FROM cards WHERE column_id = ? AND priority = ? AND order_key < ? AND id <> ?').get(columnId, priority, before.orderKey, cardId) as { value: number | null }
      orderKey = prior.value === null ? before.orderKey - 1024 : (prior.value + before.orderKey) / 2
    } else {
      orderKey = (this.database.db.prepare('SELECT COALESCE(MAX(order_key), 0) + 1024 AS value FROM cards WHERE column_id = ? AND id <> ?').get(columnId, cardId) as { value: number }).value
    }
    const now = new Date().toISOString()
    const move = this.database.db.transaction(() => {
      this.database.db.prepare('UPDATE cards SET column_id = ?, order_key = ?, priority = ?, updated_at = ? WHERE id = ?').run(columnId, orderKey, priority, now, cardId)
      if (current.columnId !== columnId) this.database.db.prepare(`INSERT INTO column_history(id, card_id, from_column_id, to_column_id, changed_at, actor, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), cardId, current.columnId, columnId, now, actor, actor === 'agent' ? 'agent-request' : 'kanban-move')
    })
    move(); return this.card(cardId)
  }

  archive(cardId: string, restore = false): Card {
    this.card(cardId)
    this.database.db.prepare('UPDATE cards SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(restore ? null : new Date().toISOString(), new Date().toISOString(), cardId)
    return this.card(cardId)
  }

  markViewed(cardId: string): Card {
    this.card(cardId)
    this.database.db.prepare('UPDATE cards SET viewed_at = ? WHERE id = ?').run(new Date().toISOString(), cardId)
    return this.card(cardId)
  }

  delete(cardId: string): boolean {
    this.card(cardId)
    return this.database.db.prepare('DELETE FROM cards WHERE id = ?').run(cardId).changes > 0
  }

  private assertColumn(projectId: string, columnId: string): void {
    const row = this.database.db.prepare('SELECT 1 FROM board_columns WHERE id = ? AND project_id = ?').get(columnId, projectId)
    if (!row) throw new Error('Coluna não pertence ao projeto')
  }

  private replaceCriteria(cardId: string, criteria: { body: string; checked: boolean }[]): void {
    const insert = this.database.db.prepare(`INSERT INTO card_acceptance_criteria(id, card_id, body, checked, sort_order) VALUES (?, ?, ?, ?, ?)`)
    criteria.forEach((item, index) => insert.run(randomUUID(), cardId, item.body, item.checked ? 1 : 0, index))
  }

  private assertDoneGate(cardId: string): void {
    const test = this.database.db.prepare('SELECT status FROM test_runs WHERE card_id = ? ORDER BY started_at DESC LIMIT 1').get(cardId) as { status: string } | undefined
    if (test?.status !== 'passed') throw new Error('Done exige um teste aprovado')
    const review = this.database.db.prepare('SELECT state FROM reviews WHERE card_id = ? ORDER BY updated_at DESC LIMIT 1').get(cardId) as { state: string } | undefined
    if (!review || !['approved', 'merged'].includes(review.state)) throw new Error('Done exige revisão aprovada ou merge confirmado')
  }
}
