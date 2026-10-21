import { z } from 'zod'

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
export const cardTypeSchema = z.enum(['feature', 'bug', 'improvement', 'task'])
export const cardPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
export const semanticStateSchema = z.enum(['backlog', 'todo', 'doing', 'test', 'done'])

export const agentProviderSchema = z.enum(['codex', 'claude'])
export const agentColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
/** Cores de personalidade oferecidas ao cadastrar um agente; a cor é independente do tema do sistema. */
export const agentColorPalette = ['#D97757', '#E5A24B', '#9ccf6f', '#6fc3b2', '#8fb8d6', '#aeb9ff', '#b98fd6', '#e07a9a'] as const
export const defaultAgentColor = (provider: z.infer<typeof agentProviderSchema>): string => (provider === 'claude' ? agentColorPalette[0] : agentColorPalette[5])
export const themeSchema = z.enum(['green', 'purple', 'blue', 'orange'])
export const languageSchema = z.enum(['pt-BR', 'en'])
export const voiceModelSchema = z.enum(['small', 'large-v3-turbo'])
export const appSettingsSchema = z.object({ tema: themeSchema, idioma: languageSchema, voz: voiceModelSchema })
export const updateAppSettingsInputSchema = z.object({ tema: themeSchema.optional(), idioma: languageSchema.optional(), voz: voiceModelSchema.optional() }).strict()
export const voiceStatusSchema = z.object({ model: voiceModelSchema, modelInstalled: z.boolean(), engineInstalled: z.boolean(), canInstallEngine: z.boolean(), sizeMb: z.number(), downloading: z.object({ item: z.enum(['programa', 'modelo']), received: z.number(), total: z.number().nullable() }).nullable() })
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
export const projectSchema = z.object({
  id: uuid, name: z.string(), localPath: z.string(), baseBranch: z.string(), remoteProvider: z.string().nullable(),
  allowedProfileIds: z.array(uuid), sources: z.array(projectSourceSchema), activity: z.object({ running: z.number().int().nonnegative(), finished: z.number().int().nonnegative() }), createdAt: isoDate, updatedAt: isoDate
})
export const projectInspectionSchema = z.object({
  localPath: z.string(), name: z.string(), repositories: z.array(z.object({ localPath: z.string(), name: z.string(), currentBranch: z.string(), branches: z.array(z.string()) }))
})
export const agentPurposeSchema = z.enum(['planning', 'execution'])
export const permissionModeSchema = z.enum(['plan', 'auto', 'accept_edits', 'manual', 'on_request', 'read_only', 'bypass'])
export const effortSchema = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
export const agentConfigSchema = z.object({ profileId: uuid, model: z.string().trim().max(120).nullable(), effort: effortSchema.nullable(), mode: permissionModeSchema })
export const cardAgentsSchema = z.object({ planning: agentConfigSchema.nullable(), execution: agentConfigSchema.nullable() })
export const modelOptionSchema = z.object({ id: z.string(), label: z.string(), description: z.string(), efforts: z.array(effortSchema), recommendedFor: z.array(agentPurposeSchema), defaultEffort: effortSchema.nullable() })
export const mostUsedSchema = z.object({ model: z.string().nullable(), effort: effortSchema.nullable() }).nullable()
export const agentOptionsSchema = z.object({ models: z.array(modelOptionSchema), mostUsed: z.object({ planning: mostUsedSchema, execution: mostUsedSchema }) })

