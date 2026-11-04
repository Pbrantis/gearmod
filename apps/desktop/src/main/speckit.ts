import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { PermissionMode } from '@gearmod/contracts'
import type { Approval, ApprovalService } from './approvals'
import { specKitSkill, type SpecKitStage } from './spec-tools'
import { setTaskChecked } from './tasks'
import { tm } from './i18n'

/**
 * Native GitHub Spec Kit integration (ADR-018). GearMod does not imitate templates or write the method's artifacts: it triggers the
 * installed skill (`/speckit-*` in Claude, `$speckit-*` in Codex) in the card's worktree, ties the card's feature through the
 * v1.2.5 mechanism (`.specify/feature.json` + `SPECIFY_FEATURE_DIRECTORY`, read in `scripts/bash/common.sh`) and only READS what the skills generated.
 */
export type Provider = 'codex' | 'claude'
/** Spec Kit installs skills only for Claude Code and Codex in this app; Gemini does not have a native integration yet. */
export const specKitProvider = (provider: Provider | 'gemini'): Provider | null => (provider === 'gemini' ? null : provider)
export const specKitGeminiMessage = (): string => tm().speckit.geminiUnsupported
export type SpecKitPermission = 'manual' | 'free'
export const specKitPermissionKind = 'speckit-permission'
export const specKitMoveKind = 'speckit-implement-move'
export const specKitStartKind = 'speckit-implement-start'
const farFuture = 10 * 365 * 24 * 60 * 60_000

const slug = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'card'

/** Folder of the card's feature inside the worktree (relative to the repository root). Does not depend on the branch name. */
export function specKitFeatureDir(cardId: string, title: string): string { return `specs/${cardId.slice(0, 8)}-${slug(title)}` }

/** `/speckit-<step>` (Claude) or `$speckit-<step>` (Codex), followed by the request. */
export function specKitCommand(provider: Provider, stage: SpecKitStage, request: string): string {
  return `${provider === 'claude' ? '/' : '$'}speckit-${stage}${request.trim() ? ` ${request.trim()}` : ''}`
}

/** Step requested in the text (`/speckit-plan`, `$speckit-tasks`...); `null` if the text does not invoke a Spec Kit skill. */
export function specKitStageOf(prompt: string): SpecKitStage | null {
  const found = /(?:^|[\s/\\$])speckit[-.](specify|clarify|plan|checklist|tasks|analyze|implement)(?:\b|$)/i.exec(prompt)?.[1]?.toLowerCase()
  return (found as SpecKitStage | undefined) ?? null
}

/** Next step the user can request; the app never triggers it on its own. */
export const specKitNextStage: Record<SpecKitStage, SpecKitStage | null> = { specify: 'plan', clarify: 'plan', checklist: 'tasks', analyze: 'implement', plan: 'tasks', tasks: 'implement', implement: null }

/** Agent mode for the user's choice. Each provider has its own semantics; the texts below tell the truth about each one. */
export function specKitMode(provider: Provider, permission: SpecKitPermission): PermissionMode {
  if (provider === 'claude') return permission === 'manual' ? 'manual' : 'accept_edits'
  return permission === 'manual' ? 'read_only' : 'auto'
}

export function specKitPermissionText(provider: Provider, permission: SpecKitPermission): string {
  if (provider === 'claude') return permission === 'manual'
    ? tm().speckit.permClaudeManual
    : tm().speckit.permClaudeAcceptEdits
  return permission === 'manual'
    ? tm().speckit.permCodexReadOnly
    : tm().speckit.permCodexAuto
}

export function specKitMissingSkill(provider: Provider, stage: SpecKitStage): string {
  const folder = provider === 'claude' ? '.claude/skills' : '.agents/skills'
  return tm().speckit.missingSkill(stage, provider === 'claude' ? 'Claude Code' : 'Codex', folder, provider)
}

/** The method is only usable with the project's configured folder containing `.specify`. */
export function specKitAvailability(root: string | null): { enabled: boolean; reason: string | null } {
  if (!root) return { enabled: false, reason: tm().speckit.configureToEnable }
  if (!existsSync(join(root, '.specify'))) return { enabled: false, reason: tm().speckit.configureToEnable }
  return { enabled: true, reason: null }
}

