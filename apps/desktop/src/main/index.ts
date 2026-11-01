import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, screen, shell, Tray, utilityProcess, type OpenDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { oppositePlacement, placementBounds, popoutQuery, type PopoutTarget, type WindowPlacement } from './windows'
import { TerminalService } from './terminals'
import { FileWatchService } from './file-watch'
import { SpecToolsService } from './spec-tools'
import { ToolUpdateService } from './tool-updates'
import { BackupService } from './backup'
import { AppDatabase, SchemaTooNewError } from './database'
import { registerIpc } from './ipc'
import { SpecKitRuntime } from './speckit'
import { McpRegistry } from './mcp-registry'
import { GeminiCliAdapter } from './gemini-adapter'
import { NoteRepository } from './repository'
import { SettingsRepository } from './settings'
import { AgentContextService } from './agent-context'
import { McpBridge } from './mcp-bridge'
import { AgentWriteback } from './agent-writeback'
import { ExecutionService } from './executions'
import { AgentConfigRepository } from './agent-config'
import { SkillService } from './skills'
import { VoiceService } from './voice'
import { UsageService } from './usage'
import { CollaborationService } from './collaboration'
import { BoardRepository, GitService, ProfileRepository, ProjectRepository } from './projects'
import { AgentProbeService } from './agents'
import { finishNotice, Notifier } from './notifier'
import { hiddenNotice, quitPrompt, trayTooltip } from './background'
import { ConversationRepository } from './conversations'
import { ClaudeCliAdapter, CodexAppServerAdapter, nodeProcesses, listCodexModels, probeClaudeLimits, readCodexQuota } from './adapters'
import { AgentOrchestrator } from './orchestrator'
import { WorktreeService } from './worktrees'
import { GitManager } from './git-manager'
import { PullRequestService } from './pull-requests'
import { QualityService } from './quality'
import { ConstitutionRepository } from './constitution'
import { CardHistoryService } from './history'
import { exportPlanArtifacts, resolvedSddRoot } from './workflows'
import { HarnessService } from './harness'
import { PlaywrightCliService } from './playwright-cli'
import { ChecklistRepository } from './checklists'
import { AutoResumeRepository, AutoResumeService } from './auto-resume'
import { UsageLedgerService } from './usage-ledger'
import { CardUsageExport } from './card-usage-export'
import { DbConnections } from './db/connections'
import { PgDriver } from './db/pg-driver'
import { ConnectionManager } from './db/connection-manager'
import { DbService } from './db/service'
import { DbAudit } from './db/audit'
import { SecretStore } from './secrets'
import { ApprovalService } from './approvals'
import { PolicyEngine } from './policy'
import { SddResolver } from './sdd/sdd-resolver'
import { SddWriter } from './sdd/sdd-writer'
import { onMainLocaleChange, setMainLocale, tm } from './i18n'
import { CodeIndexService, type HostProcess } from './code-index/service'
import { CodeIndexSettings } from './code-index/project-setting'

// Perfil separado (ex.: AGENTBOARD_PROFILE=teste): outra pasta de dados e outro lock de instância única, para rodar junto da versão homologada.
const profileName = (process.env.AGENTBOARD_PROFILE ?? '').replace(/[^\w-]/g, '')
if (profileName) app.setPath('userData', join(app.getPath('appData'), `AgentBoard-${profileName}`))

