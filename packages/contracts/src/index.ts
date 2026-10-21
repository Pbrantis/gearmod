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
export const semanticStateSchema = z.enum(['todo', 'doing', 'test', 'mr', 'done'])

export const agentProfileSchema = z.object({
  id: uuid, provider: z.enum(['codex', 'claude']), label: z.string(), scope: z.string(),
  configDir: z.string(), executablePath: z.string().nullable(), enabled: z.boolean()
})
export const createAgentProfileInputSchema = z.object({
  provider: z.enum(['codex', 'claude']), label: z.string().trim().min(1).max(80),
  scope: z.string().trim().min(1).max(80), useExistingSession: z.boolean()
}).strict()
export const boardColumnSchema = z.object({ id: uuid, projectId: uuid, label: z.string(), sortOrder: z.number().int(), semanticState: semanticStateSchema, isDefault: z.boolean() })
export const projectSourceSchema = z.object({
  id: uuid, projectId: uuid, name: z.string(), localPath: z.string(), isGitRepository: z.boolean(), currentBranch: z.string().nullable(), sortOrder: z.number().int()
})
export const projectSchema = z.object({
  id: uuid, name: z.string(), localPath: z.string(), baseBranch: z.string(), remoteProvider: z.string().nullable(),
  allowedProfileIds: z.array(uuid), sources: z.array(projectSourceSchema), createdAt: isoDate, updatedAt: isoDate
})
export const projectInspectionSchema = z.object({
  localPath: z.string(), name: z.string(), repositories: z.array(z.object({ localPath: z.string(), name: z.string(), currentBranch: z.string(), branches: z.array(z.string()) }))
})
export const criterionSchema = z.object({ id: uuid, cardId: uuid, body: z.string(), checked: z.boolean(), sortOrder: z.number().int() })
export const cardSchema = z.object({
  id: uuid, projectId: uuid, columnId: uuid, sourceId: uuid.nullable(), type: cardTypeSchema, title: z.string(), description: z.string(),
  priority: cardPrioritySchema, orderKey: z.number(), createdAt: isoDate, updatedAt: isoDate,
  archivedAt: isoDate.nullable(), acceptanceCriteria: z.array(criterionSchema)
})
export const projectBoardSchema = z.object({ project: projectSchema, columns: z.array(boardColumnSchema), cards: z.array(cardSchema) })
export const agentProbeSchema = z.object({
  profileId: uuid, provider: z.enum(['codex', 'claude']), installed: z.boolean(), authenticated: z.boolean(),
  version: z.string().nullable(), executablePath: z.string().nullable(), capabilities: z.array(z.string()), checkedAt: isoDate,
  error: z.string().nullable()
})
export const chatSchema = z.object({ id: uuid, projectId: uuid, cardId: uuid.nullable(), purpose: z.enum(['planning', 'execution']), provider: z.enum(['codex', 'claude']), profileId: uuid, providerSessionId: z.string().nullable(), createdAt: isoDate, updatedAt: isoDate })
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
  projectId: uuid, columnId: uuid, sourceId: uuid.nullable().optional(), type: cardTypeSchema, title: z.string().trim().min(1).max(240),
  description: z.string().max(20_000).default(''), priority: cardPrioritySchema,
  acceptanceCriteria: z.array(criterionInputSchema).max(50).default([])
}).strict()
export const updateCardInputSchema = createCardInputSchema.omit({ projectId: true, columnId: true }).extend({ cardId: uuid }).strict()
export const moveCardInputSchema = z.object({ cardId: uuid, columnId: uuid, beforeCardId: uuid.nullable().default(null) }).strict()

export const ipcContracts = {
  'app:info': { input: z.undefined(), output: appInfoSchema },
  'notes:list': { input: z.undefined(), output: z.array(noteSchema) },
  'notes:create': { input: createNoteInputSchema, output: noteSchema },
  'notes:delete': { input: deleteNoteInputSchema, output: z.object({ deleted: z.boolean() }) },
  'backups:list': { input: z.undefined(), output: z.array(backupSummarySchema) },
  'backups:create': { input: z.undefined(), output: backupSummarySchema },
  'backups:restore': { input: restoreBackupInputSchema, output: z.object({ restored: z.literal(true) }) }
  , 'profiles:list': { input: z.undefined(), output: z.array(agentProfileSchema) }
  , 'profiles:create': { input: createAgentProfileInputSchema, output: agentProfileSchema }
  , 'profiles:update': { input: z.object({ profileId: uuid, label: z.string().trim().min(1).max(80), scope: z.string().trim().min(1).max(80) }).strict(), output: agentProfileSchema }
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
  , 'chats:list': { input: projectIdInput.extend({ cardId: uuid.nullable().optional() }).strict(), output: z.array(chatSchema) }
  , 'chats:create': { input: z.object({ projectId: uuid, cardId: uuid.nullable(), purpose: z.enum(['planning', 'execution']), profileId: uuid }).strict(), output: chatSchema }
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
export type AgentProfile = z.output<typeof agentProfileSchema>
export type Project = z.output<typeof projectSchema>
export type ProjectInspection = z.output<typeof projectInspectionSchema>
export type ProjectSource = z.output<typeof projectSourceSchema>
export type BoardColumn = z.output<typeof boardColumnSchema>
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