/** Ties the feature to the card: writes `.specify/feature.json` and creates the feature folder in the worktree. Only in the Spec Kit repository. */
export function bindSpecKitFeature(worktree: string, featureDir: string): void {
  const safe = resolve(worktree, featureDir)
  if (relative(resolve(worktree), safe).startsWith('..')) throw new Error(tm().speckit.featureFolderOutsideWorktree)
  mkdirSync(join(worktree, '.specify'), { recursive: true }); mkdirSync(safe, { recursive: true })
  writeFileSync(join(worktree, '.specify', 'feature.json'), `${JSON.stringify({ feature_directory: featureDir })}\n`, 'utf8')
}

const fileHasText = (path: string): boolean => { try { return readFileSync(path, 'utf8').trim().length > 0 } catch { return false } }

/** Real artifacts of the card's feature; artifacts of other features (`specs/other/…`) never count. */
export function specKitArtifacts(worktree: string, featureDir: string): { spec: string | null; plan: string | null; tasks: string | null; ready: boolean } {
  const pick = (name: string): string | null => { const path = join(worktree, featureDir, name); return fileHasText(path) ? path : null }
  const spec = pick('spec.md'), plan = pick('plan.md'), tasks = pick('tasks.md')
  return { spec, plan, tasks, ready: Boolean(spec && plan && tasks) }
}

export type SpecKitDeps = {
  history: { sddMethod(cardId: string): 'native' | 'speckit' | 'openspec' | 'custom' | null; workflow(cardId: string): string | null }
  board: { card(cardId: string): { id: string; projectId: string; title: string }; get(projectId: string): { columns: Array<{ id: string; label: string; semanticState: string }> }; setSpecKitReady?(cardId: string, ready: boolean): void; documents?: { write(cardId: string, kind: 'especificacao' | 'plano' | 'tasks', contentMd: string, actor: 'system'): unknown } }
  worktrees: { repositories(cardId: string): Array<{ repoPath: string; path: string; status: string }> }
  approvals: Pick<ApprovalService, 'request' | 'list' | 'decide'>
  root(projectId: string): string | null
}

export type SpecKitPrepared = { cwd: string; mode: PermissionMode; env: Record<string, string>; featureDir: string; prompt: string }

/** Visible request for the first step: the native speckit-specify skill with the understanding and decisions already recorded on the card. */
export function specKitSpecifyRequest(provider: Provider, card: { title: string; description: string }, brief: { objetivo: string; escopo: string[]; exclusoes: string[]; criterios: string[]; pendencias: string[] } | null, decisions: Array<{ number: number; statement: string }>): string {
  const list = (title: string, items: string[]): string => items.length ? `\n${title}: ${items.join('; ')}` : ''
  const context = [`Card: ${card.title}`, card.description.trim() ? `Description: ${card.description.trim()}` : '', brief ? `Goal: ${brief.objetivo}${list('Scope', brief.escopo)}${list('Out of scope', brief.exclusoes)}${list('Criteria', brief.criterios)}${list('Open items', brief.pendencias)}` : '', decisions.length ? `Current decisions:\n${decisions.map((item) => `- D${String(item.number).padStart(3, '0')} ${item.statement}`).join('\n')}` : ''].filter(Boolean).join('\n')
  return specKitCommand(provider, 'specify', context)
}

export class SpecKitRuntime {
  constructor(private readonly deps: SpecKitDeps) {}

  /** Does the card use Spec Kit in the SDD flow? (the assessment is per card, not per project). */
  active(cardId: string): boolean { return this.deps.history.workflow(cardId) === 'sdd' && this.deps.history.sddMethod(cardId) === 'speckit' }

  availability(projectId: string): { enabled: boolean; reason: string | null } { return specKitAvailability(this.deps.root(projectId)) }

  /** The card's last permission choice (the newest approved one); `null` while the user has not chosen. */
  permission(cardId: string): SpecKitPermission | null {
    const latest = this.deps.approvals.list(cardId).find((item) => item.kind === specKitPermissionKind && item.status === 'approved')
    return latest?.note === 'manual' || latest?.note === 'free' ? latest.note : null
  }

