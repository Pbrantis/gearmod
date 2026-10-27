import { homedir } from 'node:os'
import { systemDocumentKinds, ipcContracts, type AppLanguage, type VoiceModel, type AppTheme, type AgentConfig, type AgentPurpose, type GitPolicy, type CardDocumentKind, type IpcChannel, type IpcOutput } from '@agentboard/contracts'
import type { PopoutTarget, WindowPlacement } from './windows'
import type { TerminalService } from './terminals'
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
import type { ConstitutionRepository } from './constitution'
import type { ChecklistRepository } from './checklists'
import type { VoiceService } from './voice'
import type { UsageService } from './usage'
import type { CollaborationService } from './collaboration'
import type { GitManager } from './git-manager'
import { fileVersions } from './file-versions'
import { grepProject } from './workspace-grep'
import { nativeGit } from './worktrees'
import { allowedPath, createProjectItem, listProjectDirectory, readProjectFile, renameProjectItem, saveMarkdownImage, searchProjectFiles, trashablePath, writeProjectFile } from './file-viewer'
import type { CardHistoryService } from './history'
import type { PlaywrightCliService } from './playwright-cli'
import type { FileWatchService } from './file-watch'
import type { SpecToolsService } from './spec-tools'
import type { ToolUpdateService } from './tool-updates'
import { applyWorkflowType } from './mcp-bridge'
import type { DecisionKind, DimensionScores, Effort, PermissionMode, WorkflowConfig, WorkflowKind } from '@agentboard/contracts'

const workflowState = (history: CardHistoryService, projectId: string) => ({ config: history.config(projectId), detected: history.detect(projectId), defaultArtifactsDir: history.defaultArtifactsRoot(projectId) })
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'

const imageMime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' }

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
  chooseFiles(): Promise<string[]>
  agentProbes: AgentProbeService
  conversations: ConversationRepository
  orchestrator: AgentOrchestrator
  worktrees: WorktreeService
  quality: QualityService
  executions: ExecutionService
  agentConfigs: AgentConfigRepository
  skills: SkillService
  constitution: ConstitutionRepository
  checklists: ChecklistRepository
  voice: VoiceService
  usage: UsageService
  collab: CollaborationService
  gitManager: GitManager
  history: CardHistoryService
  playwright: PlaywrightCliService
  fileWatch: FileWatchService
  specTools: SpecToolsService
  toolUpdates: ToolUpdateService
  openPath(path: string): Promise<void>
  terminals: TerminalService
  openWindow(target: PopoutTarget, placement: WindowPlacement, point?: { x: number; y: number }): void
  placeWindow(placement: WindowPlacement): void
  returnFile?(input: { projectId: string; cardId: string | null; path: string }): void
  attachFile?(input: { projectId: string; cardId: string | null; path: string }): void
  commentFile?(input: { projectId: string; cardId: string | null; text: string }): void
  openFileExternal?(path: string, target: 'explorer' | 'default' | 'vscode'): Promise<void>
  trashItem?(path: string): Promise<void>
  openExternal(url: string): Promise<void>
  chooseSkillSource(): Promise<string | null>
  appVersion: string
  dataDir: string
  reopen(): Promise<void>
}

type Handler = (input: never) => unknown | Promise<unknown>