const appVersion = app.getVersion()
const dataDir = process.env.AGENTBOARD_DATA_DIR || join(app.getPath('userData'), 'data')
const database = new AppDatabase(join(dataDir, 'agentboard.sqlite'), appVersion)
const backups = new BackupService(dataDir, appVersion)
const git = new GitService()
const profiles = new ProfileRepository(database, homedir())
const agentProbes = new AgentProbeService(profiles)
const projects = new ProjectRepository(database, git)
const board = new BoardRepository(database, projects)
const notes = new NoteRepository(database)
const settings = new SettingsRepository(database, app.getLocale())
const conversations = new ConversationRepository(database)
const constitution = new ConstitutionRepository(database)
const checklists = new ChecklistRepository(database)
const worktrees = new WorktreeService(database, dataDir)
// Índice de código (grafo de símbolos) para as ferramentas agentboard_code_*: roda num processo utilitário, aberto no primeiro uso.
const codeIndex = new CodeIndexService({ dataDir, fork: () => utilityProcess.fork(join(__dirname, 'codeIndexHost.js'), [], { serviceName: 'AgentBoard code index', stdio: 'ignore' }) as unknown as HostProcess })
/** Pastas que o índice cobre: os repositórios da worktree do card, senão as fontes do projeto. Vale para os agentes e para o editor. */
const projectCodeRoots = ({ projectId, cardId }: { projectId: string; cardId: string | null }): string[] => {
  const worktree = cardId ? worktrees.get(cardId) : null
  if (cardId && worktree && existsSync(worktree.path)) {
    const members = worktrees.repositories(cardId).filter((repo) => repo.status === 'active').map((repo) => repo.path)
    return members.length ? members : [worktree.path]
  }
  const project = projects.get(projectId)
  const sources = [...new Set(project.sources.map((source) => source.localPath))]
  return sources.length ? sources : [project.localPath]
}
const runProject = ({ cardId, chatId }: { cardId: string | null; chatId: string }): string => cardId ? board.card(cardId).projectId : conversations.projectOf(chatId)
const codeRoots = (run: { cardId: string | null; chatId: string }): string[] => projectCodeRoots({ projectId: runProject(run), cardId: run.cardId })
const codeIndexSettings = new CodeIndexSettings(database)
const codeEnabled = (run: { cardId: string | null; chatId: string }): boolean => codeIndexSettings.enabled(runProject(run))
const quality = new QualityService(database, worktrees)
const pluginDir = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'agentboard-plugin' : 'resources/agentboard-plugin')
const approvals = new ApprovalService(database)
const policy = new PolicyEngine(database)
const gitManager = new GitManager(database, undefined, undefined, approvals, (path) => fileActions.trashItem(path))
gitManager.onFolderRemoved = (path) => { void codeIndex.forget(path).catch(() => undefined) }
const pullRequests = new PullRequestService(database)
const history = new CardHistoryService(database, dataDir)
const sddResolver = new SddResolver(history, board, projects, worktrees)
const sddWriter = new SddWriter(worktrees)
const playwright = new PlaywrightCliService(database, history)
const specTools = new SpecToolsService(database)
const toolUpdates = new ToolUpdateService(join(app.getPath('userData'), 'tool-versions.json'))
const agentContext = new AgentContextService(board, settings, existsSync(pluginDir) ? pluginDir : null, constitution, (cardId) => gitManager.agentRule(cardId), history, (cardId) => {
  // Multirrepositório: o agente vê os repositórios do card e a pasta de cada um na worktree; o testador, o Playwright CLI quando ligado.
  const card = board.card(cardId), sources = projects.get(card.projectId).sources.filter((source) => source.isGitRepository)
  const repos = worktrees.repositories(cardId)
  const repositorios = sources.length > 1 ? sources.map((source) => {
    const member = repos.find((repo) => repo.repoPath.toLowerCase() === source.localPath.toLowerCase())
    return { nome: source.name, noCard: !card.repoIds || card.repoIds.includes(source.id), ...(member ? { pasta: member.path, estado: member.status, ...(member.error ? { erro: member.error } : {}) } : {}) }
  }) : undefined
  const playwrightCli = playwright.forCard(cardId)
  return { ...(repositorios ? { repositorios, regraRepositorios: 'Só os repositórios com noCard=true ganham worktree. Se precisar de outro, chame agentboard_definir_repositorios.' } : {}), ...(playwrightCli ? { playwrightCli } : {}) }
}, sddResolver)
const agentConfigs = new AgentConfigRepository(database, board, profiles, (profileId) => listCodexModels(profiles.get(profileId)))
const usageLedger = new UsageLedgerService(database)
const cardUsageExport = new CardUsageExport(database, board, history, sddResolver, worktrees, sddWriter)
board.setOnDone((cardId) => { void cardUsageExport.export(cardId).catch(() => console.error('Falha ao exportar consumo do card.')) })
const usage = new UsageService(database, profiles, (profile) => probeClaudeLimits(profile), undefined, (profile) => readCodexQuota(profile), usageLedger)
const appIcon = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'tray' : 'resources/tray', 'app.png')
const mcpServerScript = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'agentboard-mcp' : 'resources/agentboard-mcp', 'server.mjs')
const collab = new CollaborationService(database, board, conversations, agentConfigs, (cardId) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType: 'agentboard/card-updated', payload: { cardId, type: 'document' } })))
// S05, atrás da flag (padrão off até soak, Q-05): movimento imediato do agente vira pedido pendente de aprovação.
const mcpBridge = new McpBridge({ board, context: agentContext, serverScript: mcpServerScript, collab, conversations, constitution, checklists, git: gitManager, history, approvals, policy, sddResolver, sddWriter, planReady: (cardId) => exportPlanArtifacts(history, board, cardId), prepareWorktree: (cardId) => worktrees.prepare(cardId), repositories: (cardId) => worktrees.repositories(cardId), agentMoveApproval: process.env.AGENTBOARD_AGENT_MOVE_APPROVAL === '1', codeIndex, codeRoots, codeEnabled })
const writeback = new AgentWriteback(board, mcpBridge)
const shownNotifications = new Set<Notification>()
const notifier = new Notifier({
  enabled: () => settings.get().notificacoes,
  focused: () => BrowserWindow.getAllWindows().some((window) => window.isFocused()),
  show: (notice, onClick) => {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title: notice.title, body: notice.body, icon: appIcon })
    shownNotifications.add(notification)  // guarda a referência até o clique ou o fechamento, senão o sistema pode descartá-la
    notification.on('click', () => { shownNotifications.delete(notification); onClick() })
    notification.on('close', () => shownNotifications.delete(notification))
    notification.show()
  },
  open: (target) => {
    const window = mainWindow
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show(); window.focus()
    window.webContents.send('runs:event-pushed', { runId: '', eventType: 'agentboard/open-target', payload: target })
  }
})
const mcpRegistry = new McpRegistry(database, join(dataDir, 'mcp', 'secrets'), safeStorage)
const speckit = new SpecKitRuntime({ history, board: Object.assign(Object.create(board), { documents: board.documents }) as typeof board, worktrees, approvals, root: (projectId) => resolvedSddRoot(history, board, projectId, 'speckit') })
const orchestrator = new AgentOrchestrator(conversations, { codex: new CodexAppServerAdapter(), claude: new ClaudeCliAdapter(), gemini: new GeminiCliAdapter(nodeProcesses) }, (event) => {
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', event))
  // A contagem só baixa depois que a run sai da fila do orquestrador, por isso o pequeno atraso.
  if (event.eventType.startsWith('agentboard/run-')) setTimeout(updateTray, 100)
}, worktrees, 2, agentContext, writeback, agentConfigs, usage, collab, (info) => {
  if (info.cardId) void cardUsageExport.export(info.cardId).catch(() => console.error('Falha ao exportar consumo do card.'))
  // Evento do fim da execução (métricas e relatórios de implementação/verificação na pasta de artefatos do card).
  if (info.cardId && info.purpose !== 'free' && info.purpose !== 'constitution') { try { history.runFinished({ cardId: info.cardId, runId: info.runId, chatId: info.chatId, purpose: info.purpose, status: info.status }) } catch { /* artefato é best-effort */ } }
  // Notificação do sistema quando um agente termina (só com o app fora de foco); o clique abre o chat do card ou o chat livre.
  const card = info.cardId ? board.card(info.cardId) : null
  const title = card?.title || conversations.listChats(conversations.projectOf(info.chatId)).find((chat) => chat.id === info.chatId)?.title || ''
  const notice = finishNotice({ status: info.status, purpose: info.purpose, title, hasPlan: card?.hasPlan ?? false, pending: card?.pending ?? { changes: 0, questions: 0 }, error: info.error })
  if (notice) notifier.notify(notice, { projectId: card?.projectId ?? conversations.projectOf(info.chatId), cardId: info.cardId, chatId: info.chatId, purpose: info.purpose })
  // Parou por limite de uso: agenda a retomada para quando o limite voltar.
  void autoResume.onFinished({ ...info, profileId: conversations.context(info.chatId).profile.id }).catch(() => undefined)
}, usageLedger, profiles, speckit, mcpRegistry)
const pushEvent = (eventType: string, payload: Record<string, unknown>): void => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType, payload }))
const terminals = new TerminalService(pushEvent)
const fileWatch = new FileWatchService(pushEvent)
const autoResume = new AutoResumeService({
  repository: new AutoResumeRepository(database),
  enabled: () => settings.get().retomarSozinho,
  usage: async (profileId) => (await usage.refresh()).find((item) => item.profileId === profileId)?.windows ?? [],
  resume: (item) => {
    if (item.cardId && (item.purpose === 'execution' || item.purpose === 'test')) { executions.resume(item.cardId, item.purpose); return }
    orchestrator.start({ chatId: item.chatId, prompt: 'O limite de uso voltou. Continue de onde parou.', planning: true, notice: tm().autoResume.resumingNotice, automatic: true })
  },
  notify: (chatId, body) => { conversations.addMessage({ chatId, role: 'system', body, status: 'complete' }); pushEvent('agentboard/tool-activity', { chatId }) }
})
const skills = new SkillService(profiles, projects, { adapters: { codex: new CodexAppServerAdapter(), claude: new ClaudeCliAdapter(), gemini: new GeminiCliAdapter(nodeProcesses) }, profile: (id) => profiles.get(id) }, homedir(), (type, payload) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType: type, payload })), usageLedger)
collab.setStarter((action) => { orchestrator.start({ ...action, automatic: true }) })
orchestrator.setHarness(new HarnessService(database, history, worktrees))
/** Chave do Groq cifrada pelo sistema (DPAPI no Windows); nunca vai para o banco nem para o backup. */
const groqKeyFile = join(dataDir, 'whisper', 'groq.key')
const voiceSecrets = new SecretStore(groqKeyFile, safeStorage)
const dbConnections = new DbConnections(database, join(dataDir, 'db', 'secrets'), safeStorage)
const dbSessions = new ConnectionManager(dbConnections, new PgDriver())
const dbManager = new DbService(dbConnections, dbSessions, new DbAudit(database, join(dataDir, 'db', 'history')))
const voice = new VoiceService({ dataDir, secrets: voiceSecrets, emit: (type, payload) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType: type, payload })) })
const executions = new ExecutionService(board, conversations, orchestrator, agentConfigs, git, history, speckit)
let disposeIpc: (() => void) | undefined