  /** Pending choice request (for the chat to show the card); creates one if the card uses Spec Kit and has not chosen yet. */
  permissionRequest(cardId: string): Approval | null {
    if (!this.active(cardId) || this.permission(cardId)) return null
    const open = this.deps.approvals.list(cardId).find((item) => item.kind === specKitPermissionKind && item.status === 'requested')
    if (open) return open
    const card = this.deps.board.card(cardId)
    return this.deps.approvals.request({ kind: specKitPermissionKind, subjectRef: cardId, payload: {}, requestedActor: 'system', cardId, projectId: card.projectId, expiresInMs: farFuture })
  }

  /** Records the choice (or a later mode change). Each choice becomes a record; the most recent one applies. */
  choose(cardId: string, permission: SpecKitPermission): SpecKitPermission {
    const card = this.deps.board.card(cardId)
    const pending = this.deps.approvals.list(cardId).find((item) => item.kind === specKitPermissionKind && item.status === 'requested')
    const request = pending ?? this.deps.approvals.request({ kind: specKitPermissionKind, subjectRef: cardId, payload: {}, requestedActor: 'system', cardId, projectId: card.projectId, expiresInMs: farFuture })
    this.deps.approvals.decide(request.id, true, permission)
    return permission
  }

  /** Blocks the start before creating the run: without a permission choice the first skill does not start. */
  assertCanStart(cardId: string): void {
    if (!this.active(cardId)) return
    const card = this.deps.board.card(cardId), availability = this.availability(card.projectId)
    if (!availability.enabled) throw new Error(availability.reason ?? tm().speckit.speckitNotConfigured)
    if (!this.permission(cardId)) throw new Error(tm().speckit.chooseSkillWritePermission)
  }

  /** Repository in the worktree that contains Spec Kit (the one in the configured folder); with only one repository, that one. */
  repository(cardId: string): { repoPath: string; path: string } {
    const root = this.deps.root(this.deps.board.card(cardId).projectId)
    const repos = this.deps.worktrees.repositories(cardId).filter((repo) => repo.status === 'active')
    const normal = (value: string): string => resolve(value).toLowerCase()
    const match = root ? repos.find((repo) => { const base = normal(repo.repoPath), target = normal(root); return target === base || target.startsWith(base + sep) }) : null
    const chosen = match ?? (repos.length === 1 ? repos[0] : null)
    if (!chosen) throw new Error(tm().speckit.speckitRepoNotInWorktree)
    return chosen
  }

  /** Before each planning chat run: checks the skill IN the worktree, ties the feature and sets the mode. Never switches method. */
  prepare(input: { cardId: string; provider: Provider | 'gemini'; prompt: string }): SpecKitPrepared | null {
    if (!this.active(input.cardId)) return null
    const provider = specKitProvider(input.provider)
    if (!provider) throw new Error(specKitGeminiMessage())
    this.assertCanStart(input.cardId)
    const explicit = specKitStageOf(input.prompt)
    if (explicit === 'implement') throw new Error(tm().speckit.implementSkillOnlyInImplementationChat)
    const repo = this.repository(input.cardId), card = this.deps.board.card(input.cardId), featureDir = specKitFeatureDir(card.id, card.title)
    if (explicit && !specKitSkill(repo.path, provider, explicit)) throw new Error(specKitMissingSkill(provider, explicit))
    bindSpecKitFeature(repo.path, featureDir)
    const prompt = input.prompt
    return { cwd: repo.path, mode: specKitMode(provider, this.permission(input.cardId)!), env: { SPECIFY_FEATURE_DIRECTORY: featureDir }, featureDir, prompt }
  }

  /**
   * Before each implementation chat run: speckit-implement needs the Spec Kit repository as its working folder
   * (skills, .specify and the card's feature), with the worktree's other repositories unlocked for editing. Without Spec Kit on the card, `null`.
   */
  prepareImplementation(cardId: string): { cwd: string; env: Record<string, string>; addDirs: string[] } | null {
    if (!this.active(cardId)) return null
    const repo = this.repository(cardId), card = this.deps.board.card(cardId), featureDir = specKitFeatureDir(card.id, card.title)
    bindSpecKitFeature(repo.path, featureDir)
    const addDirs = this.deps.worktrees.repositories(cardId).filter((item) => item.status === 'active' && item.path !== repo.path).map((item) => item.path)
    return { cwd: repo.path, env: { SPECIFY_FEATURE_DIRECTORY: featureDir }, addDirs }
  }

