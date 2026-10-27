import { z } from 'zod'
import { cardComplexitySchema, cardHistorySchema, contestAssessmentInputSchema, decisionKindSchema, sddDetectionSchema, workflowConfigSchema, workflowKindSchema } from './assessments'

export const noteSchema = z.object({
  id: z.string().uuid(),
  body: z.string().max(10_000),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export const createNoteInputSchema = z.object({ body: z.string().trim().min(1).max(10_000) }).strict()
export const deleteNoteInputSchema = z.object({ id: z.string().uuid() }).strict()
export const restoreBackupInputSchema = z.object({ backupId: z.string().regex(/^upgrade-[0-9T.-]+-[a-f0-9]{8}$/) }).strict()

export const backupSummarySchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  schemaVersion: z.number().int().nonnegative(),
  appVersion: z.string(),
  reason: z.string()
})

export const appInfoSchema = z.object({
  appVersion: z.string(),
  schemaVersion: z.number().int().nonnegative(),
  dataDir: z.string()
})

const isoDate = z.string().datetime()
const uuid = z.string().uuid()
/** `minor`: tarefa pequena — um agente só implementa e valida, sem Especificação, Plano, Tasks nem etapa de teste separada. */
export const cardTypeSchema = z.enum(['feature', 'bug', 'improvement', 'task', 'minor'])
export const cardPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
export const semanticStateSchema = z.enum(['backlog', 'todo', 'doing', 'test', 'done'])

export const agentProviderSchema = z.enum(['codex', 'claude'])
export const agentColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
/** Cores de personalidade oferecidas ao cadastrar um agente; a cor é independente do tema do sistema. */
export const agentColorPalette = ['#D97757', '#E5A24B', '#9ccf6f', '#6fc3b2', '#8fb8d6', '#aeb9ff', '#b98fd6', '#e07a9a', '#e8c27a', '#c4d96b', '#5fbf8f', '#4fb8c9', '#6f9bf0', '#8c8cf0', '#d98fd9', '#f08a8a', '#d9a477', '#b5bdb7'] as const
export const defaultAgentColor = (provider: z.infer<typeof agentProviderSchema>): string => (provider === 'claude' ? agentColorPalette[0] : agentColorPalette[5])
export const themeSchema = z.enum(['green', 'purple', 'blue', 'orange', 'graphite', 'teal', 'rose', 'light-mint', 'light-sky', 'light-lavender', 'light-sand', 'light-rose', 'light-slate'])
export const languageSchema = z.enum(['pt-BR', 'en'])
/** `groq` transcreve na nuvem (Groq, whisper-large-v3-turbo); os outros rodam o whisper.cpp local. */
export const voiceModelSchema = z.enum(['small', 'large-v3-turbo', 'groq'])
/** `retomarSozinho`: quando o limite de uso acaba no meio de uma execução, retoma de onde parou assim que ele volta. */
export const appSettingsSchema = z.object({ tema: themeSchema, idioma: languageSchema, voz: voiceModelSchema, notificacoes: z.boolean(), retomarSozinho: z.boolean() })
export const updateAppSettingsInputSchema = z.object({ tema: themeSchema.optional(), idioma: languageSchema.optional(), voz: voiceModelSchema.optional(), notificacoes: z.boolean().optional(), retomarSozinho: z.boolean().optional() }).strict()
export const voiceStatusSchema = z.object({ model: voiceModelSchema, cloud: z.boolean(), modelInstalled: z.boolean(), engineInstalled: z.boolean(), canInstallEngine: z.boolean(), sizeMb: z.number(), downloading: z.object({ item: z.enum(['programa', 'modelo']), received: z.number(), total: z.number().nullable() }).nullable() })
export type VoiceModel = z.infer<typeof voiceModelSchema>
export type VoiceStatus = z.infer<typeof voiceStatusSchema>
export const agentProfileSchema = z.object({
  id: uuid, provider: agentProviderSchema, label: z.string(), scope: z.string(), color: agentColorSchema,
  configDir: z.string(), executablePath: z.string().nullable(), enabled: z.boolean()
})
export const createAgentProfileInputSchema = z.object({
  provider: agentProviderSchema, label: z.string().trim().min(1).max(80),
  scope: z.string().trim().min(1).max(80), useExistingSession: z.boolean(), color: agentColorSchema.optional()
}).strict()
export const boardColumnSchema = z.object({ id: uuid, projectId: uuid, label: z.string(), sortOrder: z.number().int(), semanticState: semanticStateSchema, isDefault: z.boolean() })
export const projectSourceSchema = z.object({
  id: uuid, projectId: uuid, name: z.string(), localPath: z.string(), isGitRepository: z.boolean(), currentBranch: z.string().nullable(), sortOrder: z.number().int()
})
/** Ícone do projeto: imagem pequena (o app reduz para 96px) guardada como data URL. */
export const projectIconSchema = z.string().max(300_000).regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/, 'Ícone deve ser uma imagem PNG, JPEG, WebP ou GIF')
export const projectSchema = z.object({
  id: uuid, name: z.string(), icon: z.string().nullable(), localPath: z.string(), baseBranch: z.string(), remoteProvider: z.string().nullable(),
  allowedProfileIds: z.array(uuid), sources: z.array(projectSourceSchema), activity: z.object({ running: z.number().int().nonnegative(), finished: z.number().int().nonnegative() }), createdAt: isoDate, updatedAt: isoDate
})
export const projectInspectionSchema = z.object({
  localPath: z.string(), name: z.string(), repositories: z.array(z.object({ localPath: z.string(), name: z.string(), currentBranch: z.string(), branches: z.array(z.string()) }))
})
export const agentPurposeSchema = z.enum(['planning', 'execution', 'test'])
export const permissionModeSchema = z.enum(['plan', 'auto', 'accept_edits', 'manual', 'on_request', 'read_only', 'bypass'])
/** `ultra`: esforço máximo do Codex com delegação automática de tarefas. */
export const effortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
export const agentConfigSchema = z.object({ profileId: uuid, model: z.string().trim().max(120).nullable(), effort: effortSchema.nullable(), mode: permissionModeSchema })
export const cardAgentsSchema = z.object({ planning: agentConfigSchema.nullable(), execution: agentConfigSchema.nullable(), test: agentConfigSchema.nullable() })
export const modelOptionSchema = z.object({ id: z.string(), label: z.string(), description: z.string(), efforts: z.array(effortSchema), recommendedFor: z.array(agentPurposeSchema), defaultEffort: effortSchema.nullable() })
export const mostUsedSchema = z.object({ model: z.string().nullable(), effort: effortSchema.nullable() }).nullable()
export const agentOptionsSchema = z.object({ models: z.array(modelOptionSchema), mostUsed: z.object({ planning: mostUsedSchema, execution: mostUsedSchema, test: mostUsedSchema }), error: z.string().optional() })