async function openDatabase(): Promise<void> {
  await database.open(async (db, from, to) => {
    await backups.create(db, `schema-upgrade-${from}-to-${to}`)
  })
  conversations.reconcileInterrupted()
  // Runs apagadas do SQLite ainda podem existir no histórico versionado do card; a chave (run_id, seq) torna a recuperação idempotente.
  for (const project of projects.list()) for (const card of board.get(project.id).cards) {
    try { usageLedger.importHistory(card.id, history.artifactsDir(card.id)) } catch { /* histórico em disco é opcional */ }
  }
  // Eventos que não chegaram ao history.jsonl (app fechou no meio, pasta indisponível) são gravados agora.
  try { history.reconcile() } catch { /* tenta de novo na próxima abertura */ }
}

/** Altura da faixa de cima (a mesma `--titlebar` do CSS). */
const titleBarHeight = 44

let mainWindow: BrowserWindow | undefined

/** Janela principal ou, com `popout`, uma janela extra com só uma parte do app (chat, Git ou quadro) — o estado todo vive no processo principal, então as duas ficam em dia. */
async function createWindow(popout?: { target: PopoutTarget; bounds: Electron.Rectangle }): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: popout ? 480 : 760,
    minHeight: popout ? 360 : 560,
    ...(popout?.bounds ?? {}),
    show: false,
    backgroundColor: '#0b0b0b',
    // Barra de título própria: o app desenha a faixa de cima (e dá para arrastar por ela); os botões de minimizar, maximizar e
    // fechar continuam os do Windows, por cima, com fundo transparente para seguir o tema.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#d4d9d5', height: titleBarHeight },
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (!popout) mainWindow = window
  window.once('ready-to-show', () => window.show())
  // Sem o menu (File, Edit…) somem os atalhos dele; em desenvolvimento, F12 / Ctrl+Shift+I abre as ferramentas e Ctrl+R recarrega.
  if (!app.isPackaged) window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if (key === 'f12' || (input.control && input.shift && key === 'i')) { event.preventDefault(); window.webContents.toggleDevTools() }
    else if (input.control && key === 'r') { event.preventDefault(); window.webContents.reload() }
  })
  // Fechar a janela só esconde o app na bandeja: os agentes continuam trabalhando. Sair é pelo ícone da bandeja.
  if (!popout) window.on('close', (event) => {
    if (quitting) return
    event.preventDefault(); window.hide()
    if (!toldHidden && Notification.isSupported()) { toldHidden = true; new Notification({ ...hiddenNotice, icon: appIcon }).show() }
  })
  // O editor cancela o `beforeunload` quando há arquivo não salvo; sem isso o Electron só ignoraria o fechamento (o X da janela de chat não fazia
  // nada e "Sair" ficava parado). Aqui o usuário escolhe: descartar e seguir, ou cancelar — e, se cancelar uma saída, nada foi fechado ainda.
  window.webContents.on('will-prevent-unload', (event) => {
    if (!window.isVisible()) window.show()  // saindo pela bandeja, a janela pode estar escondida
    window.focus()
    const response = dialog.showMessageBoxSync(window, { type: 'warning', title: tm().app.unsavedTitle, message: tm().app.unsavedMessage, detail: tm().app.unsavedDetail, buttons: [quitting ? tm().app.discardAndQuit : tm().app.discardAndClose, tm().app.cancel], defaultId: 1, cancelId: 1, noLink: true })
    if (response === 0) { event.preventDefault(); return }
    quitting = false  // a saída foi cancelada: o X da janela principal volta a só esconder na bandeja
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  // Só o microfone (ditado por voz) é liberado; qualquer outra permissão continua negada.
  window.webContents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => callback(permission === 'media' && (details as { mediaTypes?: string[] }).mediaTypes?.every((type) => type === 'audio') === true))
  window.webContents.session.setPermissionCheckHandler((_webContents, permission) => permission === 'media')
  const query = popout ? popoutQuery(popout.target) : undefined
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(query ? `${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}` : process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined)
  return window
}