export type PermissionMode = z.infer<typeof permissionModeSchema>
export interface PermissionModeInfo { id: PermissionMode; label: string; description: string; purposes: Array<z.infer<typeof agentPurposeSchema>>; needsApprovalUi?: boolean; dangerous?: boolean; recommended?: boolean }
/** Modos de permissão por provedor (plano 08, seção 6). Modos que dependem da tela de aprovação (F14, pendente) ficam desabilitados. */
export const permissionModes: Record<'claude' | 'codex', PermissionModeInfo[]> = {
  claude: [
    { id: 'plan', label: 'Plano', description: 'Só lê e planeja; não altera arquivos.', purposes: ['planning'], recommended: true },
    { id: 'accept_edits', label: 'Aceitar edições', description: 'Edita arquivos sem perguntar; comandos fora da lista são negados.', purposes: ['execution'], recommended: true },
    { id: 'auto', label: 'Automático', description: 'O próprio Claude decide o que é seguro aprovar.', purposes: ['execution'] },
    { id: 'manual', label: 'Manual', description: 'Pergunta a cada ação. Precisa da tela de aprovação (em breve).', purposes: ['execution'], needsApprovalUi: true },
    { id: 'bypass', label: 'Ignorar permissões', description: 'Executa tudo sem pedir. Use só em ambiente descartável.', purposes: ['execution'], dangerous: true }
  ],
  codex: [
    { id: 'plan', label: 'Plano', description: 'Somente leitura, só planeja.', purposes: ['planning'], recommended: true },
    { id: 'auto', label: 'Automático', description: 'Edita na pasta do projeto e uma revisão automática aprova o que for seguro.', purposes: ['execution'], recommended: true },
    { id: 'on_request', label: 'Sob pedido', description: 'Edita na pasta do projeto e pede aprovação para o resto. Precisa da tela de aprovação (em breve).', purposes: ['execution'], needsApprovalUi: true },
    { id: 'read_only', label: 'Somente leitura', description: 'Lê e pede aprovação para qualquer mudança. Precisa da tela de aprovação (em breve).', purposes: ['execution'], needsApprovalUi: true },
    { id: 'bypass', label: 'Ignorar permissões', description: 'Sem sandbox e sem aprovações. Use só em ambiente descartável.', purposes: ['execution'], dangerous: true }
  ]
}
export const defaultPermissionMode = (provider: 'claude' | 'codex', purpose: z.infer<typeof agentPurposeSchema>): PermissionMode => (purpose === 'planning' ? 'plan' : provider === 'claude' ? 'accept_edits' : 'auto')