export type PermissionMode = z.infer<typeof permissionModeSchema>
export interface PermissionModeInfo { id: PermissionMode; label: string; description: string; purposes: Array<z.infer<typeof agentPurposeSchema>>; needsApprovalUi?: boolean; dangerous?: boolean; recommended?: boolean }
/** Modos de permissão por provedor (plano 08, seção 6). Modos que dependem da tela de aprovação (F14, pendente) ficam desabilitados. */
export const permissionModes: Record<'claude' | 'codex', PermissionModeInfo[]> = {
  claude: [
    { id: 'plan', label: 'Plano', description: 'Só lê e planeja; não altera arquivos.', purposes: ['planning'], recommended: true },
    { id: 'accept_edits', label: 'Aceitar edições', description: 'Edita arquivos sem perguntar; comandos fora da lista são negados.', purposes: ['execution', 'test'], recommended: true },
    { id: 'auto', label: 'Automático', description: 'O próprio Claude decide o que é seguro aprovar.', purposes: ['execution', 'test'] },
    { id: 'manual', label: 'Manual', description: 'Pergunta a cada ação. Precisa da tela de aprovação (em breve).', purposes: ['execution', 'test'], needsApprovalUi: true },
    { id: 'bypass', label: 'Ignorar permissões', description: 'Executa tudo sem pedir. Use só em ambiente descartável.', purposes: ['execution', 'test'], dangerous: true }
  ],
  codex: [
    { id: 'plan', label: 'Plano', description: 'Somente leitura, só planeja.', purposes: ['planning'], recommended: true },
    { id: 'auto', label: 'Automático', description: 'Edita na pasta do projeto e uma revisão automática aprova o que for seguro.', purposes: ['execution', 'test'], recommended: true },
    { id: 'on_request', label: 'Sob pedido', description: 'Edita na pasta do projeto e pede aprovação para o resto. Precisa da tela de aprovação (em breve).', purposes: ['execution', 'test'], needsApprovalUi: true },
    { id: 'read_only', label: 'Somente leitura', description: 'Lê e pede aprovação para qualquer mudança. Precisa da tela de aprovação (em breve).', purposes: ['execution', 'test'], needsApprovalUi: true },
    { id: 'bypass', label: 'Ignorar permissões', description: 'Sem sandbox e sem aprovações. Use só em ambiente descartável.', purposes: ['execution', 'test'], dangerous: true }
  ]
}
export const defaultPermissionMode = (provider: 'claude' | 'codex', purpose: z.infer<typeof agentPurposeSchema>): PermissionMode => (purpose === 'planning' ? 'plan' : provider === 'claude' ? 'accept_edits' : 'auto')

export const skillScopeSchema = z.enum(['global', 'project'])
export const skillProviderStateSchema = z.enum(['ready', 'none', 'converting'])
export const skillEntrySchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), scope: skillScopeSchema, detected: z.boolean(),
  providers: z.object({ claude: skillProviderStateSchema, codex: skillProviderStateSchema }),
  paths: z.object({ claude: z.string().nullable(), codex: z.string().nullable() }),
  origin: z.string().nullable()
})
export const skillRefSchema = z.object({ name: z.string().min(1).max(64), path: z.string().min(1).max(2048) })
export type SkillScope = z.infer<typeof skillScopeSchema>
export type SkillProviderState = z.infer<typeof skillProviderStateSchema>
export type SkillEntry = z.infer<typeof skillEntrySchema>
export type SkillRef = z.infer<typeof skillRefSchema>

export const usageWindowSchema = z.object({ id: z.string(), label: z.string(), usedPercent: z.number().min(0).max(100), resetsAt: isoDate.nullable() })
export const agentUsageSchema = z.object({ profileId: uuid, provider: agentProviderSchema, windows: z.array(usageWindowSchema), capturedAt: isoDate.nullable(), source: z.string() })
export type UsageWindow = z.infer<typeof usageWindowSchema>
export type AgentUsage = z.infer<typeof agentUsageSchema>

/** Os 4 documentos do plano + Dúvidas e Mudanças, gerados pelo sistema a partir das perguntas e propostas entre as etapas. */
export const questionSchema = z.object({ id: uuid, number: z.number().int(), askerPurpose: agentPurposeSchema, question: z.string(), status: z.enum(['open', 'planner', 'user', 'answered']), answer: z.string().nullable(), answeredBy: z.enum(['planner', 'user']).nullable(), userQuestion: z.string().nullable(), createdAt: isoDate, answeredAt: isoDate.nullable() })
export const changeSchema = z.object({ id: uuid, number: z.number().int(), proposerPurpose: agentPurposeSchema, title: z.string(), details: z.string(), reason: z.string(), status: z.enum(['pending', 'accepted', 'suggested', 'rejected', 'applied']), userNote: z.string().nullable(), createdAt: isoDate, decidedAt: isoDate.nullable(), sentAt: isoDate.nullable() })
export const collaborationSchema = z.object({ questions: z.array(questionSchema), changes: z.array(changeSchema) })
export type Question = z.infer<typeof questionSchema>
export type Change = z.infer<typeof changeSchema>
export type Collaboration = z.infer<typeof collaborationSchema>

export const cardDocumentKinds = ['resumo', 'especificacao', 'plano', 'tasks', 'duvidas', 'mudancas'] as const
export const systemDocumentKinds = ['duvidas', 'mudancas'] as const
export const cardDocumentKindSchema = z.enum(cardDocumentKinds)
export const cardDocumentSchema = z.object({ kind: cardDocumentKindSchema, contentMd: z.string(), updatedAt: isoDate.nullable(), updatedBy: z.enum(['user', 'agent', 'system']).nullable() })
export const cardDocumentsSchema = z.object({ resumo: cardDocumentSchema, especificacao: cardDocumentSchema, plano: cardDocumentSchema, tasks: cardDocumentSchema, duvidas: cardDocumentSchema, mudancas: cardDocumentSchema })
export const documentVersionSchema = z.object({ id: uuid, version: z.number().int().positive(), contentMd: z.string(), createdAt: isoDate, actor: z.enum(['user', 'agent', 'system']) })
export const taskCountSchema = z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
export const criterionSchema = z.object({ id: uuid, cardId: uuid, body: z.string(), checked: z.boolean(), sortOrder: z.number().int() })
export const cardRunStateSchema = z.object({ state: z.enum(['idle', 'planning', 'running', 'paused', 'finished']), runId: uuid.nullable(), profileId: uuid.nullable(), purpose: agentPurposeSchema.nullable() })
export const cardSchema = z.object({
  id: uuid, projectId: uuid, columnId: uuid, sourceId: uuid.nullable(), type: cardTypeSchema, title: z.string(), description: z.string(),
  priority: cardPrioritySchema, orderKey: z.number(), createdAt: isoDate, updatedAt: isoDate,
  archivedAt: isoDate.nullable(), acceptanceCriteria: z.array(criterionSchema), tasks: taskCountSchema, run: cardRunStateSchema, hasPlan: z.boolean(), planningOpen: z.boolean(), workspace: z.object({ branch: z.string(), baseRef: z.string(), path: z.string() }).nullable(), pending: z.object({ changes: z.number().int().nonnegative(), questions: z.number().int().nonnegative(), commits: z.number().int().nonnegative(), toSend: z.number().int().nonnegative() }), execProfileId: uuid.nullable(), execModel: z.string().nullable(), agentIds: z.array(uuid), complexity: cardComplexitySchema.nullable(), repoIds: z.array(uuid).nullable()
})
export const projectBoardSchema = z.object({ project: projectSchema, columns: z.array(boardColumnSchema), cards: z.array(cardSchema) })
export const agentProbeSchema = z.object({
  profileId: uuid, provider: z.enum(['codex', 'claude']), installed: z.boolean(), authenticated: z.boolean(),
  version: z.string().nullable(), executablePath: z.string().nullable(), capabilities: z.array(z.string()), checkedAt: isoDate,
  error: z.string().nullable(), account: z.string().nullable()
})
/** `constitution`: chat do projeto (sem card) que escreve a Constituição. */
export const chatPurposeSchema = z.union([agentPurposeSchema, z.literal('free'), z.literal('constitution')])
export const chatSchema = z.object({ id: uuid, projectId: uuid, cardId: uuid.nullable(), purpose: chatPurposeSchema, title: z.string().nullable(), busy: z.boolean(), provider: z.enum(['codex', 'claude']), profileId: uuid, providerSessionId: z.string().nullable(), skill: skillRefSchema.nullable(), createdAt: isoDate, updatedAt: isoDate })
/** Constituição do projeto: princípios que valem para todo card. Opcional; `version` 0 = ainda não existe. */
export const constitutionSchema = z.object({ projectId: uuid, contentMd: z.string(), version: z.number().int().nonnegative(), updatedAt: isoDate.nullable(), updatedBy: z.enum(['user', 'agent', 'system']).nullable() })
/** Mudança na Constituição sugerida por um agente fora do chat dela: só vale depois que o usuário aplica. */
export const constitutionProposalSchema = z.object({ id: uuid, projectId: uuid, number: z.number().int().positive(), cardId: uuid.nullable(), title: z.string(), details: z.string(), reason: z.string(), status: z.enum(['pending', 'applied', 'dismissed']), createdAt: isoDate })
/** Checklist do testador (o que verificar, marcado conforme verifica); vazio até ele montar. */
/**
 * Quem fez a última mudança de um item do checklist (`by`: o usuário clicando ou o agente gravando o checklist) e quando (`at`).
 * `agent`: quando o agente deu o OK ao item; continua guardado mesmo se o usuário desmarcar e marcar de novo, e só some se o agente desmarcar.
 */
