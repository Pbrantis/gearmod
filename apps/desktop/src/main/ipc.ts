import { systemDocumentKinds, ipcContracts, type AppLanguage, type VoiceModel, type AppTheme, type AgentConfig, type AgentPurpose, type CardDocumentKind, type IpcChannel, type IpcOutput } from '@agentboard/contracts'
import type { BackupService } from './backup'
import type { AppDatabase } from './database'
import type { NoteRepository } from './repository'
import type { SettingsRepository } from './settings'
import type { BoardRepository, GitService, ProfileRepository, ProjectRepository } from './projects'
import type { AgentProbeService } from './agents'
import type { ConversationRepository } from './conversations'
import type { AgentOrchestrator } from './orchestrator'
import type { WorktreeService } from './worktrees'
import type { QualityService } from './quality'
import type { ExecutionService } from './executions'
import type { AgentConfigRepository } from './agent-config'
import type { SkillService } from './skills'
import type { VoiceService } from './voice'
import type { UsageService } from './usage'
import type { CollaborationService } from './collaboration'

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, input: unknown) => unknown): void
  removeHandler(channel: string): void
}

interface Services {
  database: AppDatabase
  backups: BackupService
  notes: NoteRepository
  settings: SettingsRepository
  profiles: ProfileRepository
  projects: ProjectRepository
  board: BoardRepository
  git: GitService
  chooseDirectory(): Promise<string | null>
  agentProbes: AgentProbeService
  conversations: ConversationRepository
  orchestrator: AgentOrchestrator
  worktrees: WorktreeService
  quality: QualityService
  executions: ExecutionService
  agentConfigs: AgentConfigRepository
  skills: SkillService
  voice: VoiceService
  usage: UsageService
  collab: CollaborationService
  chooseSkillSource(): Promise<string | null>
  appVersion: string
  dataDir: string
  reopen(): Promise<void>
}

type Handler = (input: never) => unknown | Promise<unknown>