const areaOf = (window: BrowserWindow): Electron.Rectangle => screen.getDisplayMatching(window.getBounds()).workArea

/** Move a janela para uma metade da tela (ou a solta, se já estava encaixada). */
function placeWindow(window: BrowserWindow, placement: WindowPlacement): void {
  if (window.isMaximized()) window.unmaximize()
  window.setBounds(placementBounds(areaOf(window), placement))
}

/** Abre uma janela só com aquela parte; ao encaixar numa metade, a janela de origem fica com a outra. */
function openPopout(target: PopoutTarget, placement: WindowPlacement, point?: { x: number; y: number }): void {
  const origin = BrowserWindow.getFocusedWindow() ?? mainWindow
  const originDisplay = origin ? screen.getDisplayMatching(origin.getBounds()) : screen.getPrimaryDisplay()
  const secondary = placement === 'second' ? screen.getAllDisplays().find((display) => display.id !== originDisplay.id) : undefined
  const area = point ? screen.getDisplayNearestPoint(point).workArea : secondary?.workArea ?? originDisplay.workArea
  const other = oppositePlacement(placement)
  if (origin && other) placeWindow(origin, other)
  const base = placement === 'second' ? placementBounds(area, 'fill') : placementBounds(area, placement)
  const bounds = point && placement === 'new' ? { ...base, x: Math.max(area.x, Math.min(point.x - 72, area.x + area.width - base.width)), y: Math.max(area.y, Math.min(point.y - 28, area.y + area.height - base.height)) } : base
  void createWindow({ target, bounds })
}