export const checklistMarkSchema = z.object({ by: z.enum(['user', 'agent']), at: isoDate, agent: isoDate.optional() })
export const cardChecklistSchema = z.object({ cardId: uuid, contentMd: z.string(), updatedAt: isoDate.nullable(), marks: z.record(z.string(), checklistMarkSchema) })
/** Chave de um item do checklist (o texto, sem diferença de espaços e de maiúsculas): liga o item à marca de quem o alterou. */
export const checklistKey = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()
export const constitutionStateSchema = z.object({ constitution: constitutionSchema, proposals: z.array(constitutionProposalSchema), importable: z.string().nullable() })
export const chatMessageSchema = z.object({ id: uuid, chatId: uuid, role: z.enum(['user', 'assistant', 'system', 'tool']), body: z.string(), status: z.enum(['streaming', 'complete', 'failed']), createdAt: isoDate, providerMessageId: z.string().nullable() })
export const runSchema = z.object({ id: uuid, cardId: uuid.nullable(), chatId: uuid, profileId: uuid, status: z.enum(['queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled']), startedAt: isoDate, endedAt: isoDate.nullable(), exitReason: z.string().nullable(), worktreeId: uuid.nullable(), providerTurnId: z.string().nullable() })
/** Tokens gastos em uma etapa do card: `input` é o que o agente leu de novo, `cached` o que veio do cache e `output` o que ele escreveu. */
export const tokenCountSchema = z.object({ input: z.number().int().nonnegative(), cached: z.number().int().nonnegative(), output: z.number().int().nonnegative(), runs: z.number().int().nonnegative() })
/** Uso de um agente em uma etapa do card. */
export const cardAgentUsageSchema = tokenCountSchema.extend({ purpose: z.enum(['planning', 'execution', 'test']), profileId: uuid, label: z.string(), provider: z.enum(['codex', 'claude']) })
export const cardUsageSchema = z.object({ planning: tokenCountSchema, execution: tokenCountSchema, test: tokenCountSchema, agents: z.array(cardAgentUsageSchema).default([]) })
export type TokenCount = z.output<typeof tokenCountSchema>
export type CardUsage = z.output<typeof cardUsageSchema>
export type CardAgentUsage = z.output<typeof cardAgentUsageSchema>
export const runEventSchema = z.object({ id: uuid, runId: uuid, seq: z.number().int().nonnegative(), eventType: z.string(), payload: z.record(z.string(), z.unknown()), createdAt: isoDate })
export const planSchema = z.object({ id: uuid, cardId: uuid, version: z.number().int().positive(), agentProfileId: uuid, contentMd: z.string(), status: z.enum(['draft', 'approved', 'superseded']), createdAt: isoDate, approvedAt: isoDate.nullable() })
export const worktreeSchema = z.object({ id: uuid, cardId: uuid, repoPath: z.string(), path: z.string(), branch: z.string(), baseRef: z.string(), createdAt: isoDate, cleanupState: z.enum(['active', 'missing', 'cleanup-requested', 'removed']) })
export const gitSnapshotSchema = z.object({ worktreeId: uuid, status: z.string(), diff: z.string(), exists: z.boolean() })
export const testRunSchema = z.object({ id: uuid, cardId: uuid, command: z.string(), status: z.enum(['running', 'passed', 'failed']), exitCode: z.number().int().nullable(), summary: z.string(), startedAt: isoDate, endedAt: isoDate.nullable() })
export const reviewSchema = z.object({ id: uuid, cardId: uuid, provider: z.enum(['github', 'gitlab', 'local']), remoteUrl: z.string().nullable(), remoteId: z.string().nullable(), state: z.enum(['open', 'approved', 'merged', 'closed']), targetBranch: z.string(), sourceBranch: z.string(), updatedAt: isoDate })

/** Métricas de uma execução, só com o que o provedor informa: custo `reported` vem do próprio agente; sem isso fica `unavailable` (nunca estimado em silêncio). */
export const runMetricSchema = z.object({ runId: uuid, purpose: z.string().nullable(), provider: z.string().nullable(), model: z.string().nullable(), effort: z.string().nullable(), status: z.string(), startedAt: isoDate, endedAt: isoDate.nullable(), durationMs: z.number().int().nullable(), input: z.number().int(), cached: z.number().int(), output: z.number().int(), costUsd: z.number().nullable(), costSource: z.enum(['reported', 'unavailable']), promptChars: z.number().int().nullable(), usedPlaywrightCli: z.boolean() })
export type RunMetric = z.output<typeof runMetricSchema>
/** Playwright CLI (@playwright/cli, comando playwright-cli): opcional, só instalação local por repositório e com confirmação. */
export const playwrightStatusSchema = z.object({
  node: z.string().nullable(), enabled: z.boolean(),
  installs: z.array(z.object({ sourceId: uuid.nullable(), repo: z.string(), path: z.string(), origin: z.enum(['local', 'global']), version: z.string().nullable() })),
  browserReady: z.boolean(), log: z.string(), error: z.string().nullable()
})
export type PlaywrightStatus = z.output<typeof playwrightStatusSchema>
export const toolsStatusSchema = z.object({
  node: z.string().nullable(), uv: z.string().nullable(), python: z.string().nullable(),
  specify: z.object({ installed: z.boolean(), version: z.string().nullable() }), openspec: z.object({ installed: z.boolean(), version: z.string().nullable() }),
  repos: z.array(z.object({ sourceId: uuid, name: z.string(), path: z.string(), specKit: z.boolean(), specKitIntegrations: z.array(z.string()), openSpec: z.boolean() })),
  log: z.string(), error: z.string().nullable()
})
export type ToolsStatus = z.output<typeof toolsStatusSchema>
export const toolKeys = ['claude', 'codex', 'specify', 'openspec', 'playwright'] as const
export const toolVersionsSchema = z.object({ checkedAt: z.string().nullable(), versions: z.object({ claude: z.string().nullable(), codex: z.string().nullable(), specify: z.string().nullable(), openspec: z.string().nullable(), playwright: z.string().nullable() }), error: z.string().nullable() })
export type ToolVersions = z.output<typeof toolVersionsSchema>

