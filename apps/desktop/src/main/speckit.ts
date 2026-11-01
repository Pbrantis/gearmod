import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { PermissionMode } from '@agentboard/contracts'
import type { Approval, ApprovalService } from './approvals'
import { specKitSkill, type SpecKitStage } from './spec-tools'
import { tm } from './i18n'

/**
 * Integração nativa do GitHub Spec Kit (ADR-018). O AgentBoard não imita modelos nem grava artefatos do método: dispara a skill
 * instalada (`/speckit-*` no Claude, `$speckit-*` no Codex) na worktree do card, amarra a feature do card pelo mecanismo da
 * v1.2.5 (`.specify/feature.json` + `SPECIFY_FEATURE_DIRECTORY`, lidos em `scripts/bash/common.sh`) e só LÊ o que as skills geraram.
 */
export type Provider = 'codex' | 'claude'
/** O Spec Kit instala skills só para Claude Code e Codex neste app; o Gemini ainda não tem integração nativa. */
export const specKitProvider = (provider: Provider | 'gemini'): Provider | null => (provider === 'gemini' ? null : provider)
export const specKitGeminiMessage = (): string => tm().speckit.geminiUnsupported
export type SpecKitPermission = 'manual' | 'free'
export const specKitPermissionKind = 'speckit-permission'
export const specKitMoveKind = 'speckit-implement-move'
export const specKitStartKind = 'speckit-implement-start'
const farFuture = 10 * 365 * 24 * 60 * 60_000

const slug = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'card'

/** Pasta da feature do card dentro da worktree (relativa à raiz do repositório). Não depende do nome da branch. */
export function specKitFeatureDir(cardId: string, title: string): string { return `specs/${cardId.slice(0, 8)}-${slug(title)}` }

/** `/speckit-<etapa>` (Claude) ou `$speckit-<etapa>` (Codex), seguido do pedido. */
export function specKitCommand(provider: Provider, stage: SpecKitStage, request: string): string {
  return `${provider === 'claude' ? '/' : '$'}speckit-${stage}${request.trim() ? ` ${request.trim()}` : ''}`
}

/** Etapa pedida no texto (`/speckit-plan`, `$speckit-tasks`...); `null` se o texto não invoca uma skill do Spec Kit. */
export function specKitStageOf(prompt: string): SpecKitStage | null {
  const found = /(?:^|[\s/\\$])speckit[-.](specify|clarify|plan|checklist|tasks|analyze|implement)(?:\b|$)/i.exec(prompt)?.[1]?.toLowerCase()
  return (found as SpecKitStage | undefined) ?? null
}

/** Próxima etapa que o usuário pode pedir; o app nunca a dispara sozinho. */
export const specKitNextStage: Record<SpecKitStage, SpecKitStage | null> = { specify: 'plan', clarify: 'plan', checklist: 'tasks', analyze: 'implement', plan: 'tasks', tasks: 'implement', implement: null }

export function specKitNextNotice(stage: SpecKitStage): string {
  const next = specKitNextStage[stage]
  if (!next) return `Etapa ${stage} concluída.`
  return next === 'implement'
    ? 'Etapa tasks concluída. O planejamento está completo quando especificação, plano e tasks existirem; a implementação acontece no chat de implementação (peça “implementar” aqui para mover o card).'
    : `Etapa ${stage} concluída. A próxima é ${next}${stage === 'specify' ? ' (ou clarify, para esclarecer pontos em aberto antes)' : ''}: peça para continuar quando quiser (nada avança sozinho).`
}

/** Modo do agente para a escolha do usuário. Cada provedor tem semântica própria; os textos abaixo dizem a verdade de cada um. */
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

/** O método só é utilizável com a pasta configurada no projeto contendo `.specify`. */
export function specKitAvailability(root: string | null): { enabled: boolean; reason: string | null } {
  if (!root) return { enabled: false, reason: tm().speckit.configureToEnable }
  if (!existsSync(join(root, '.specify'))) return { enabled: false, reason: tm().speckit.configureToEnable }
  return { enabled: true, reason: null }
}

/** Amarra a feature ao card: grava `.specify/feature.json` e cria a pasta da feature na worktree. Só no repositório do Spec Kit. */
export function bindSpecKitFeature(worktree: string, featureDir: string): void {
  const safe = resolve(worktree, featureDir)
  if (relative(resolve(worktree), safe).startsWith('..')) throw new Error(tm().speckit.featureFolderOutsideWorktree)
  mkdirSync(join(worktree, '.specify'), { recursive: true }); mkdirSync(safe, { recursive: true })
  writeFileSync(join(worktree, '.specify', 'feature.json'), `${JSON.stringify({ feature_directory: featureDir })}\n`, 'utf8')
}

const fileHasText = (path: string): boolean => { try { return readFileSync(path, 'utf8').trim().length > 0 } catch { return false } }