function returnFile(input: { projectId: string; cardId: string | null; path: string }): void {
  mainWindow?.webContents.send('runs:event-pushed', { runId: '', eventType: 'agentboard/open-file', payload: input })
  mainWindow?.show(); mainWindow?.focus()
}
const fileActions = {
  attachFile(input: { projectId: string; cardId: string | null; path: string }): void {
    mainWindow?.webContents.send('runs:event-pushed', { runId: '', eventType: 'agentboard/attach-file', payload: input }); mainWindow?.show(); mainWindow?.focus()
  },
  commentFile(input: { projectId: string; cardId: string | null; text: string }): void {
    mainWindow?.webContents.send('runs:event-pushed', { runId: '', eventType: 'agentboard/comment-file', payload: input }); mainWindow?.show(); mainWindow?.focus()
  },
  async openFileExternal(path: string, target: 'explorer' | 'default' | 'vscode'): Promise<void> {
    if (target === 'explorer') { shell.showItemInFolder(path); return }
    if (target === 'vscode') { await shell.openExternal(pathToFileURL(path).href.replace(/^file:\/\//, 'vscode://file')); return }
    const error = await shell.openPath(path); if (error) throw new Error(error)
  },
  /** Excluir é sempre para a Lixeira do sistema, nunca definitivo. */
  async trashItem(path: string): Promise<void> { await shell.trashItem(path) }
}

async function chooseDirectory(defaultPath?: string): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: OpenDialogOptions = { properties: ['openDirectory'], title: tm().app.selectFolder, ...(defaultPath ? { defaultPath } : {}) }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

/** Arquivos para anexar a uma mensagem do chat (viram contexto do agente). */
async function chooseFiles(): Promise<string[]> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: OpenDialogOptions = { properties: ['openFile', 'multiSelections'], title: tm().app.attachFiles }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

/** Salva um texto (CSV de consumo) onde o usuário escolher; cancelar não grava nada. */
async function saveTextFile(input: { content: string; defaultName: string }): Promise<{ saved: boolean; path: string | null }> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = { title: tm().app.saveFile, defaultPath: input.defaultName, filters: [{ name: 'CSV', extensions: ['csv'] }] }
  const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { saved: false, path: null }
  await writeFile(result.filePath, input.content, 'utf8')
  return { saved: true, path: result.filePath }
}

async function chooseSkillSource(): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: OpenDialogOptions = { properties: ['openFile', 'openDirectory'], title: tm().app.chooseSkillSource }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

let quitting = false, toldHidden = false, tray: Tray | null = null

function showWindow(): void {
  const window = mainWindow
  if (!window || window.isDestroyed()) { void createWindow(); return }
  if (window.isMinimized()) window.restore()
  window.show(); window.focus()
}

/** Sair de verdade (menu da bandeja): com agente trabalhando, confirma antes, porque as execuções morrem junto com o app. */
async function requestQuit(): Promise<void> {
  const prompt = quitPrompt(orchestrator.pendingCount())
  if (prompt) {
    const window = BrowserWindow.getAllWindows().find((item) => item.isVisible())
    const options = { type: 'warning' as const, title: tm().app.quitTitle, message: prompt.message, detail: prompt.detail, buttons: [prompt.cancel, prompt.confirm], defaultId: 0, cancelId: 0, noLink: true }
    const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
    if (response !== 1) return
  }
  quitting = true
  app.quit()
}

function updateTray(): void {
  if (!tray || tray.isDestroyed()) return
  const running = orchestrator.pendingCount()
  tray.setToolTip(trayTooltip(running))
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: tm().app.trayOpen, click: showWindow },
    { label: running ? tm().background.agentsWorking(running) : tm().app.trayIdle, enabled: false },
    { type: 'separator' },
    { label: tm().app.trayQuit, click: () => void requestQuit() }
  ]))
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'tray' : 'resources/tray', 'tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.on('click', showWindow)
  onMainLocaleChange(() => updateTray())
  updateTray()
}