/** Primeira versão `x.y.z[-pré]` de um texto como `v1.2.3`, `2.0.14 (Claude Code)` ou `codex-cli 0.50.0`. */
const parseVersion = (text: string | null): { core: [number, number, number]; pre: string | null } | null => {
  const found = text ? /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(text) : null
  return found ? { core: [Number(found[1]), Number(found[2]), Number(found[3])], pre: found[4] ?? null } : null
}
/** A versão instalada é mais antiga que a última publicada? Pré-lançamento mais novo que a estável não é "desatualizado". Texto que não é versão = não avisa. */
export function isOutdated(installed: string | null, latest: string | null): boolean {
  const have = parseVersion(installed), want = parseVersion(latest)
  if (!have || !want) return false
  for (let index = 0; index < 3; index++) { if (have.core[index]! !== want.core[index]!) return have.core[index]! < want.core[index]! }
  return have.pre !== null && want.pre === null
}
const workflowState = z.object({ config: workflowConfigSchema, detected: z.array(sddDetectionSchema), defaultArtifactsDir: z.string() })
const projectIdInput = z.object({ projectId: uuid }).strict()
const cardIdInput = z.object({ cardId: uuid }).strict()
export const createProjectInputSchema = z.object({
  name: z.string().trim().max(120).optional(), sourcePaths: z.array(z.string().trim().min(1).max(2048)).min(1).max(20), profileIds: z.array(uuid).max(8).default([]), icon: projectIconSchema.nullable().optional()
}).strict()
export const updateProjectInputSchema = z.object({ projectId: uuid, name: z.string().trim().min(1).max(120), icon: projectIconSchema.nullable().optional() }).strict()
export const setProjectProfilesInputSchema = z.object({ projectId: uuid, profileIds: z.array(uuid).max(8) }).strict()
const criterionInputSchema = z.object({ body: z.string().trim().min(1).max(2000), checked: z.boolean().default(false) })
export const createCardInputSchema = z.object({
  projectId: uuid, columnId: uuid, sourceId: uuid.nullable().optional(), type: cardTypeSchema, title: z.string().trim().max(240),
  description: z.string().max(20_000).default(''), priority: cardPrioritySchema,
  acceptanceCriteria: z.array(criterionInputSchema).max(50).default([])
}).strict()
export const updateCardInputSchema = createCardInputSchema.omit({ projectId: true, columnId: true }).extend({ cardId: uuid, title: z.string().trim().min(1).max(240) }).strict()
export const moveCardInputSchema = z.object({ cardId: uuid, columnId: uuid, beforeCardId: uuid.nullable().default(null), skipGate: z.boolean().default(false) }).strict()

/** Git: regra de commit do agente (padrão do projeto + exceções por branch; a primeira que bater vence). */
export const gitRuleSchema = z.enum(['auto', 'ask', 'never'])
export const gitPolicySchema = z.object({ def: gitRuleSchema, rules: z.array(z.object({ pattern: z.string().trim().max(200), rule: gitRuleSchema }).strict()).max(50) }).strict()
export const defaultGitPolicy: z.infer<typeof gitPolicySchema> = { def: 'ask', rules: [{ pattern: 'main', rule: 'never' }, { pattern: 'develop', rule: 'never' }, { pattern: 'release/*', rule: 'never' }] }
export const gitResolvedRuleSchema = z.object({ rule: gitRuleSchema, why: z.string() })
export const gitRepoSchema = z.object({ sourceId: uuid, name: z.string(), path: z.string(), head: z.string().nullable(), hasRemote: z.boolean() })
export const gitRefSchema = z.object({ name: z.string(), kind: z.enum(['head', 'local', 'remote', 'tag']) })
/** Linha do grafo: um commit, ou (`wip` preenchido) as alterações ainda sem commit da pasta principal ou da worktree de um card. */
export const gitRowSchema = z.object({
  hash: z.string(), short: z.string(), parents: z.array(z.string()), lane: z.number().int().nonnegative(), author: z.string(), email: z.string(), date: isoDate.nullable(), subject: z.string(),
  refs: z.array(gitRefSchema), cardId: uuid.nullable(), agentProfileId: uuid.nullable(), wip: z.object({ modified: z.number().int(), added: z.number().int(), deleted: z.number().int(), staged: z.number().int(), branch: z.string() }).nullable()
})
export const gitGraphSchema = z.object({
  repo: gitRepoSchema, rows: z.array(gitRowSchema), truncated: z.boolean(),
  branches: z.object({ local: z.array(z.object({ name: z.string(), cardId: uuid.nullable(), head: z.boolean(), ahead: z.number().int().default(0), behind: z.number().int().default(0) })), remote: z.array(z.object({ name: z.string(), cardId: uuid.nullable() })) }),
  worktrees: z.array(z.object({ cardId: uuid, title: z.string(), branch: z.string(), path: z.string() })),
  stashes: z.array(z.object({ ref: z.string(), message: z.string() }))
})
export const gitChangeSchema = z.object({ path: z.string(), status: z.enum(['M', 'A', 'D']), staged: z.boolean(), additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative() })
export const gitCommitFileSchema = z.object({ path: z.string(), status: z.enum(['M', 'A', 'D']), additions: z.number().int().nonnegative(), deletions: z.number().int().nonnegative() })
export const gitChangesSchema = z.object({ branch: z.string().nullable(), files: z.array(gitChangeSchema), lastMessage: z.string() })
export const gitRequestSchema = z.object({
  id: uuid, cardId: uuid, sourceId: uuid, repoName: z.string(), message: z.string(), files: z.array(z.string()), status: z.enum(['pending', 'done', 'denied', 'failed']),
  agentProfileId: uuid.nullable(), hash: z.string().nullable(), error: z.string().nullable(), createdAt: isoDate
})
export const gitCardRepoSchema = z.object({
  sourceId: uuid, name: z.string(), repoPath: z.string(), worktreePath: z.string(), ahead: z.number().int().nonnegative(), behind: z.number().int().nonnegative(), published: z.boolean(), hasRemote: z.boolean(),
  commits: z.array(z.object({ hash: z.string(), short: z.string(), subject: z.string(), author: z.string(), date: isoDate, agentProfileId: uuid.nullable() })), files: z.array(gitChangeSchema), request: gitRequestSchema.nullable(),
  state: z.enum(['active', 'failed', 'missing']), error: z.string().nullable(), prUrl: z.string().nullable(),
  /** Branch de origem deste repositório (cada um tem a sua; a origem pode ser trocada no card). */
  baseRef: z.string()
})
export const gitCardSchema = z.object({ branch: z.string().nullable(), baseBranch: z.string().nullable(), rule: gitResolvedRuleSchema, repos: z.array(gitCardRepoSchema), delivery: z.object({ complete: z.boolean(), pending: z.array(z.string()) }) })
const gitTarget = { sourceId: uuid, cardId: uuid.nullable() }