/** Artefatos reais da feature do card; artefatos de outras features (`specs/outra/…`) nunca contam. */
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

/** Pedido visível da primeira etapa: a skill nativa speckit-specify com o entendimento e as decisões já registrados no card. */
export function specKitSpecifyRequest(provider: Provider, card: { title: string; description: string }, brief: { objetivo: string; escopo: string[]; exclusoes: string[]; criterios: string[]; pendencias: string[] } | null, decisions: Array<{ number: number; statement: string }>): string {
  const list = (title: string, items: string[]): string => items.length ? `\n${title}: ${items.join('; ')}` : ''
  const context = [`Card: ${card.title}`, card.description.trim() ? `Description: ${card.description.trim()}` : '', brief ? `Goal: ${brief.objetivo}${list('Scope', brief.escopo)}${list('Out of scope', brief.exclusoes)}${list('Criteria', brief.criterios)}${list('Open items', brief.pendencias)}` : '', decisions.length ? `Current decisions:\n${decisions.map((item) => `- D${String(item.number).padStart(3, '0')} ${item.statement}`).join('\n')}` : ''].filter(Boolean).join('\n')
  return specKitCommand(provider, 'specify', context)
}

export class SpecKitRuntime {
  constructor(private readonly deps: SpecKitDeps) {}

  /** O card usa Spec Kit no fluxo SDD? (a avaliação é por card, não por projeto). */
  active(cardId: string): boolean { return this.deps.history.workflow(cardId) === 'sdd' && this.deps.history.sddMethod(cardId) === 'speckit' }

  availability(projectId: string): { enabled: boolean; reason: string | null } { return specKitAvailability(this.deps.root(projectId)) }

  /** Última escolha de permissão do card (a mais nova aprovada); `null` enquanto o usuário não escolheu. */
  permission(cardId: string): SpecKitPermission | null {
    const latest = this.deps.approvals.list(cardId).find((item) => item.kind === specKitPermissionKind && item.status === 'approved')
    return latest?.note === 'manual' || latest?.note === 'free' ? latest.note : null
  }

  /** Pedido de escolha pendente (para o chat mostrar o card); cria um se o card usa Spec Kit e ainda não escolheu. */
  permissionRequest(cardId: string): Approval | null {
    if (!this.active(cardId) || this.permission(cardId)) return null
    const open = this.deps.approvals.list(cardId).find((item) => item.kind === specKitPermissionKind && item.status === 'requested')
    if (open) return open
    const card = this.deps.board.card(cardId)
    return this.deps.approvals.request({ kind: specKitPermissionKind, subjectRef: cardId, payload: {}, requestedActor: 'system', cardId, projectId: card.projectId, expiresInMs: farFuture })
  }

  /** Registra a escolha (ou a troca posterior de modo). Cada escolha vira um registro; vale o mais recente. */
  choose(cardId: string, permission: SpecKitPermission): SpecKitPermission {
    const card = this.deps.board.card(cardId)
    const pending = this.deps.approvals.list(cardId).find((item) => item.kind === specKitPermissionKind && item.status === 'requested')
    const request = pending ?? this.deps.approvals.request({ kind: specKitPermissionKind, subjectRef: cardId, payload: {}, requestedActor: 'system', cardId, projectId: card.projectId, expiresInMs: farFuture })
    this.deps.approvals.decide(request.id, true, permission)
    return permission
  }

  /** Barra o início antes de criar a run: sem escolha de permissão a primeira skill não começa. */
  assertCanStart(cardId: string): void {
    if (!this.active(cardId)) return
    const card = this.deps.board.card(cardId), availability = this.availability(card.projectId)
    if (!availability.enabled) throw new Error(availability.reason ?? tm().speckit.speckitNotConfigured)
    if (!this.permission(cardId)) throw new Error(tm().speckit.chooseSkillWritePermission)
  }

  /** Repositório da worktree que contém o Spec Kit (o da pasta configurada); com um só repositório, ele. */
  repository(cardId: string): { repoPath: string; path: string } {
    const root = this.deps.root(this.deps.board.card(cardId).projectId)
    const repos = this.deps.worktrees.repositories(cardId).filter((repo) => repo.status === 'active')
    const normal = (value: string): string => resolve(value).toLowerCase()
    const match = root ? repos.find((repo) => { const base = normal(repo.repoPath), target = normal(root); return target === base || target.startsWith(base + sep) }) : null
    const chosen = match ?? (repos.length === 1 ? repos[0] : null)
    if (!chosen) throw new Error(tm().speckit.speckitRepoNotInWorktree)
    return chosen
  }