// Uma cópia só: abrir o AgentBoard de novo (com ele escondido na bandeja) traz a janela de volta em vez de abrir outro app no mesmo banco.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', showWindow)

app.whenReady().then(async () => {
  app.setAppUserModelId('com.agentboard.desktop')  // necessário para as notificações do Windows
  await openDatabase()
  setMainLocale(settings.get().idioma)  // só depois de abrir o banco: antes disso as configurações não podem ser lidas
  await mcpBridge.listen()
  disposeIpc = registerIpc(ipcMain, { database, speckit, pullRequests, mcp: mcpRegistry, backups, notes, settings, profiles, projects, board, git, chooseDirectory, chooseFiles, agentProbes, conversations, orchestrator, worktrees, quality, executions, agentConfigs, skills, constitution, checklists, voice, usage, collab, gitManager, history, playwright, specTools, toolUpdates, approvals, sddResolver, sddWriter, dbManager, fileWatch, terminals, returnFile, codeIndex, codeRoots: projectCodeRoots, codeIndexSettings, ...fileActions, openExternal: (url) => shell.openExternal(url), openWindow: openPopout, placeWindow: (placement) => { const window = BrowserWindow.getFocusedWindow(); if (window) placeWindow(window, placement) }, openPath: async (path) => { await mkdir(path, { recursive: true }); const error = await shell.openPath(path); if (error) throw new Error(error) }, chooseSkillSource, saveTextFile, appVersion, dataDir, reopen: openDatabase })
  Menu.setApplicationMenu(null)  // sem File/Edit/View/Window/Help: a faixa de cima é do app
  createTray()
  await createWindow()
  autoResume.start()  // confere a cada 30 s se chegou a hora de retomar algo que parou por limite de uso
  app.on('activate', showWindow)
}).catch((error: unknown) => {
  console.error('AgentBoard startup failed', error)
  // As configurações podem não ter sido lidas (banco fechado): usa o idioma salvo se der, senão o do sistema.
  try { setMainLocale(settings.get().idioma) } catch { setMainLocale(app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : 'en') }
  const detail = error instanceof Error ? error.message : String(error)
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  const corrupt = /^SQLITE_(CORRUPT|NOTADB)/.test(code) || /integrity check failed|malformed|not a database/i.test(detail)
  dialog.showErrorBox(tm().app.startupFailedTitle, error instanceof SchemaTooNewError ? tm().app.startupSchemaTooNew(dataDir) : corrupt ? tm().app.startupCorrupt(dataDir, detail) : tm().app.startupFailed(dataDir, detail))
  app.exit(1)
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
// Qualquer saída (bandeja, desligar o Windows, atualização) libera o fechamento da janela. Nada é encerrado aqui: uma janela com arquivo
// não salvo ainda pode cancelar a saída (veja `will-prevent-unload`).
app.on('before-quit', () => { quitting = true })
// Só depois que todas as janelas fecharam (ninguém cancelou) é que agentes, terminais, bandeja e banco são encerrados.
app.on('will-quit', () => { orchestrator.shutdown(); autoResume.stop(); terminals.dispose(); fileWatch.dispose(); codeIndex.dispose(); tray?.destroy(); disposeIpc?.(); void mcpBridge.close(); void dbSessions.closeAll(); database.close() })