export const ipcContracts = {
  'app:info': { input: z.undefined(), output: appInfoSchema },
  'notes:list': { input: z.undefined(), output: z.array(noteSchema) },
  'notes:create': { input: createNoteInputSchema, output: noteSchema },
  'notes:delete': { input: deleteNoteInputSchema, output: z.object({ deleted: z.boolean() }) },
  'backups:list': { input: z.undefined(), output: z.array(backupSummarySchema) },
  'backups:create': { input: z.undefined(), output: backupSummarySchema },
  'backups:restore': { input: restoreBackupInputSchema, output: z.object({ restored: z.literal(true) }) }
  , 'settings:get': { input: z.undefined(), output: appSettingsSchema }
  , 'settings:update': { input: updateAppSettingsInputSchema, output: appSettingsSchema }
  , 'profiles:list': { input: z.undefined(), output: z.array(agentProfileSchema) }
  , 'profiles:create': { input: createAgentProfileInputSchema, output: agentProfileSchema }
  , 'profiles:update': { input: z.object({ profileId: uuid, label: z.string().trim().min(1).max(80), scope: z.string().trim().min(1).max(80), color: agentColorSchema.optional() }).strict(), output: agentProfileSchema }
  , 'profiles:delete': { input: z.object({ profileId: uuid }).strict(), output: z.object({ deleted: z.boolean(), archived: z.boolean() }) }
  , 'profiles:removed': { input: z.undefined(), output: z.array(agentProfileSchema) }
  , 'profiles:probe': { input: z.object({ profileId: uuid }).strict(), output: agentProbeSchema }
  , 'profiles:probe-all': { input: z.undefined(), output: z.array(agentProbeSchema) }
  , 'profiles:detect-provider': { input: z.object({ provider: z.enum(['codex', 'claude']) }).strict(), output: z.object({ installed: z.boolean(), version: z.string().nullable(), error: z.string().nullable() }) }
  , 'profiles:update-provider': { input: z.object({ provider: z.enum(['codex', 'claude']) }).strict(), output: z.object({ started: z.literal(true) }) }
  , 'tools:status': { input: projectIdInput, output: toolsStatusSchema }
  , 'tools:latest': { input: z.object({ force: z.boolean() }).strict(), output: toolVersionsSchema }
  , 'profiles:install-provider': { input: z.object({ provider: z.enum(['codex', 'claude']) }).strict(), output: z.object({ started: z.literal(true) }) }
  , 'profiles:install': { input: z.object({ profileId: uuid }).strict(), output: z.object({ started: z.literal(true) }) }
  , 'profiles:login': { input: z.object({ profileId: uuid }).strict(), output: z.object({ started: z.literal(true) }) }
  , 'projects:list': { input: z.undefined(), output: z.array(projectSchema) }
  , 'projects:create': { input: createProjectInputSchema, output: projectSchema }
  , 'projects:update': { input: updateProjectInputSchema, output: projectSchema }
  , 'projects:reorder': { input: z.object({ projectIds: z.array(uuid).max(500) }).strict(), output: z.array(projectSchema) }
  , 'projects:delete': { input: projectIdInput, output: z.object({ deleted: z.boolean() }) }
  , 'constitution:get': { input: projectIdInput, output: constitutionStateSchema }
  , 'constitution:save': { input: z.object({ projectId: uuid, contentMd: z.string().max(400_000) }).strict(), output: constitutionStateSchema }
  , 'constitution:import': { input: projectIdInput, output: constitutionStateSchema }
  , 'constitution:set-proposal': { input: z.object({ proposalId: uuid, status: z.enum(['applied', 'dismissed']) }).strict(), output: constitutionStateSchema }
  , 'projects:inspect': { input: z.object({ localPath: z.string().trim().min(1).max(2048) }).strict(), output: projectInspectionSchema }
  , 'projects:branches': { input: z.object({ localPath: z.string().trim().min(1).max(2048) }).strict(), output: z.array(z.string()) }
  , 'projects:choose-directory': { input: z.undefined(), output: z.string().nullable() }
  , 'projects:set-profiles': { input: setProjectProfilesInputSchema, output: projectSchema }
  , 'board:get': { input: projectIdInput, output: projectBoardSchema }
  , 'cards:create': { input: createCardInputSchema, output: cardSchema }
  , 'cards:update': { input: updateCardInputSchema, output: cardSchema }
  , 'cards:move': { input: moveCardInputSchema, output: cardSchema }
  , 'cards:archive': { input: cardIdInput, output: cardSchema }
  , 'cards:restore': { input: cardIdInput, output: cardSchema }
  , 'cards:get': { input: cardIdInput, output: cardSchema }
  , 'cards:documents': { input: cardIdInput, output: cardDocumentsSchema }
  , 'cards:write-document': { input: z.object({ cardId: uuid, kind: cardDocumentKindSchema, contentMd: z.string().max(200_000) }).strict(), output: cardDocumentSchema }
  , 'cards:document-versions': { input: z.object({ cardId: uuid, kind: cardDocumentKindSchema }).strict(), output: z.array(documentVersionSchema) }
  , 'cards:toggle-task': { input: z.object({ cardId: uuid, line: z.number().int().nonnegative(), checked: z.boolean() }).strict(), output: cardDocumentSchema }
  , 'cards:start': { input: z.object({ cardId: uuid, config: agentConfigSchema, purpose: z.enum(['execution', 'test']).optional(), baseBranch: z.string().trim().min(1).max(200).optional() }).strict(), output: runSchema }
  , 'cards:branches': { input: cardIdInput, output: z.object({ branches: z.array(z.string()), current: z.string().nullable(), selected: z.string().nullable(), locked: z.boolean() }) }
  , 'cards:resume': { input: z.object({ cardId: uuid, purpose: z.enum(['execution', 'test']).optional() }).strict(), output: runSchema }
  , 'chats:reset': { input: z.object({ chatId: uuid }).strict(), output: z.object({ reset: z.literal(true) }) }
  , 'chats:delete': { input: z.object({ chatId: uuid }).strict(), output: z.object({ deleted: z.literal(true) }) }
  , 'usage:refresh': { input: z.undefined(), output: z.array(agentUsageSchema) }
  , 'cards:mark-viewed': { input: cardIdInput, output: cardSchema }
  , 'agents:options': { input: z.object({ profileId: uuid }).strict(), output: agentOptionsSchema }
  , 'cards:agent-config': { input: cardIdInput, output: cardAgentsSchema }
  , 'cards:set-agent-config': { input: z.object({ cardId: uuid, purpose: agentPurposeSchema, config: agentConfigSchema }).strict(), output: cardAgentsSchema }
  , 'skills:list': { input: z.object({ scope: skillScopeSchema, projectId: uuid.optional() }).strict(), output: z.array(skillEntrySchema) }
  , 'skills:choose-source': { input: z.undefined(), output: z.string().nullable() }
  , 'skills:choose-folder': { input: z.undefined(), output: z.string().nullable() }
  , 'skills:delete': { input: z.object({ scope: skillScopeSchema, projectId: uuid.optional(), name: z.string().trim().min(1).max(64), provider: agentProviderSchema.optional() }).strict(), output: z.array(skillEntrySchema) }
  , 'skills:import-folder': { input: z.object({ scope: skillScopeSchema, projectId: uuid.optional(), folderPath: z.string().trim().min(1).max(2048), provider: agentProviderSchema }).strict(), output: z.object({ imported: z.array(z.string()), skipped: z.array(z.string()), skills: z.array(skillEntrySchema) }) }
  , 'skills:import': { input: z.object({ scope: skillScopeSchema, projectId: uuid.optional(), sourcePath: z.string().trim().min(1).max(2048), name: z.string().trim().min(1).max(64), provider: agentProviderSchema }).strict(), output: z.array(skillEntrySchema) }
  , 'skills:convert': { input: z.object({ scope: skillScopeSchema, projectId: uuid.optional(), name: z.string().trim().min(1).max(64), from: agentProviderSchema, to: agentProviderSchema, reviewProfileId: uuid.optional(), model: z.string().max(120).nullable().optional() }).strict(), output: z.object({ converted: z.literal(true), reviewing: z.boolean() }) }
  , 'chats:set-skill': { input: z.object({ chatId: uuid, skill: skillRefSchema.nullable() }).strict(), output: chatSchema }
  , 'voice:status': { input: z.undefined(), output: voiceStatusSchema }
  , 'voice:install': { input: z.undefined(), output: voiceStatusSchema }
  , 'voice:set-key': { input: z.object({ key: z.string().trim().max(200) }).strict(), output: voiceStatusSchema }
  , 'voice:transcribe': { input: z.object({ wav: z.instanceof(Uint8Array).refine((value) => value.byteLength <= 12 * 1024 * 1024, 'Gravação longa demais'), prompt: z.string().max(400).optional() }).strict(), output: z.object({ text: z.string() }) }
  , 'usage:list': { input: z.undefined(), output: z.array(agentUsageSchema) }
  , 'cards:usage': { input: cardIdInput, output: cardUsageSchema }
  , 'cards:checklist': { input: cardIdInput, output: cardChecklistSchema }
  , 'cards:checklist-toggle': { input: z.object({ cardId: uuid, line: z.number().int().min(0).max(100_000), text: z.string().min(1).max(2000), checked: z.boolean() }).strict(), output: cardChecklistSchema }
  , 'files:read': { input: z.object({ chatId: uuid, path: z.string().trim().min(1).max(2048) }).strict(), output: z.object({ path: z.string(), relative: z.string(), content: z.string(), truncated: z.boolean(), size: z.number(), binary: z.boolean() }) }
  , 'workspace:roots': { input: z.object({ projectId: uuid, cardId: uuid.nullable() }).strict(), output: z.array(z.object({ path: z.string(), name: z.string(), branch: z.string().nullable(), worktree: z.boolean(), primary: z.boolean(), cardId: uuid.nullable(), cardTitle: z.string().nullable() })) }
  , 'workspace:external': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096), target: z.enum(['explorer', 'default', 'vscode']) }).strict(), output: z.object({}) }
  , 'workspace:comment': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), text: z.string().min(1).max(100_000) }).strict(), output: z.object({}) }
  , 'workspace:attach': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096) }).strict(), output: z.object({}) }
  , 'workspace:terminal': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096) }).strict(), output: z.object({ id: uuid, cwd: z.string(), shell: z.string() }) }
  , 'workspace:image': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096) }).strict(), output: z.string() }
  , 'workspace:list': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096) }).strict(), output: z.array(z.object({ path: z.string(), name: z.string(), directory: z.boolean() })) }
  , 'workspace:search': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), query: z.string().min(1).max(200), fuzzy: z.boolean().optional() }).strict(), output: z.object({ paths: z.array(z.string()), limited: z.boolean() }) }
  , 'workspace:read': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096) }).strict(), output: z.object({ path: z.string(), relative: z.string(), content: z.string(), truncated: z.boolean(), size: z.number(), binary: z.boolean() }) }
  , 'workspace:write': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096), content: z.string().max(1_000_000), expected: z.string().max(1_000_000) }).strict(), output: z.object({ path: z.string(), relative: z.string(), content: z.string(), truncated: z.boolean(), size: z.number(), binary: z.boolean() }) }
  , 'workspace:watch': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), watchId: z.string().min(1).max(100), paths: z.array(z.string().min(1).max(4096)).max(200) }).strict(), output: z.object({}).strict() }
  , 'workspace:create': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), parent: z.string().min(1).max(4096), name: z.string().min(1).max(1024), kind: z.enum(['file', 'folder']) }).strict(), output: z.object({ path: z.string() }) }
  , 'workspace:rename': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096), name: z.string().min(1).max(255) }).strict(), output: z.object({ path: z.string() }) }
  , 'workspace:trash': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096) }).strict(), output: z.object({}).strict() }
  , 'workspace:grep': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), query: z.string().min(1).max(500), caseSensitive: z.boolean(), wholeWord: z.boolean(), regex: z.boolean(), include: z.string().max(500).optional() }).strict(), output: z.object({ results: z.array(z.object({ path: z.string(), root: z.string(), line: z.number(), column: z.number(), preview: z.string(), matchStart: z.number(), matchEnd: z.number() })), limited: z.boolean() }) }
  , 'workspace:save-image': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), markdownPath: z.string().min(1).max(4096), data: z.string().min(1).max(14_000_000), mime: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']) }).strict(), output: z.object({ path: z.string(), relative: z.string() }) }
  , 'workspace:versions': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096) }).strict(), output: z.object({ path: z.string(), relative: z.string(), root: z.string(), before: z.string().nullable(), after: z.string().nullable(), baseLabel: z.string(), binary: z.boolean(), truncated: z.boolean() }) }
  , 'collab:list': { input: cardIdInput, output: collaborationSchema }
  , 'collab:send-change': { input: z.object({ changeId: uuid }).strict(), output: collaborationSchema }
  , 'collab:decide-change': { input: z.object({ changeId: uuid, decision: z.enum(['accept', 'reject', 'suggest']), note: z.string().trim().max(4000).optional() }).strict(), output: collaborationSchema }
  , 'collab:answer-question': { input: z.object({ questionId: uuid, answer: z.string().trim().min(1).max(8000) }).strict(), output: collaborationSchema }
  , 'cards:delete': { input: cardIdInput, output: z.object({ deleted: z.boolean() }) }
  , 'cards:set-repos': { input: z.object({ cardId: uuid, sourceIds: z.array(uuid).max(50).nullable() }).strict(), output: cardSchema }
  , 'git:create-prs': { input: z.object({ cardId: uuid, draft: z.boolean().default(true), title: z.string().trim().max(240).optional(), body: z.string().max(20_000).optional() }).strict(), output: z.object({ results: z.array(z.object({ repo: z.string(), url: z.string().nullable(), error: z.string().nullable() })) }) }
  , 'git:open-pr': { input: z.object({ cardId: uuid, url: z.string().url().max(2000) }).strict(), output: z.object({ opened: z.literal(true) }) }
  , 'playwright:sources': { input: projectIdInput, output: z.array(z.object({ id: uuid, name: z.string(), node: z.boolean() })) }
  , 'playwright:status': { input: projectIdInput, output: playwrightStatusSchema }
  , 'playwright:install-browser': { input: z.object({ projectId: uuid, sourceId: uuid }).strict(), output: playwrightStatusSchema }
  , 'playwright:install': { input: z.object({ projectId: uuid, sourceId: uuid, browser: z.boolean(), skills: z.array(z.enum(['claude', 'agents'])).max(2) }).strict(), output: playwrightStatusSchema }
  , 'history:get': { input: cardIdInput, output: cardHistorySchema }
  , 'history:contest': { input: contestAssessmentInputSchema, output: cardHistorySchema }
  , 'history:select-workflow': { input: z.object({ cardId: uuid, workflow: workflowKindSchema, reason: z.string().trim().max(4000).optional() }).strict(), output: cardHistorySchema }
  , 'history:add-decision': { input: z.object({ cardId: uuid, kind: decisionKindSchema, statement: z.string().trim().min(1).max(4000), rationale: z.string().trim().max(4000).optional() }).strict(), output: cardHistorySchema }
  , 'history:set-decision': { input: z.object({ decisionId: uuid, status: z.enum(['approved', 'superseded']) }).strict(), output: cardHistorySchema }
  , 'history:rebuild': { input: cardIdInput, output: z.object({ events: z.number().int().nonnegative(), assessments: z.number().int().nonnegative(), decisions: z.number().int().nonnegative() }) }
  , 'history:open-folder': { input: cardIdInput, output: z.object({ path: z.string() }) }
  , 'git:file-read': { input: z.object({ sourceId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(2048) }).strict(), output: z.object({ content: z.string() }) }
  , 'git:file-path': { input: z.object({ sourceId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(2048) }).strict(), output: z.object({ projectId: uuid, path: z.string() }) }
  , 'git:file-write': { input: z.object({ sourceId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(2048), content: z.string().max(2_000_000) }).strict(), output: z.object({}) }
  , 'terminal:open': { input: z.object({ projectId: uuid.nullable(), cardId: uuid.nullable() }).strict(), output: z.object({ id: z.string(), cwd: z.string(), shell: z.string() }) }
  , 'terminal:info': { input: z.object({ id: z.string().min(1).max(80) }).strict(), output: z.object({ id: z.string(), cwd: z.string(), shell: z.string(), text: z.string(), seq: z.number(), exited: z.boolean() }) }
  , 'terminal:resize': { input: z.object({ id: z.string().min(1).max(80), cols: z.number().int().min(2).max(1000), rows: z.number().int().min(2).max(1000) }).strict(), output: z.object({}) }
  , 'terminal:write': { input: z.object({ id: z.string().min(1).max(80), data: z.string().max(200_000) }).strict(), output: z.object({}) }
  , 'terminal:kill': { input: z.object({ id: z.string().min(1).max(80) }).strict(), output: z.object({}) }
  , 'windows:open': { input: z.object({ kind: z.enum(['board', 'chats', 'git', 'chat', 'files', 'file', 'terminal']), projectId: uuid, cardId: uuid.optional(), chatId: uuid.optional(), terminalId: z.string().min(1).max(80).optional(), path: z.string().max(4096).optional(), paths: z.array(z.string().min(1).max(4096)).max(50).optional(), purpose: agentPurposeSchema.optional(), placement: z.enum(['new', 'left', 'right', 'top', 'bottom', 'fill', 'second']), x: z.number().int().min(-100000).max(100000).optional(), y: z.number().int().min(-100000).max(100000).optional() }).strict(), output: z.object({}) }
  , 'windows:return-file': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), path: z.string().min(1).max(4096) }).strict(), output: z.object({}) }
  , 'windows:place': { input: z.object({ placement: z.enum(['new', 'left', 'right', 'top', 'bottom', 'fill']) }).strict(), output: z.object({}) }
  , 'metrics:card': { input: cardIdInput, output: z.array(runMetricSchema) }
  , 'workflow:get': { input: projectIdInput, output: workflowState }
  , 'workflow:open-path': { input: z.object({ projectId: uuid, which: z.enum(['artifacts', 'sdd']) }).strict(), output: z.object({ path: z.string() }) }
  , 'workflow:set': { input: z.object({ projectId: uuid, config: workflowConfigSchema }).strict(), output: workflowState }
  , 'chats:list': { input: projectIdInput.extend({ cardId: uuid.nullable().optional() }).strict(), output: z.array(chatSchema) }
  , 'chats:create': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), purpose: chatPurposeSchema, profileId: uuid, skill: skillRefSchema.nullable().optional() }).strict(), output: chatSchema }
  , 'messages:list': { input: z.object({ chatId: uuid }).strict(), output: z.array(chatMessageSchema) }
  , 'messages:add': { input: z.object({ chatId: uuid, role: z.enum(['user', 'assistant', 'system', 'tool']), body: z.string().min(1).max(100_000), status: z.enum(['streaming', 'complete', 'failed']).default('complete') }).strict(), output: chatMessageSchema }
  , 'runs:create': { input: z.object({ cardId: uuid, chatId: uuid, profileId: uuid }).strict(), output: runSchema }
  , 'runs:event': { input: z.object({ runId: uuid, eventType: z.string().min(1).max(120), payload: z.record(z.string(), z.unknown()) }).strict(), output: runEventSchema }
  , 'agents:start': { input: z.object({ chatId: uuid, prompt: z.string().trim().min(1).max(100_000), planning: z.boolean(), attachments: z.array(z.string().min(1).max(2048)).max(20).optional(), choice: z.object({ model: z.string().trim().max(120).nullable().optional(), effort: effortSchema.nullable().optional(), mode: permissionModeSchema.optional() }).strict().optional() }).strict(), output: runSchema }
  , 'files:preview': { input: z.object({ path: z.string() }), output: z.string().nullable() }
  , 'files:choose': { input: z.undefined(), output: z.array(z.string()) }
  , 'files:save-pasted': { input: z.object({ name: z.string().max(200), base64: z.string().max(40_000_000) }).strict(), output: z.string() }
  , 'agents:cancel': { input: z.object({ runId: uuid }).strict(), output: z.object({ cancelled: z.boolean() }) }
  , 'plans:list': { input: cardIdInput, output: z.array(planSchema) }
  , 'plans:approve': { input: z.object({ planId: uuid }).strict(), output: planSchema }
  , 'worktrees:get': { input: cardIdInput, output: worktreeSchema.nullable() }
  , 'worktrees:prepare': { input: cardIdInput, output: worktreeSchema }
  , 'worktrees:snapshot': { input: cardIdInput, output: gitSnapshotSchema }
  , 'tests:run': { input: z.object({ cardId: uuid, executable: z.string().min(1).max(2048), args: z.array(z.string().max(4096)).max(100) }).strict(), output: testRunSchema }
  , 'quality:status': { input: cardIdInput, output: z.object({ test: testRunSchema.nullable(), review: reviewSchema.nullable() }) }
  , 'reviews:prepare-local': { input: cardIdInput, output: reviewSchema }
  , 'reviews:approve-local': { input: z.object({ reviewId: uuid }).strict(), output: reviewSchema }
  , 'git:repos': { input: z.object({ projectId: uuid }).strict(), output: z.array(gitRepoSchema) }
  , 'git:upstream': { input: z.object({ sourceId: uuid, cardId: uuid.nullable() }).strict(), output: z.object({ branch: z.string().nullable(), upstream: z.string().nullable(), remotes: z.array(z.string()) }) }
  , 'git:set-upstream': { input: z.object({ sourceId: uuid, cardId: uuid.nullable(), remote: z.string().min(1).max(100), branch: z.string().min(1).max(250) }).strict(), output: z.object({ upstream: z.string() }) }
  , 'git:detect': { input: z.object({ projectId: uuid }).strict(), output: z.object({ repos: z.array(gitRepoSchema), changed: z.boolean() }) }
  , 'git:setup-targets': { input: z.object({ projectId: uuid }).strict(), output: z.array(z.object({ sourceId: uuid, name: z.string(), path: z.string() })) }
  , 'git:setup': { input: z.object({ projectId: uuid, sourceId: uuid, mode: z.enum(['init', 'origin']), url: z.string().trim().max(500).optional() }).strict(), output: z.array(gitRepoSchema) }
  , 'git:graph': { input: z.object({ projectId: uuid, sourceId: uuid, limit: z.number().int().min(20).max(20000).optional() }).strict(), output: gitGraphSchema }
  , 'git:commit-detail': { input: z.object({ sourceId: uuid, hash: z.string().regex(/^[0-9a-f]{7,64}$/) }).strict(), output: z.object({ body: z.string(), files: z.array(gitCommitFileSchema) }) }
  , 'git:changes': { input: z.object(gitTarget).strict(), output: gitChangesSchema }
  , 'git:commit-diff': { input: z.object({ sourceId: uuid, hash: z.string().regex(/^[0-9a-f]{7,64}$/), path: z.string().min(1).max(4096) }).strict(), output: z.string() }
  , 'git:diff': { input: z.object({ ...gitTarget, path: z.string().min(1).max(4096), staged: z.boolean() }).strict(), output: z.string() }
  , 'git:stage': { input: z.object({ ...gitTarget, paths: z.array(z.string().min(1).max(4096)).max(5000), stage: z.boolean() }).strict(), output: gitChangesSchema }
  , 'git:commit': { input: z.object({ ...gitTarget, message: z.string().max(2000), description: z.string().max(20_000).optional(), amend: z.boolean().optional(), paths: z.array(z.string().min(1).max(4096)).max(5000).optional() }).strict(), output: z.object({ hash: z.string() }) }
  , 'git:branch-action': { input: z.object({ sourceId: uuid, action: z.enum(['checkout', 'pull', 'pull-rebase', 'push', 'rebase-onto', 'merge', 'create', 'delete', 'delete-remote']), name: z.string().min(1).max(250), newName: z.string().max(250).optional() }).strict(), output: z.object({ output: z.string() }) }
  , 'git:commit-action': { input: z.object({ sourceId: uuid, action: z.enum(['checkout', 'cherry-pick', 'revert', 'reset-soft', 'reset-mixed', 'reset-hard', 'branch', 'tag']), hash: z.string().regex(/^[0-9a-f]{7,64}$/), name: z.string().max(250).optional() }).strict(), output: z.object({ output: z.string() }) }
  , 'git:stash-action': { input: z.object({ sourceId: uuid, action: z.enum(['apply', 'pop', 'drop']), ref: z.string().regex(/^stash@\{\d+\}$/) }).strict(), output: z.object({ output: z.string() }) }
  , 'git:conflicts': { input: z.object({ sourceId: uuid, cardId: uuid.nullable().optional() }).strict(), output: z.object({ operation: z.enum(['merge', 'rebase', 'cherry-pick', 'revert']).nullable(), files: z.array(z.string()) }) }
  , 'git:conflict-file': { input: z.object({ sourceId: uuid, cardId: uuid.nullable().optional(), path: z.string().min(1).max(1000) }).strict(), output: z.string() }
  , 'git:conflict-save': { input: z.object({ sourceId: uuid, cardId: uuid.nullable().optional(), path: z.string().min(1).max(1000), content: z.string().max(2_000_000) }).strict(), output: z.object({ left: z.number().int() }) }
  , 'git:conflicts-all': { input: z.object({ projectId: uuid }).strict(), output: z.array(z.object({ sourceId: uuid, cardId: uuid.nullable(), repo: z.string(), cardTitle: z.string().nullable(), operation: z.enum(['merge', 'rebase', 'cherry-pick', 'revert']), files: z.array(z.string()) })) }
  , 'git:file-versions': { input: z.object({ ...gitTarget, path: z.string().min(1).max(4096), mode: z.enum(['unstaged', 'staged', 'commit']), hash: z.string().regex(/^[0-9a-f]{7,64}$/).optional() }).strict(), output: z.object({ before: z.string().nullable(), after: z.string().nullable(), binary: z.boolean(), truncated: z.boolean() }) }
  , 'git:conflict-resolve': { input: z.object({ sourceId: uuid, cardId: uuid.nullable().optional(), path: z.string().min(1).max(1000), side: z.enum(['ours', 'theirs', 'marked']) }).strict(), output: z.object({ left: z.number().int() }) }
  , 'git:conflict-finish': { input: z.object({ sourceId: uuid, cardId: uuid.nullable().optional(), action: z.enum(['continue', 'abort']) }).strict(), output: z.object({ output: z.string() }) }
  , 'app:open-link': { input: z.object({ url: z.string().min(1).max(2048) }).strict(), output: z.object({ opened: z.literal(true) }) }
  , 'git:sync': { input: z.object({ ...gitTarget, action: z.enum(['fetch', 'pull', 'push', 'stash', 'pop']), pull: z.enum(['ff', 'ff-only', 'rebase']).optional() }).strict(), output: z.object({ output: z.string() }) }
  , 'git:card': { input: cardIdInput, output: gitCardSchema }
  , 'git:base-options': { input: z.object({ sourceId: uuid }).strict(), output: z.array(z.string()) }
  , 'git:set-base': { input: z.object({ cardId: uuid, sourceId: uuid, baseRef: z.string().trim().min(1).max(200) }).strict(), output: z.object({ baseRef: z.string() }) }
  , 'git:policy-get': { input: z.object({ projectId: uuid }).strict(), output: gitPolicySchema }
  , 'git:policy-set': { input: z.object({ projectId: uuid, policy: gitPolicySchema }).strict(), output: gitPolicySchema }
  , 'git:requests': { input: cardIdInput, output: z.array(gitRequestSchema) }
  , 'git:request-decide': { input: z.object({ requestId: uuid, decision: z.enum(['allow', 'deny']), message: z.string().max(2000).optional() }).strict(), output: gitRequestSchema }
} as const