  /** Antes de cada run do chat de planejamento: confere a skill NA worktree, amarra a feature e define o modo. Nunca troca de método. */
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
   * Antes de cada run do chat de implementação: o speckit-implement precisa do repositório do Spec Kit como pasta de trabalho
   * (skills, .specify e a feature do card), com os outros repositórios da worktree liberados para edição. Sem Spec Kit no card, `null`.
   */
  prepareImplementation(cardId: string): { cwd: string; env: Record<string, string>; addDirs: string[] } | null {
    if (!this.active(cardId)) return null
    const repo = this.repository(cardId), card = this.deps.board.card(cardId), featureDir = specKitFeatureDir(card.id, card.title)
    bindSpecKitFeature(repo.path, featureDir)
    const addDirs = this.deps.worktrees.repositories(cardId).filter((item) => item.status === 'active' && item.path !== repo.path).map((item) => item.path)
    return { cwd: repo.path, env: { SPECIFY_FEATURE_DIRECTORY: featureDir }, addDirs }
  }

  /** O mesmo que o card ver do planejamento: artefatos REAIS da feature do card, sem cópia. */
  artifacts(cardId: string): { featureDir: string; spec: string | null; plan: string | null; tasks: string | null; ready: boolean } {
    const card = this.deps.board.card(cardId), featureDir = specKitFeatureDir(card.id, card.title)
    return { featureDir, ...specKitArtifacts(this.repository(cardId).path, featureDir) }
  }

  /** Espelha os arquivos REAIS da feature nos documentos do card (Especificação, Plano, Tasks), para as abas do card mostrarem o que o Spec Kit gerou. Só lê os arquivos; nunca os altera. */
  sync(cardId: string): void {
    if (!this.active(cardId)) return
    let found: ReturnType<SpecKitRuntime['artifacts']>
    try { found = this.artifacts(cardId) } catch { return }
    for (const [kind, path] of [['especificacao', found.spec], ['plano', found.plan], ['tasks', found.tasks]] as const) {
      if (!path) continue
      try { this.deps.board.documents?.write(cardId, kind, readFileSync(path, 'utf8'), 'system') } catch { /* formato que as abas não aceitam: o arquivo real continua sendo a fonte */ }
    }
    // "Plano pronto" só enquanto os três arquivos da feature do card existirem; qualquer outra coisa limpa o selo.
    try { this.deps.board.setSpecKitReady?.(cardId, found.ready) } catch { /* sem banco: nada a sincronizar */ }
  }

  /** Depois da run: se spec, plan e tasks da feature do card existem, o planejamento está pronto. Devolve o aviso de próxima etapa. */
  afterRun(input: { cardId: string; prompt: string }): string | null {
    if (!this.active(input.cardId)) return null
    const stage = specKitStageOf(input.prompt)
    this.sync(input.cardId)
    return null // a própria skill diz quando concluiu; o app não escreve "etapa concluída" (a etapa pode ter parado numa pergunta)
  }

  /** Qualquer permissão pedida por uma skill de implementação é negada no planejamento (a barreira do texto não basta sozinha). */
  denies(details: Record<string, unknown>): boolean { return /speckit[-.]implement/i.test(JSON.stringify(details)) }

  private open(cardId: string, kind: string): Approval | null { return this.deps.approvals.list(cardId).find((item) => item.kind === kind && item.status === 'requested') ?? null }
  moveRequest(cardId: string): Approval | null { return this.open(cardId, specKitMoveKind) }
  startRequest(cardId: string): Approval | null { return this.open(cardId, specKitStartKind) }

  /** Card de movimentação ao pedir implementação no planejamento (mecanismo de aprovação existente). Nada se move antes da aprovação. */
  requestMove(cardId: string): Approval {
    const open = this.moveRequest(cardId); if (open) return open
    const card = this.deps.board.card(cardId), column = this.deps.board.get(card.projectId).columns.find((item) => item.semanticState === 'doing')
    if (!column) throw new Error(tm().speckit.noExecutionColumn)
    return this.deps.approvals.request({ kind: specKitMoveKind, subjectRef: cardId, payload: { columnId: column.id, columnLabel: column.label }, requestedActor: 'agent', cardId, projectId: card.projectId })
  }

  /** Depois de "Movimentar e implementar": confirmação pendente no chat de implementação; o agente só é escolhido no botão de iniciar. */
  requestStart(cardId: string): Approval {
    const open = this.startRequest(cardId); if (open) return open
    const card = this.deps.board.card(cardId)
    return this.deps.approvals.request({ kind: specKitStartKind, subjectRef: cardId, payload: { skill: 'speckit-implement' }, requestedActor: 'system', cardId, projectId: card.projectId, expiresInMs: farFuture })
  }

  /** A implementação foi iniciada pelo botão de iniciar: a confirmação pendente deixa de existir. */
  settleStart(cardId: string): void { const open = this.startRequest(cardId); if (open) this.deps.approvals.decide(open.id, true, 'started') }
}