export const skillScopeSchema = z.enum(['global', 'project'])
export const skillProviderStateSchema = z.enum(['ready', 'none', 'converting'])
export const skillEntrySchema = z.object({
  id: z.string(), name: z.string(), description: z.string(), scope: skillScopeSchema, detected: z.boolean(),
  providers: z.object({ claude: skillProviderStateSchema, codex: skillProviderStateSchema }),
  paths: z.object({ claude: z.string().nullable(), codex: z.string().nullable() })
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

export const cardDocumentKinds = ['resumo', 'especificacao', 'plano', 'tasks'] as const
export const cardDocumentKindSchema = z.enum(cardDocumentKinds)
export const cardDocumentSchema = z.object({ kind: cardDocumentKindSchema, contentMd: z.string(), updatedAt: isoDate.nullable(), updatedBy: z.enum(['user', 'agent', 'system']).nullable() })
export const cardDocumentsSchema = z.object({ resumo: cardDocumentSchema, especificacao: cardDocumentSchema, plano: cardDocumentSchema, tasks: cardDocumentSchema })
export const documentVersionSchema = z.object({ id: uuid, version: z.number().int().positive(), contentMd: z.string(), createdAt: isoDate, actor: z.enum(['user', 'agent', 'system']) })
export const taskCountSchema = z.object({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
export const criterionSchema = z.object({ id: uuid, cardId: uuid, body: z.string(), checked: z.boolean(), sortOrder: z.number().int() })
export const cardRunStateSchema = z.object({ state: z.enum(['idle', 'planning', 'running', 'paused', 'finished']), runId: uuid.nullable(), profileId: uuid.nullable() })
export const cardSchema = z.object({
  id: uuid, projectId: uuid, columnId: uuid, sourceId: uuid.nullable(), type: cardTypeSchema, title: z.string(), description: z.string(),
  priority: cardPrioritySchema, orderKey: z.number(), createdAt: isoDate, updatedAt: isoDate,
  archivedAt: isoDate.nullable(), acceptanceCriteria: z.array(criterionSchema), tasks: taskCountSchema, run: cardRunStateSchema
})
export const projectBoardSchema = z.object({ project: projectSchema, columns: z.array(boardColumnSchema), cards: z.array(cardSchema) })
export const agentProbeSchema = z.object({
  profileId: uuid, provider: z.enum(['codex', 'claude']), installed: z.boolean(), authenticated: z.boolean(),
  version: z.string().nullable(), executablePath: z.string().nullable(), capabilities: z.array(z.string()), checkedAt: isoDate,
  error: z.string().nullable()
})
export const chatSchema = z.object({ id: uuid, projectId: uuid, cardId: uuid.nullable(), purpose: z.enum(['planning', 'execution']), provider: z.enum(['codex', 'claude']), profileId: uuid, providerSessionId: z.string().nullable(), skill: skillRefSchema.nullable(), createdAt: isoDate, updatedAt: isoDate })
export const chatMessageSchema = z.object({ id: uuid, chatId: uuid, role: z.enum(['user', 'assistant', 'system', 'tool']), body: z.string(), status: z.enum(['streaming', 'complete', 'failed']), createdAt: isoDate, providerMessageId: z.string().nullable() })
export const runSchema = z.object({ id: uuid, cardId: uuid, chatId: uuid, profileId: uuid, status: z.enum(['queued', 'running', 'completed', 'failed', 'interrupted', 'cancelled']), startedAt: isoDate, endedAt: isoDate.nullable(), exitReason: z.string().nullable(), worktreeId: uuid.nullable(), providerTurnId: z.string().nullable() })
export const runEventSchema = z.object({ id: uuid, runId: uuid, seq: z.number().int().nonnegative(), eventType: z.string(), payload: z.record(z.string(), z.unknown()), createdAt: isoDate })
export const planSchema = z.object({ id: uuid, cardId: uuid, version: z.number().int().positive(), agentProfileId: uuid, contentMd: z.string(), status: z.enum(['draft', 'approved', 'superseded']), createdAt: isoDate, approvedAt: isoDate.nullable() })
export const worktreeSchema = z.object({ id: uuid, cardId: uuid, repoPath: z.string(), path: z.string(), branch: z.string(), baseRef: z.string(), createdAt: isoDate, cleanupState: z.enum(['active', 'missing', 'cleanup-requested', 'removed']) })
export const gitSnapshotSchema = z.object({ worktreeId: uuid, status: z.string(), diff: z.string(), exists: z.boolean() })
export const testRunSchema = z.object({ id: uuid, cardId: uuid, command: z.string(), status: z.enum(['running', 'passed', 'failed']), exitCode: z.number().int().nullable(), summary: z.string(), startedAt: isoDate, endedAt: isoDate.nullable() })
export const reviewSchema = z.object({ id: uuid, cardId: uuid, provider: z.enum(['github', 'gitlab', 'local']), remoteUrl: z.string().nullable(), remoteId: z.string().nullable(), state: z.enum(['open', 'approved', 'merged', 'closed']), targetBranch: z.string(), sourceBranch: z.string(), updatedAt: isoDate })

const projectIdInput = z.object({ projectId: uuid }).strict()
const cardIdInput = z.object({ cardId: uuid }).strict()
export const createProjectInputSchema = z.object({
  name: z.string().trim().max(120).optional(), sourcePaths: z.array(z.string().trim().min(1).max(2048)).min(1).max(20), profileIds: z.array(uuid).max(8).default([])
}).strict()
export const updateProjectInputSchema = z.object({ projectId: uuid, name: z.string().trim().min(1).max(120) }).strict()
export const setProjectProfilesInputSchema = z.object({ projectId: uuid, profileIds: z.array(uuid).max(8) }).strict()
const criterionInputSchema = z.object({ body: z.string().trim().min(1).max(2000), checked: z.boolean().default(false) })
export const createCardInputSchema = z.object({
  projectId: uuid, columnId: uuid, sourceId: uuid.nullable().optional(), type: cardTypeSchema, title: z.string().trim().max(240),
  description: z.string().max(20_000).default(''), priority: cardPrioritySchema,
  acceptanceCriteria: z.array(criterionInputSchema).max(50).default([])
}).strict()
export const updateCardInputSchema = createCardInputSchema.omit({ projectId: true, columnId: true }).extend({ cardId: uuid, title: z.string().trim().min(1).max(240) }).strict()
export const moveCardInputSchema = z.object({ cardId: uuid, columnId: uuid, beforeCardId: uuid.nullable().default(null) }).strict()

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
  , 'profiles:delete': { input: z.object({ profileId: uuid }).strict(), output: z.object({ deleted: z.boolean() }) }
  , 'profiles:probe': { input: z.object({ profileId: uuid }).strict(), output: agentProbeSchema }
  , 'profiles:probe-all': { input: z.undefined(), output: z.array(agentProbeSchema) }
  , 'profiles:detect-provider': { input: z.object({ provider: z.enum(['codex', 'claude']) }).strict(), output: z.object({ installed: z.boolean(), version: z.string().nullable(), error: z.string().nullable() }) }
  , 'profiles:install-provider': { input: z.object({ provider: z.enum(['codex', 'claude']) }).strict(), output: z.object({ started: z.literal(true) }) }
  , 'profiles:install': { input: z.object({ profileId: uuid }).strict(), output: z.object({ started: z.literal(true) }) }
  , 'profiles:login': { input: z.object({ profileId: uuid }).strict(), output: z.object({ started: z.literal(true) }) }
  , 'projects:list': { input: z.undefined(), output: z.array(projectSchema) }
  , 'projects:create': { input: createProjectInputSchema, output: projectSchema }
  , 'projects:update': { input: updateProjectInputSchema, output: projectSchema }
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
  , 'cards:start': { input: z.object({ cardId: uuid, config: agentConfigSchema }).strict(), output: runSchema }
  , 'cards:resume': { input: cardIdInput, output: runSchema }
  , 'cards:mark-viewed': { input: cardIdInput, output: cardSchema }
  , 'agents:options': { input: z.object({ profileId: uuid }).strict(), output: agentOptionsSchema }
  , 'cards:agent-config': { input: cardIdInput, output: cardAgentsSchema }
  , 'cards:set-agent-config': { input: z.object({ cardId: uuid, purpose: agentPurposeSchema, config: agentConfigSchema }).strict(), output: cardAgentsSchema }
  , 'skills:list': { input: z.object({ scope: skillScopeSchema, projectId: uuid.optional() }).strict(), output: z.array(skillEntrySchema) }
  , 'skills:choose-source': { input: z.undefined(), output: z.string().nullable() }
  , 'skills:import': { input: z.object({ scope: skillScopeSchema, projectId: uuid.optional(), sourcePath: z.string().trim().min(1).max(2048), name: z.string().trim().min(1).max(64), provider: agentProviderSchema }).strict(), output: z.array(skillEntrySchema) }
  , 'skills:convert': { input: z.object({ scope: skillScopeSchema, projectId: uuid.optional(), name: z.string().trim().min(1).max(64), from: agentProviderSchema, to: agentProviderSchema, reviewProfileId: uuid.optional(), model: z.string().max(120).nullable().optional() }).strict(), output: z.object({ converted: z.literal(true), reviewing: z.boolean() }) }
  , 'chats:set-skill': { input: z.object({ chatId: uuid, skill: skillRefSchema.nullable() }).strict(), output: chatSchema }
  , 'voice:status': { input: z.undefined(), output: voiceStatusSchema }
  , 'voice:install': { input: z.undefined(), output: voiceStatusSchema }
  , 'voice:transcribe': { input: z.object({ wav: z.instanceof(Uint8Array).refine((value) => value.byteLength <= 12 * 1024 * 1024, 'Gravação longa demais'), prompt: z.string().max(400).optional() }).strict(), output: z.object({ text: z.string() }) }
  , 'usage:list': { input: z.undefined(), output: z.array(agentUsageSchema) }
  , 'cards:delete': { input: cardIdInput, output: z.object({ deleted: z.boolean() }) }
  , 'chats:list': { input: projectIdInput.extend({ cardId: uuid.nullable().optional() }).strict(), output: z.array(chatSchema) }
  , 'chats:create': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), purpose: z.enum(['planning', 'execution']), profileId: uuid, skill: skillRefSchema.nullable().optional() }).strict(), output: chatSchema }
  , 'messages:list': { input: z.object({ chatId: uuid }).strict(), output: z.array(chatMessageSchema) }
  , 'messages:add': { input: z.object({ chatId: uuid, role: z.enum(['user', 'assistant', 'system', 'tool']), body: z.string().min(1).max(100_000), status: z.enum(['streaming', 'complete', 'failed']).default('complete') }).strict(), output: chatMessageSchema }
  , 'runs:create': { input: z.object({ cardId: uuid, chatId: uuid, profileId: uuid }).strict(), output: runSchema }
  , 'runs:event': { input: z.object({ runId: uuid, eventType: z.string().min(1).max(120), payload: z.record(z.string(), z.unknown()) }).strict(), output: runEventSchema }
  , 'agents:start': { input: z.object({ chatId: uuid, prompt: z.string().trim().min(1).max(100_000), planning: z.boolean() }).strict(), output: runSchema }
  , 'agents:cancel': { input: z.object({ runId: uuid }).strict(), output: z.object({ cancelled: z.boolean() }) }
  , 'plans:list': { input: cardIdInput, output: z.array(planSchema) }
  , 'plans:approve': { input: z.object({ planId: uuid }).strict(), output: planSchema }
  , 'worktrees:get': { input: cardIdInput, output: worktreeSchema.nullable() }
  , 'worktrees:prepare': { input: cardIdInput, output: worktreeSchema }
  , 'worktrees:snapshot': { input: cardIdInput, output: gitSnapshotSchema }
  , 'tests:run': { input: z.object({ cardId: uuid, executable: z.string().min(1).max(2048), args: z.array(z.string().max(4096)).max(100) }).strict(), output: testRunSchema }
  , 'reviews:prepare-local': { input: cardIdInput, output: reviewSchema }
  , 'reviews:approve-local': { input: z.object({ reviewId: uuid }).strict(), output: reviewSchema }
} as const

export type IpcChannel = keyof typeof ipcContracts
export type IpcInput<C extends IpcChannel> = z.input<(typeof ipcContracts)[C]['input']>
export type IpcOutput<C extends IpcChannel> = z.output<(typeof ipcContracts)[C]['output']>
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