export type IpcChannel = keyof typeof ipcContracts
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcContracts)[C]['input']>
export type IpcOutput<C extends IpcChannel> = z.output<(typeof ipcContracts)[C]['output']>
export type GitRule = z.output<typeof gitRuleSchema>
export type GitPolicy = z.output<typeof gitPolicySchema>
export type GitRepo = z.output<typeof gitRepoSchema>
export type GitRow = z.output<typeof gitRowSchema>
export type GitRef = z.output<typeof gitRefSchema>
export type GitGraph = z.output<typeof gitGraphSchema>
export type GitChange = z.output<typeof gitChangeSchema>
export type GitChanges = z.output<typeof gitChangesSchema>
export type GitCommitFile = z.output<typeof gitCommitFileSchema>
export type GitRequest = z.output<typeof gitRequestSchema>
export type GitCard = z.output<typeof gitCardSchema>
export type GitCardRepo = z.output<typeof gitCardRepoSchema>
export type Note = z.output<typeof noteSchema>
export type BackupSummary = z.output<typeof backupSummarySchema>
export type AppTheme = z.output<typeof themeSchema>
export type AppLanguage = z.output<typeof languageSchema>
export type AppSettings = z.output<typeof appSettingsSchema>
export type AgentProfile = z.output<typeof agentProfileSchema>
export type Project = z.output<typeof projectSchema>
export type ProjectInspection = z.output<typeof projectInspectionSchema>
export type ProjectSource = z.output<typeof projectSourceSchema>
export type BoardColumn = z.output<typeof boardColumnSchema>
export type CardDocumentKind = z.output<typeof cardDocumentKindSchema>
export type CardDocument = z.output<typeof cardDocumentSchema>
export type CardDocuments = z.output<typeof cardDocumentsSchema>
export type DocumentVersion = z.output<typeof documentVersionSchema>
export type AgentPurpose = z.output<typeof agentPurposeSchema>
export type AgentConfig = z.output<typeof agentConfigSchema>
export type CardAgents = z.output<typeof cardAgentsSchema>
export type ModelOption = z.output<typeof modelOptionSchema>
export type AgentOptions = z.output<typeof agentOptionsSchema>
export type Effort = z.output<typeof effortSchema>
export type CardRunState = z.output<typeof cardRunStateSchema>
export type Card = z.output<typeof cardSchema>
export type ProjectBoard = z.output<typeof projectBoardSchema>
export type AgentProbe = z.output<typeof agentProbeSchema>
export type Chat = z.output<typeof chatSchema>
export type ChatPurpose = z.output<typeof chatPurposeSchema>
export type Constitution = z.output<typeof constitutionSchema>
export type ConstitutionProposal = z.output<typeof constitutionProposalSchema>
export type ConstitutionState = z.output<typeof constitutionStateSchema>
export type CardChecklist = z.output<typeof cardChecklistSchema>
export type ChatMessage = z.output<typeof chatMessageSchema>
export type Run = z.output<typeof runSchema>
export type RunEvent = z.output<typeof runEventSchema>
export type PushedRunEvent = Pick<RunEvent, 'runId' | 'eventType' | 'payload'>
export type Plan = z.output<typeof planSchema>
export type Worktree = z.output<typeof worktreeSchema>
export type GitSnapshot = z.output<typeof gitSnapshotSchema>
export type TestRun = z.output<typeof testRunSchema>
export type Review = z.output<typeof reviewSchema>

export interface AgentBoardApi {
  invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutput<C>>
  onRunEvent(listener: (event: PushedRunEvent) => void): () => void
  getDroppedFilePath(file: File): string
}
export * from './questions'
export * from './assessments'