export function registerIpc(ipcMain: IpcMainLike, services: Services): () => void {
  const workspaceRoots = ({ projectId, cardId }: { projectId: string; cardId: string | null }): string[] => {
    const project = services.projects.get(projectId)
    if (cardId && services.board.card(cardId).projectId !== projectId) throw new Error('Card não pertence ao projeto')
    const worktree = cardId ? services.worktrees.get(cardId) : null
    if (worktree && existsSync(worktree.path)) return [...new Set([worktree.path, ...services.worktrees.repositories(cardId!).filter((repo) => repo.status === 'active').map((repo) => repo.path)])]
    return [...new Set([project.localPath, ...project.sources.map((source) => source.localPath)])]
  }
  const handlers: Record<IpcChannel, Handler> = {
    'terminal:info': (input: { id: string }) => services.terminals.info(input.id),
    'terminal:resize': (input: { id: string; cols: number; rows: number }) => { services.terminals.resize(input.id, input.cols, input.rows); return {} },
    'workspace:external': async (input: { projectId: string; cardId: string | null; path: string; target: 'explorer' | 'default' | 'vscode' }) => { const path = await allowedPath(workspaceRoots(input), input.path); if (!services.openFileExternal) throw new Error('Abertura externa indisponível'); await services.openFileExternal(path, input.target); return {} },
    'workspace:comment': async (input: { projectId: string; cardId: string | null; text: string }) => { if (!services.commentFile) throw new Error('Chat indisponível'); services.commentFile(input); return {} },
    'workspace:attach': async (input: { projectId: string; cardId: string | null; path: string }) => { const path = await allowedPath(workspaceRoots(input), input.path); if (!statSync(path).isFile()) throw new Error('Escolha um arquivo para anexar'); if (!services.attachFile) throw new Error('Chat indisponível'); services.attachFile({ ...input, path }); return {} },
    'workspace:terminal': async (input: { projectId: string; cardId: string | null; path: string }) => { const path = await allowedPath(workspaceRoots(input), input.path), cwd = statSync(path).isDirectory() ? path : dirname(path), id = services.terminals.open(cwd); return { id, cwd, shell: services.terminals.info(id).shell } },
    'workspace:image': async (input: { projectId: string; cardId: string | null; path: string }) => { const path = await allowedPath(workspaceRoots(input), input.path), mime = imageMime[extname(path).toLowerCase()]; if (!mime || statSync(path).size > 20_000_000) throw new Error('Prévia disponível para imagens de até 20 MB'); return `data:${mime};base64,${readFileSync(path).toString('base64')}` },
    'workspace:roots': async (input: { projectId: string; cardId: string | null }) => {
      const worktree = input.cardId ? services.worktrees.get(input.cardId) : null, cards = services.board.get(input.projectId).cards, paths = workspaceRoots(input)
      return Promise.all(paths.map(async (path) => {
        const branch = worktree?.branch ?? await services.git.currentBranch(path)
        const card = input.cardId ? cards.find((item) => item.id === input.cardId) : branch ? cards.find((item) => !item.archivedAt && item.workspace?.branch === branch) : undefined
        const primary = !paths.some((parent) => parent !== path && relative(parent, path) !== '' && !relative(parent, path).startsWith('..') && !isAbsolute(relative(parent, path)))
        return { path, name: basename(path), branch, worktree: Boolean(worktree), primary, cardId: card?.id ?? null, cardTitle: card?.title || null }
      }))
    },
    'workspace:list': (input: { projectId: string; cardId: string | null; path: string }) => listProjectDirectory(workspaceRoots(input), input.path),
    'workspace:watch': async (input: { projectId: string; cardId: string | null; watchId: string; paths: string[] }) => { const roots = workspaceRoots(input), allowed = await Promise.all(input.paths.map((path) => allowedPath(roots, path).catch(() => null))); services.fileWatch.watch(input.watchId, allowed.filter((path): path is string => path !== null)); return {} },
    'workspace:create': (input: { projectId: string; cardId: string | null; parent: string; name: string; kind: 'file' | 'folder' }) => createProjectItem(workspaceRoots(input), input.parent, input.name, input.kind),
    'workspace:rename': (input: { projectId: string; cardId: string | null; path: string; name: string }) => renameProjectItem(workspaceRoots(input), input.path, input.name),
    'workspace:trash': async (input: { projectId: string; cardId: string | null; path: string }) => { const path = await trashablePath(workspaceRoots(input), input.path); if (!services.trashItem) throw new Error('Lixeira indisponível'); await services.trashItem(path); return {} },
    'workspace:grep': (input: { projectId: string; cardId: string | null; query: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean; include?: string | undefined }) => grepProject(workspaceRoots(input), input),
    'workspace:save-image': (input: { projectId: string; cardId: string | null; markdownPath: string; data: string; mime: string }) => saveMarkdownImage(workspaceRoots(input), input.markdownPath, input.data, input.mime),
    'workspace:search': (input: { projectId: string; cardId: string | null; query: string; fuzzy?: boolean | undefined }) => searchProjectFiles(workspaceRoots(input), input.query, input.fuzzy),
    'workspace:read': (input: { projectId: string; cardId: string | null; path: string }) => readProjectFile(workspaceRoots(input), input.path, true),
    'workspace:versions': (input: { projectId: string; cardId: string | null; path: string }) => fileVersions(workspaceRoots(input), input.path, { git: nativeGit, baseFor: (top) => input.cardId ? services.worktrees.baseFor(input.cardId, top) : Promise.resolve(null) }),
    'workspace:write': (input: { projectId: string; cardId: string | null; path: string; content: string; expected: string }) => writeProjectFile(workspaceRoots(input), input.path, input.content, input.expected),
    'windows:return-file': (input: { projectId: string; cardId: string | null; path: string }) => { workspaceRoots(input); services.returnFile?.(input); return {} },
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
    'profiles:update-provider': (input: { provider: 'codex' | 'claude' }) => services.agentProbes.updateProvider(input.provider),
    'tools:status': (input: { projectId: string }) => services.specTools.status(input.projectId),
    'tools:latest': (input: { force: boolean }) => services.toolUpdates.latest(input.force),
    'profiles:install-provider': (input: { provider: 'codex' | 'claude' }) => services.agentProbes.installProvider(input.provider),
    'profiles:install': (input: { profileId: string }) => services.agentProbes.install(input.profileId),
    'profiles:login': (input: { profileId: string }) => services.agentProbes.login(input.profileId),
    'projects:list': () => services.projects.list(),
    'projects:create': async (input: { name?: string; sourcePaths: string[]; profileIds: string[] }) => {
      const probes = await Promise.all(input.profileIds.map((profileId) => services.agentProbes.probe(profileId)))
      if (probes.some((probe) => !probe.installed || !probe.authenticated)) throw new Error('Todos os agentes selecionados precisam estar instalados e conectados')
      return services.projects.create(input)
    },
    'projects:reorder': (input: { projectIds: string[] }) => services.projects.reorder(input.projectIds),
    'projects:delete': (input: { projectId: string }) => ({ deleted: services.projects.delete(input.projectId) }),
    'projects:update': (input: { projectId: string; name: string; icon?: string | null }) => services.projects.update(input),
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
    'cards:move': (input: { cardId: string; columnId: string; beforeCardId: string | null; skipGate?: boolean }) => services.board.move(input.cardId, input.columnId, input.beforeCardId, 'user', input.skipGate),
    'cards:archive': (input: { cardId: string }) => services.board.archive(input.cardId),
    'cards:restore': (input: { cardId: string }) => services.board.archive(input.cardId, true),
    'cards:get': (input: { cardId: string }) => services.board.card(input.cardId),
    'cards:documents': (input: { cardId: string }) => services.board.documents.get(input.cardId),
    'collab:list': (input: { cardId: string }) => services.collab.list(input.cardId),
    'collab:send-change': (input: { changeId: string }) => services.collab.sendChange(input.changeId),
    'collab:decide-change': (input: { changeId: string; decision: 'accept' | 'reject' | 'suggest'; note?: string }) => services.collab.decideChange(input.changeId, input.decision, input.note),
    'collab:answer-question': (input: { questionId: string; answer: string }) => services.collab.answerByUser(input.questionId, input.answer),
    'cards:write-document': (input: { cardId: string; kind: CardDocumentKind; contentMd: string }) => (systemDocumentKinds as readonly string[]).includes(input.kind) ? (() => { throw new Error('Este documento é gerado pelo sistema') })() : services.board.documents.write(input.cardId, input.kind, input.contentMd, 'user'),
    'cards:document-versions': (input: { cardId: string; kind: CardDocumentKind }) => services.board.documents.versions(input.cardId, input.kind),
    'cards:toggle-task': (input: { cardId: string; line: number; checked: boolean }) => services.board.documents.setTask(input.cardId, input.line, input.checked, 'user'),
    'cards:start': (input: { cardId: string; config: AgentConfig; purpose?: 'execution' | 'test'; baseBranch?: string }) => services.executions.start(input.cardId, input.config, input.purpose, input.baseBranch),
    'cards:branches': (input: { cardId: string }) => services.executions.branches(input.cardId),
    'agents:options': (input: { profileId: string }) => services.agentConfigs.options(input.profileId),
    'cards:agent-config': (input: { cardId: string }) => services.agentConfigs.get(input.cardId),
    'cards:set-agent-config': (input: { cardId: string; purpose: AgentPurpose; config: AgentConfig }) => services.agentConfigs.set(input.cardId, input.purpose, input.config),
    'cards:resume': (input: { cardId: string; purpose?: 'execution' | 'test' }) => services.executions.resume(input.cardId, input.purpose),
    'chats:reset': (input: { chatId: string }) => { services.conversations.resetChat(input.chatId); return { reset: true as const } },
    'chats:delete': (input: { chatId: string }) => { services.conversations.deleteChat(input.chatId); return { deleted: true as const } },
    'cards:mark-viewed': (input: { cardId: string }) => services.board.markViewed(input.cardId),
    'constitution:get': (input: { projectId: string }) => services.constitution.state(input.projectId),
    'constitution:save': (input: { projectId: string; contentMd: string }) => { services.constitution.write(input.projectId, input.contentMd, 'user'); return services.constitution.state(input.projectId) },
    'constitution:import': (input: { projectId: string }) => services.constitution.importSpecKit(input.projectId),
    'constitution:set-proposal': (input: { proposalId: string; status: 'applied' | 'dismissed' }) => services.constitution.state(services.constitution.setProposal(input.proposalId, input.status)),
    'skills:list': (input: { scope: 'global' | 'project'; projectId?: string }) => services.skills.list(input.scope, input.projectId),
    'skills:choose-source': () => services.chooseSkillSource(),
    'skills:choose-folder': () => services.chooseDirectory(),
    'skills:delete': (input: { scope: 'global' | 'project'; projectId?: string; name: string; provider?: 'claude' | 'codex' }) => services.skills.delete(input),
    'skills:import-folder': (input: { scope: 'global' | 'project'; projectId?: string; folderPath: string; provider: 'claude' | 'codex' }) => services.skills.importFolder(input),
    'skills:import': (input: { scope: 'global' | 'project'; projectId?: string; sourcePath: string; name: string; provider: 'claude' | 'codex' }) => services.skills.import(input),
    'skills:convert': (input: { scope: 'global' | 'project'; projectId?: string; name: string; from: 'claude' | 'codex'; to: 'claude' | 'codex'; reviewProfileId?: string; model?: string | null }) => services.skills.convert(input),
    'chats:set-skill': async (input: { chatId: string; skill: { name: string; path: string } | null }) => {
      if (input.skill) await services.skills.assertKnown(input.skill, services.conversations.projectOf(input.chatId))
      return services.conversations.setSkill(input.chatId, input.skill)
    },
    'voice:status': () => services.voice.status(services.settings.get().voz),
    'voice:install': () => services.voice.install(services.settings.get().voz),
    'voice:set-key': (input: { key: string }) => services.voice.setGroqKey(input.key, services.settings.get().voz),
    'voice:transcribe': async (input: { wav: Uint8Array; prompt?: string }) => { const settings = services.settings.get(); return { text: await services.voice.transcribe({ wav: input.wav, model: settings.voz, language: settings.idioma === 'en' ? 'en' : 'pt', prompt: input.prompt }) } },
    'usage:list': () => services.usage.list(),
    'files:read': (input: { chatId: string; path: string }) => {
      const context = services.conversations.context(input.chatId), worktree = context.cardId ? services.worktrees.get(context.cardId) : null
      // Card com worktree: a pasta dela e a de cada repositório dela (é onde o agente trabalha), mesmo que o estado esteja desatualizado.
      // Sem worktree (planejamento e chat livre, que rodam read-only), a pasta do projeto.
      const roots = worktree && existsSync(worktree.path) ? [...services.worktrees.repositories(context.cardId!).filter((item) => item.status === 'active').map((item) => item.path), worktree.path] : [context.projectPath]
      return readProjectFile(roots, input.path)
    },
    'app:open-link': async (input: { url: string }) => {
      // Só links web e e-mail; nada de file:, javascript: ou caminhos locais.
      if (!/^(https?:\/\/|mailto:)/i.test(input.url) || input.url.length > 2048) throw new Error('Link não permitido')
      await services.openExternal(input.url); return { opened: true as const }
    },
    'files:preview': (input: { path: string }) => {
      const mime = imageMime[extname(input.path).toLowerCase()]
      try { return mime && isAbsolute(input.path) && statSync(input.path).size < 8_000_000 ? `data:${mime};base64,${readFileSync(input.path).toString('base64')}` : null } catch { return null }
    },
    // Arquivo colado do clipboard (print, imagem copiada) não tem caminho: vai para a pasta de anexos do app e o agente lê dali.
    'files:save-pasted': (input: { name: string; base64: string }) => {
      const dir = join(services.backups.attachmentsDir, 'pasted'); mkdirSync(dir, { recursive: true })
      const safe = basename(input.name).replace(/[^\w. -]/g, '_').slice(-80) || 'arquivo', path = join(dir, `${randomUUID().slice(0, 8)}-${safe}`)
      writeFileSync(path, Buffer.from(input.base64, 'base64')); return path
    },
    'usage:refresh': () => services.usage.refresh(),
    'cards:usage': (input: { cardId: string }) => services.conversations.cardUsage(input.cardId),
    'cards:checklist': (input: { cardId: string }) => services.checklists.get(input.cardId),
    'cards:checklist-toggle': (input: { cardId: string; line: number; text: string; checked: boolean }) => services.checklists.toggle(input.cardId, input.line, input.text, input.checked),
    'cards:delete': (input: { cardId: string }) => ({ deleted: services.board.delete(input.cardId) }),
    'cards:set-repos': (input: { cardId: string; sourceIds: string[] | null }) => services.board.setRepos(input.cardId, input.sourceIds),
    'git:create-prs': (input: { cardId: string; draft: boolean; title?: string; body?: string }) => services.gitManager.createPullRequests(input.cardId, input),
    'git:open-pr': async (input: { cardId: string; url: string }) => { await services.openExternal(services.gitManager.prUrlOf(input.cardId, input.url)); return { opened: true as const } },
    'playwright:sources': (input: { projectId: string }) => services.playwright.nodeSources(input.projectId),
    'playwright:status': (input: { projectId: string }) => services.playwright.status(input.projectId),
    'playwright:install-browser': (input: { projectId: string; sourceId: string }) => services.playwright.installBrowser(input),
    'playwright:install': (input: { projectId: string; sourceId: string; browser: boolean; skills: Array<'claude' | 'agents'> }) => services.playwright.install(input),
    'history:get': (input: { cardId: string }) => services.history.history(input.cardId),
    'history:contest': (input: { cardId: string; scores: DimensionScores; reason: string }) => { services.history.contest(input.cardId, input.scores, input.reason); return services.history.history(input.cardId) },
    'history:select-workflow': (input: { cardId: string; workflow: WorkflowKind; reason?: string }) => {
      services.history.selectWorkflow(input.cardId, input.workflow, { actor: 'user' }, input.reason ?? '')
      applyWorkflowType(services.board, input.cardId, input.workflow)
      return services.history.history(input.cardId)
    },
    'history:add-decision': (input: { cardId: string; kind: DecisionKind; statement: string; rationale?: string }) => { services.history.decide(input.cardId, { ...input, actor: 'user' }); return services.history.history(input.cardId) },
    'history:set-decision': (input: { decisionId: string; status: 'approved' | 'superseded' }) => services.history.history(services.history.setDecision(input.decisionId, input.status)),
    'history:rebuild': (input: { cardId: string }) => services.history.rebuild(input.cardId),
    'history:open-folder': async (input: { cardId: string }) => { const path = services.history.artifactsDir(input.cardId); await services.openPath(path); return { path } },
    'git:file-read': async (input: { sourceId: string; cardId: string | null; path: string }) => ({ content: await services.gitManager.readFileText(input.sourceId, input.cardId, input.path) }),
    'git:file-path': async (input: { sourceId: string; cardId: string | null; path: string }) => services.gitManager.filePath(input.sourceId, input.cardId, input.path),
    'git:file-write': async (input: { sourceId: string; cardId: string | null; path: string; content: string }) => { await services.gitManager.writeFileText(input.sourceId, input.cardId, input.path, input.content); return {} },
    'terminal:open': (input: { projectId: string | null; cardId: string | null }) => {
      // Dentro da worktree do card (onde o agente trabalha); sem worktree, na pasta do projeto; fora de um projeto, na pasta do usuário.
      const worktree = input.cardId ? services.worktrees.get(input.cardId) : null, cwd = worktree && existsSync(worktree.path) ? worktree.path : input.projectId ? services.projects.get(input.projectId).localPath : homedir()
      const id = services.terminals.open(cwd); return { id, cwd, shell: services.terminals.info(id).shell }
    },
    'terminal:write': (input: { id: string; data: string }) => { services.terminals.write(input.id, input.data); return {} },
    'terminal:kill': (input: { id: string }) => { services.terminals.kill(input.id); return {} },
    'windows:open': (input: PopoutTarget & { placement: WindowPlacement; x?: number; y?: number }) => { services.openWindow({ kind: input.kind, projectId: input.projectId, cardId: input.cardId, chatId: input.chatId, terminalId: input.terminalId, purpose: input.purpose, path: input.path, paths: input.paths }, input.placement, input.x !== undefined && input.y !== undefined ? { x: input.x, y: input.y } : undefined); return {} },
    'windows:place': (input: { placement: WindowPlacement }) => { services.placeWindow(input.placement); return {} },
    'metrics:card': (input: { cardId: string }) => services.conversations.runMetrics(input.cardId),
    'workflow:get': (input: { projectId: string }) => workflowState(services.history, input.projectId),
    'workflow:open-path': async (input: { projectId: string; which: 'artifacts' | 'sdd' }) => {
      // Só abre as pastas que o próprio projeto configurou (ou o padrão dos artefatos), nunca um caminho vindo da tela.
      const state = workflowState(services.history, input.projectId), path = input.which === 'sdd' ? state.config.sddPath : state.config.artifactsDir ?? state.defaultArtifactsDir
      if (!path) throw new Error('Esta pasta ainda não foi definida.')
      await services.openPath(path); return { path }
    },
    'workflow:set': (input: { projectId: string; config: WorkflowConfig }) => { services.history.setConfig(input.projectId, input.config); return workflowState(services.history, input.projectId) }
    , 'chats:list': (input: { projectId: string; cardId?: string | null }) => services.conversations.listChats(input.projectId, input.cardId)
    , 'chats:create': async (input: { projectId: string; cardId: string | null; purpose: AgentPurpose; profileId: string; skill?: { name: string; path: string } | null }) => { if (input.skill) await services.skills.assertKnown(input.skill, input.projectId); return services.conversations.createChat(input) }
    , 'messages:list': (input: { chatId: string }) => services.conversations.listMessages(input.chatId)
    , 'messages:add': (input: { chatId: string; role: string; body: string; status: string }) => services.conversations.addMessage(input)
    , 'runs:create': (input: { cardId: string; chatId: string; profileId: string }) => services.conversations.createRun(input)
    , 'runs:event': (input: { runId: string; eventType: string; payload: Record<string, unknown> }) => services.conversations.appendEvent(input.runId, input.eventType, input.payload)
    , 'agents:start': (input: { chatId: string; prompt: string; planning: boolean; attachments?: string[]; choice?: { model?: string | null; effort?: Effort | null; mode?: PermissionMode } }) => services.orchestrator.start(input)
    , 'files:choose': () => services.chooseFiles()
    , 'agents:cancel': (input: { runId: string }) => ({ cancelled: services.orchestrator.cancel(input.runId) })
    , 'plans:list': (input: { cardId: string }) => services.conversations.listPlans(input.cardId)
    , 'plans:approve': (input: { planId: string }) => services.conversations.approvePlan(input.planId)
    , 'worktrees:get': (input: { cardId: string }) => services.worktrees.get(input.cardId)
    , 'worktrees:prepare': (input: { cardId: string }) => services.worktrees.prepare(input.cardId)
    , 'worktrees:snapshot': (input: { cardId: string }) => services.worktrees.snapshot(input.cardId)
    , 'tests:run': (input: { cardId: string; executable: string; args: string[] }) => services.quality.runTest(input.cardId, input.executable, input.args)
    , 'quality:status': (input: { cardId: string }) => services.quality.status(input.cardId)
    , 'reviews:prepare-local': (input: { cardId: string }) => services.quality.prepareLocalReview(input.cardId)
    , 'git:repos': (input: { projectId: string }) => services.gitManager.repos(input.projectId)
    , 'git:upstream': (input: { sourceId: string; cardId: string | null }) => services.gitManager.upstream(input.sourceId, input.cardId)
    , 'git:set-upstream': (input: { sourceId: string; cardId: string | null; remote: string; branch: string }) => services.gitManager.setUpstream(input)
    , 'git:detect': (input: { projectId: string }) => services.gitManager.detect(input.projectId)
    , 'git:setup-targets': (input: { projectId: string }) => services.gitManager.setupTargets(input.projectId)
    , 'git:setup': (input: { projectId: string; sourceId: string; mode: 'init' | 'origin'; url?: string }) => services.gitManager.setup(input)
    , 'git:graph': (input: { projectId: string; sourceId: string; limit?: number }) => services.gitManager.graph(input.projectId, input.sourceId, input.limit)
    , 'git:commit-detail': (input: { sourceId: string; hash: string }) => services.gitManager.commitDetail(input.sourceId, input.hash)
    , 'git:changes': (input: { sourceId: string; cardId: string | null }) => services.gitManager.changes(input.sourceId, input.cardId)
    , 'git:commit-diff': (input: { sourceId: string; hash: string; path: string }) => services.gitManager.commitDiff(input.sourceId, input.hash, input.path)
    , 'git:diff': (input: { sourceId: string; cardId: string | null; path: string; staged: boolean }) => services.gitManager.diff(input.sourceId, input.cardId, input.path, input.staged)
    , 'git:stage': (input: { sourceId: string; cardId: string | null; paths: string[]; stage: boolean }) => services.gitManager.stage(input.sourceId, input.cardId, input.paths, input.stage)
    , 'git:commit': (input: { sourceId: string; cardId: string | null; message: string; description?: string; amend?: boolean; paths?: string[] }) => services.gitManager.commit(input)
    , 'git:sync': (input: { sourceId: string; cardId: string | null; action: 'fetch' | 'pull' | 'push' | 'stash' | 'pop'; pull?: 'ff' | 'ff-only' | 'rebase' }) => services.gitManager.sync(input.sourceId, input.cardId, input.action, input.pull)
    , 'git:branch-action': (input: { sourceId: string; action: 'checkout' | 'pull' | 'pull-rebase' | 'push' | 'rebase-onto' | 'merge' | 'create' | 'delete' | 'delete-remote'; name: string; newName?: string }) => services.gitManager.branchAction(input.sourceId, input)
    , 'git:commit-action': (input: { sourceId: string; action: 'checkout' | 'cherry-pick' | 'revert' | 'reset-soft' | 'reset-mixed' | 'reset-hard' | 'branch' | 'tag'; hash: string; name?: string }) => services.gitManager.commitAction(input.sourceId, input)
    , 'git:stash-action': (input: { sourceId: string; action: 'apply' | 'pop' | 'drop'; ref: string }) => services.gitManager.stashAction(input.sourceId, input)
    , 'git:conflicts': (input: { sourceId: string; cardId?: string | null | undefined }) => services.gitManager.conflicts(input.sourceId, input.cardId)
    , 'git:conflicts-all': (input: { projectId: string }) => services.gitManager.conflictsAll(input.projectId)
    , 'git:file-versions': (input: { sourceId: string; cardId: string | null; path: string; mode: 'unstaged' | 'staged' | 'commit'; hash?: string | undefined }) => services.gitManager.fileVersions(input.sourceId, input.cardId, input.path, input.mode, input.hash)
    , 'git:conflict-file': (input: { sourceId: string; cardId?: string | null | undefined; path: string }) => services.gitManager.conflictFile(input.sourceId, input.path, input.cardId)
    , 'git:conflict-save': (input: { sourceId: string; cardId?: string | null | undefined; path: string; content: string }) => services.gitManager.saveConflict(input.sourceId, input.path, input.content, input.cardId)
    , 'git:conflict-resolve': (input: { sourceId: string; cardId?: string | null | undefined; path: string; side: 'ours' | 'theirs' | 'marked' }) => services.gitManager.resolveConflict(input.sourceId, input.path, input.side, input.cardId)
    , 'git:conflict-finish': (input: { sourceId: string; cardId?: string | null | undefined; action: 'continue' | 'abort' }) => services.gitManager.finishConflicts(input.sourceId, input.action, input.cardId)
    , 'git:card': (input: { cardId: string }) => services.gitManager.card(input.cardId)
    , 'git:base-options': (input: { sourceId: string }) => services.gitManager.baseOptions(input.sourceId)
    , 'git:set-base': (input: { cardId: string; sourceId: string; baseRef: string }) => services.gitManager.setBase(input.cardId, input.sourceId, input.baseRef)
    , 'git:policy-get': (input: { projectId: string }) => services.gitManager.policy(input.projectId)
    , 'git:policy-set': (input: { projectId: string; policy: GitPolicy }) => services.gitManager.setPolicy(input.projectId, input.policy)
    , 'git:requests': (input: { cardId: string }) => services.gitManager.requests(input.cardId)
    , 'git:request-decide': (input: { requestId: string; decision: 'allow' | 'deny'; message?: string }) => services.gitManager.decide(input.requestId, input.decision, input.message)
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