export function registerIpc(ipcMain: IpcMainLike, services: Services): () => void {
  const handlers: Record<IpcChannel, Handler> = {
    'app:info': () => ({ appVersion: services.appVersion, schemaVersion: services.database.schemaVersion(), dataDir: services.dataDir }),
    'notes:list': () => services.notes.list(),
    'notes:create': (input: { body: string }) => services.notes.create(input.body),
    'notes:delete': (input: { id: string }) => ({ deleted: services.notes.delete(input.id) }),
    'backups:list': () => services.backups.list(),
    'backups:create': () => services.backups.create(services.database.db, 'manual'),
    'backups:restore': async (input: { backupId: string }) => {
      services.database.close()
      await services.backups.restore(input.backupId, services.database.path)
      await services.reopen()
      return { restored: true as const }
    },
    'settings:get': () => services.settings.get(),
    'settings:update': (input: { tema?: AppTheme; idioma?: AppLanguage; voz?: VoiceModel }) => services.settings.update(input),
    'profiles:list': () => services.profiles.list(),
    'profiles:create': (input: { provider: 'codex' | 'claude'; label: string; scope: string; useExistingSession: boolean; color?: string }) => services.profiles.create(input),
    'profiles:update': (input: { profileId: string; label: string; scope: string; color?: string }) => services.profiles.update(input),
    'profiles:delete': (input: { profileId: string }) => services.profiles.delete(input.profileId),
    'profiles:removed': () => services.profiles.removed(),
    'profiles:probe': (input: { profileId: string }) => services.agentProbes.probe(input.profileId),
    'profiles:probe-all': () => services.agentProbes.probeAll(),
    'profiles:detect-provider': (input: { provider: 'codex' | 'claude' }) => services.agentProbes.detectProvider(input.provider),
    'profiles:install-provider': (input: { provider: 'codex' | 'claude' }) => services.agentProbes.installProvider(input.provider),
    'profiles:install': (input: { profileId: string }) => services.agentProbes.install(input.profileId),
    'profiles:login': (input: { profileId: string }) => services.agentProbes.login(input.profileId),
    'projects:list': () => services.projects.list(),
    'projects:create': async (input: { name?: string; sourcePaths: string[]; profileIds: string[] }) => {
      const probes = await Promise.all(input.profileIds.map((profileId) => services.agentProbes.probe(profileId)))
      if (probes.some((probe) => !probe.installed || !probe.authenticated)) throw new Error('Todos os agentes selecionados precisam estar instalados e conectados')
      return services.projects.create(input)
    },
    'projects:update': (input: { projectId: string; name: string }) => services.projects.update(input),
    'projects:inspect': (input: { localPath: string }) => services.git.inspect(input.localPath),
    'projects:branches': (input: { localPath: string }) => services.git.branches(input.localPath),
    'projects:choose-directory': () => services.chooseDirectory(),
    'projects:set-profiles': async (input: { projectId: string; profileIds: string[] }) => {
      if (!input.profileIds.length) return services.projects.setProfiles(input.projectId, [])
      const probes = await Promise.all(input.profileIds.map((profileId) => services.agentProbes.probe(profileId)))
      if (probes.some((probe) => !probe.installed || !probe.authenticated)) throw new Error('Todos os agentes selecionados precisam estar instalados e conectados')
      return services.projects.setProfiles(input.projectId, input.profileIds)
    },
    'board:get': (input: { projectId: string }) => services.board.get(input.projectId),
    'cards:create': (input: { projectId: string; columnId: string; sourceId?: string | null; type: string; title: string; description: string; priority: string; acceptanceCriteria: { body: string; checked: boolean }[] }) => services.board.create(input),
    'cards:update': (input: { cardId: string; sourceId?: string | null; type: string; title: string; description: string; priority: string; acceptanceCriteria: { body: string; checked: boolean }[] }) => services.board.update(input),
    'cards:move': (input: { cardId: string; columnId: string; beforeCardId: string | null }) => services.board.move(input.cardId, input.columnId, input.beforeCardId),
    'cards:archive': (input: { cardId: string }) => services.board.archive(input.cardId),
    'cards:restore': (input: { cardId: string }) => services.board.archive(input.cardId, true),
    'cards:get': (input: { cardId: string }) => services.board.card(input.cardId),
    'cards:documents': (input: { cardId: string }) => services.board.documents.get(input.cardId),
    'collab:list': (input: { cardId: string }) => services.collab.list(input.cardId),
    'collab:decide-change': (input: { changeId: string; decision: 'accept' | 'reject' | 'suggest'; note?: string }) => services.collab.decideChange(input.changeId, input.decision, input.note),
    'collab:answer-question': (input: { questionId: string; answer: string }) => services.collab.answerByUser(input.questionId, input.answer),
    'cards:write-document': (input: { cardId: string; kind: CardDocumentKind; contentMd: string }) => (systemDocumentKinds as readonly string[]).includes(input.kind) ? (() => { throw new Error('Este documento é gerado pelo sistema') })() : services.board.documents.write(input.cardId, input.kind, input.contentMd, 'user'),
    'cards:document-versions': (input: { cardId: string; kind: CardDocumentKind }) => services.board.documents.versions(input.cardId, input.kind),
    'cards:toggle-task': (input: { cardId: string; line: number; checked: boolean }) => services.board.documents.setTask(input.cardId, input.line, input.checked, 'user'),
    'cards:start': (input: { cardId: string; config: AgentConfig; purpose?: 'execution' | 'test' }) => services.executions.start(input.cardId, input.config, input.purpose),
    'agents:options': (input: { profileId: string }) => services.agentConfigs.options(input.profileId),
    'cards:agent-config': (input: { cardId: string }) => services.agentConfigs.get(input.cardId),
    'cards:set-agent-config': (input: { cardId: string; purpose: AgentPurpose; config: AgentConfig }) => services.agentConfigs.set(input.cardId, input.purpose, input.config),
    'cards:resume': (input: { cardId: string; purpose?: 'execution' | 'test' }) => services.executions.resume(input.cardId, input.purpose),
    'chats:reset': (input: { chatId: string }) => { services.conversations.resetChat(input.chatId); return { reset: true as const } },
    'cards:mark-viewed': (input: { cardId: string }) => services.board.markViewed(input.cardId),
    'skills:list': (input: { scope: 'global' | 'project'; projectId?: string }) => services.skills.list(input.scope, input.projectId),
    'skills:choose-source': () => services.chooseSkillSource(),
    'skills:import': (input: { scope: 'global' | 'project'; projectId?: string; sourcePath: string; name: string; provider: 'claude' | 'codex' }) => services.skills.import(input),
    'skills:convert': (input: { scope: 'global' | 'project'; projectId?: string; name: string; from: 'claude' | 'codex'; to: 'claude' | 'codex'; reviewProfileId?: string; model?: string | null }) => services.skills.convert(input),
    'chats:set-skill': async (input: { chatId: string; skill: { name: string; path: string } | null }) => {
      if (input.skill) await services.skills.assertKnown(input.skill, services.conversations.projectOf(input.chatId))
      return services.conversations.setSkill(input.chatId, input.skill)
    },
    'voice:status': () => services.voice.status(services.settings.get().voz),
    'voice:install': () => services.voice.install(services.settings.get().voz),
    'voice:transcribe': async (input: { wav: Uint8Array; prompt?: string }) => { const settings = services.settings.get(); return { text: await services.voice.transcribe({ wav: input.wav, model: settings.voz, language: settings.idioma === 'en' ? 'en' : 'pt', prompt: input.prompt }) } },
    'usage:list': () => services.usage.list(),
    'usage:refresh': () => services.usage.refresh(),
    'cards:delete': (input: { cardId: string }) => ({ deleted: services.board.delete(input.cardId) })
    , 'chats:list': (input: { projectId: string; cardId?: string | null }) => services.conversations.listChats(input.projectId, input.cardId)
    , 'chats:create': async (input: { projectId: string; cardId: string | null; purpose: AgentPurpose; profileId: string; skill?: { name: string; path: string } | null }) => { if (input.skill) await services.skills.assertKnown(input.skill, input.projectId); return services.conversations.createChat(input) }
    , 'messages:list': (input: { chatId: string }) => services.conversations.listMessages(input.chatId)
    , 'messages:add': (input: { chatId: string; role: string; body: string; status: string }) => services.conversations.addMessage(input)
    , 'runs:create': (input: { cardId: string; chatId: string; profileId: string }) => services.conversations.createRun(input)
    , 'runs:event': (input: { runId: string; eventType: string; payload: Record<string, unknown> }) => services.conversations.appendEvent(input.runId, input.eventType, input.payload)
    , 'agents:start': (input: { chatId: string; prompt: string; planning: boolean }) => services.orchestrator.start(input)
    , 'agents:cancel': (input: { runId: string }) => ({ cancelled: services.orchestrator.cancel(input.runId) })
    , 'plans:list': (input: { cardId: string }) => services.conversations.listPlans(input.cardId)
    , 'plans:approve': (input: { planId: string }) => services.conversations.approvePlan(input.planId)
    , 'worktrees:get': (input: { cardId: string }) => services.worktrees.get(input.cardId)
    , 'worktrees:prepare': (input: { cardId: string }) => services.worktrees.prepare(input.cardId)
    , 'worktrees:snapshot': (input: { cardId: string }) => services.worktrees.snapshot(input.cardId)
    , 'tests:run': (input: { cardId: string; executable: string; args: string[] }) => services.quality.runTest(input.cardId, input.executable, input.args)
    , 'reviews:prepare-local': (input: { cardId: string }) => services.quality.prepareLocalReview(input.cardId)
    , 'reviews:approve-local': (input: { reviewId: string }) => services.quality.approveLocal(input.reviewId)
  }
  const channels = Object.keys(ipcContracts) as IpcChannel[]
  for (const channel of channels) {
    ipcMain.handle(channel, async (_event, rawInput) => {
      const contract = ipcContracts[channel]
      const input = contract.input.parse(rawInput)
      const output = await handlers[channel](input as never)
      return contract.output.parse(output) as IpcOutput<typeof channel>
    })
  }
  return () => channels.forEach((channel) => ipcMain.removeHandler(channel))
}