  /** Same as the card seeing the planning: REAL artifacts of the card's feature, no copy. */
  artifacts(cardId: string): { featureDir: string; spec: string | null; plan: string | null; tasks: string | null; ready: boolean } {
    const card = this.deps.board.card(cardId), featureDir = specKitFeatureDir(card.id, card.title)
    return { featureDir, ...specKitArtifacts(this.repository(cardId).path, featureDir) }
  }

  /** Mirrors the feature's REAL files into the card's documents (Specification, Plan, Tasks), so the card tabs show what Spec Kit generated. Only reads the files; never changes them. */
  sync(cardId: string): void {
    if (!this.active(cardId)) return
    let found: ReturnType<SpecKitRuntime['artifacts']>
    try { found = this.artifacts(cardId) } catch { return }
    for (const [kind, path] of [['especificacao', found.spec], ['plano', found.plan], ['tasks', found.tasks]] as const) {
      if (!path) continue
      try { this.deps.board.documents?.write(cardId, kind, readFileSync(path, 'utf8'), 'system') } catch { /* format the tabs do not accept: the real file remains the source */ }
    }
    // "Plan ready" only while the three files of the card's feature exist; anything else clears the badge.
    try { this.deps.board.setSpecKitReady?.(cardId, found.ready) } catch { /* no database: nothing to sync */ }
  }

  /**
   * Checks (or unchecks) a line of the feature's REAL tasks.md, which is the source of the Tasks tab, and mirrors it back to the card.
   * Without this the mark would stay only in the database and the next sync would erase it. `false` = the card does not use Spec Kit or has no tasks.md yet.
   */
  setTask(cardId: string, line: number, checked: boolean): boolean {
    if (!this.active(cardId)) return false
    const path = this.artifacts(cardId).tasks
    if (!path) return false
    writeFileSync(path, setTaskChecked(readFileSync(path, 'utf8'), line, checked), 'utf8')
    this.sync(cardId)
    return true
  }

  /** After the run: if the card feature's spec, plan and tasks exist, planning is ready. Returns the next-step notice. */
  afterRun(input: { cardId: string; prompt: string }): string | null {
    if (!this.active(input.cardId)) return null
    this.sync(input.cardId)
    return null // the skill itself says when it finished; the app does not write "step completed" (the step may have stopped at a question)
  }

  /** Any permission requested by an implementation skill is denied in planning (the text barrier is not enough on its own). */
  denies(details: Record<string, unknown>): boolean { return /speckit[-.]implement/i.test(JSON.stringify(details)) }

  private open(cardId: string, kind: string): Approval | null { return this.deps.approvals.list(cardId).find((item) => item.kind === kind && item.status === 'requested') ?? null }
  moveRequest(cardId: string): Approval | null { return this.open(cardId, specKitMoveKind) }
  startRequest(cardId: string): Approval | null { return this.open(cardId, specKitStartKind) }

  /** Move card when implementation is requested in planning (existing approval mechanism). Nothing moves before approval. */
  requestMove(cardId: string): Approval {
    const open = this.moveRequest(cardId); if (open) return open
    const card = this.deps.board.card(cardId), column = this.deps.board.get(card.projectId).columns.find((item) => item.semanticState === 'doing')
    if (!column) throw new Error(tm().speckit.noExecutionColumn)
    return this.deps.approvals.request({ kind: specKitMoveKind, subjectRef: cardId, payload: { columnId: column.id, columnLabel: column.label }, requestedActor: 'agent', cardId, projectId: card.projectId })
  }

  /** After "Move and implement": pending confirmation in the implementation chat; the agent is only chosen on the start button. */
  requestStart(cardId: string): Approval {
    const open = this.startRequest(cardId); if (open) return open
    const card = this.deps.board.card(cardId)
    return this.deps.approvals.request({ kind: specKitStartKind, subjectRef: cardId, payload: { skill: 'speckit-implement' }, requestedActor: 'system', cardId, projectId: card.projectId, expiresInMs: farFuture })
  }

  /** Implementation was started by the start button: the pending confirmation ceases to exist. */
  settleStart(cardId: string): void { const open = this.startRequest(cardId); if (open) this.deps.approvals.decide(open.id, true, 'started') }
}
