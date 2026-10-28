import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, screen, shell, Tray, type OpenDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { oppositePlacement, placementBounds, popoutQuery, type PopoutTarget, type WindowPlacement } from './windows'
import { TerminalService } from './terminals'
import { FileWatchService } from './file-watch'
import { SpecToolsService } from './spec-tools'
import { ToolUpdateService } from './tool-updates'
import { BackupService } from './backup'
import { AppDatabase } from './database'
import { registerIpc } from './ipc'
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
import { ClaudeCliAdapter, CodexAppServerAdapter, listCodexModels, probeClaudeLimits } from './adapters'
import { AgentOrchestrator } from './orchestrator'
import { WorktreeService } from './worktrees'
import { GitManager } from './git-manager'
import { QualityService } from './quality'
import { ConstitutionRepository } from './constitution'
import { CardHistoryService } from './history'
import { exportPlanArtifacts } from './workflows'
import { HarnessService } from './harness'
import { PlaywrightCliService } from './playwright-cli'
import { ChecklistRepository } from './checklists'
import { AutoResumeRepository, AutoResumeService } from './auto-resume'

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
const settings = new SettingsRepository(database)
const conversations = new ConversationRepository(database)
const constitution = new ConstitutionRepository(database)
const checklists = new ChecklistRepository(database)
const worktrees = new WorktreeService(database, dataDir)
const quality = new QualityService(database, worktrees)
const pluginDir = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'agentboard-plugin' : 'resources/agentboard-plugin')
const gitManager = new GitManager(database)
const history = new CardHistoryService(database, dataDir)
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
})
const agentConfigs = new AgentConfigRepository(database, board, profiles, (profileId) => listCodexModels(profiles.get(profileId)))
const usage = new UsageService(database, profiles, (profile) => probeClaudeLimits(profile))
const appIcon = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'tray' : 'resources/tray', 'app.png')
const mcpServerScript = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'agentboard-mcp' : 'resources/agentboard-mcp', 'server.mjs')
const collab = new CollaborationService(database, board, conversations, agentConfigs, (cardId) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType: 'agentboard/card-updated', payload: { cardId, type: 'document' } })))
const mcpBridge = new McpBridge({ board, context: agentContext, serverScript: mcpServerScript, collab, conversations, constitution, checklists, git: gitManager, history, planReady: (cardId) => exportPlanArtifacts(history, board, cardId), prepareWorktree: (cardId) => worktrees.prepare(cardId), repositories: (cardId) => worktrees.repositories(cardId) })
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
const orchestrator = new AgentOrchestrator(conversations, { codex: new CodexAppServerAdapter(), claude: new ClaudeCliAdapter() }, (event) => {
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', event))
  // A contagem só baixa depois que a run sai da fila do orquestrador, por isso o pequeno atraso.
  if (event.eventType.startsWith('agentboard/run-')) setTimeout(updateTray, 100)
}, worktrees, 2, agentContext, writeback, agentConfigs, usage, collab, (info) => {
  // Evento do fim da execução (métricas e relatórios de implementação/verificação na pasta de artefatos do card).
  if (info.cardId && info.purpose !== 'free' && info.purpose !== 'constitution') { try { history.runFinished({ cardId: info.cardId, runId: info.runId, chatId: info.chatId, purpose: info.purpose, status: info.status }) } catch { /* artefato é best-effort */ } }
  // Notificação do sistema quando um agente termina (só com o app fora de foco); o clique abre o chat do card ou o chat livre.
  const card = info.cardId ? board.card(info.cardId) : null
  const title = card?.title || conversations.listChats(conversations.projectOf(info.chatId)).find((chat) => chat.id === info.chatId)?.title || ''
  const notice = finishNotice({ status: info.status, purpose: info.purpose, title, hasPlan: card?.hasPlan ?? false, pending: card?.pending ?? { changes: 0, questions: 0 }, error: info.error })
  if (notice) notifier.notify(notice, { projectId: card?.projectId ?? conversations.projectOf(info.chatId), cardId: info.cardId, chatId: info.chatId, purpose: info.purpose })
  // Parou por limite de uso: agenda a retomada para quando o limite voltar.
  void autoResume.onFinished({ ...info, profileId: conversations.context(info.chatId).profile.id }).catch(() => undefined)
})
const pushEvent = (eventType: string, payload: Record<string, unknown>): void => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType, payload }))
const terminals = new TerminalService(pushEvent)
const fileWatch = new FileWatchService(pushEvent)
const autoResume = new AutoResumeService({
  repository: new AutoResumeRepository(database),
  enabled: () => settings.get().retomarSozinho,
  usage: async (profileId) => (await usage.refresh()).find((item) => item.profileId === profileId)?.windows ?? [],
  resume: (item) => {
    if (item.cardId && (item.purpose === 'execution' || item.purpose === 'test')) { executions.resume(item.cardId, item.purpose); return }
    orchestrator.start({ chatId: item.chatId, prompt: 'O limite de uso voltou. Continue de onde parou.', planning: true, notice: '▶ O limite de uso voltou · retomando de onde parou', automatic: true })
  },
  notify: (chatId, body) => { conversations.addMessage({ chatId, role: 'system', body, status: 'complete' }); pushEvent('agentboard/tool-activity', { chatId }) }
})
const skills = new SkillService(profiles, projects, { adapters: { codex: new CodexAppServerAdapter(), claude: new ClaudeCliAdapter() }, profile: (id) => profiles.get(id) }, homedir(), (type, payload) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType: type, payload })))
collab.setStarter((action) => { orchestrator.start({ ...action, automatic: true }) })
orchestrator.setHarness(new HarnessService(database, history, worktrees))
/** Chave do Groq cifrada pelo sistema (DPAPI no Windows); nunca vai para o banco nem para o backup. */
const groqKeyFile = join(dataDir, 'whisper', 'groq.key')
const voiceSecrets = {
  read: async (): Promise<string | null> => existsSync(groqKeyFile) && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(await readFile(groqKeyFile)) : null,
  write: async (value: string | null): Promise<void> => {
    if (!value) { await rm(groqKeyFile, { force: true }); return }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('O sistema não oferece armazenamento seguro para a chave')
    await mkdir(join(dataDir, 'whisper'), { recursive: true }); await writeFile(groqKeyFile, safeStorage.encryptString(value))
  }
}
const voice = new VoiceService({ dataDir, secrets: voiceSecrets, emit: (type, payload) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType: type, payload })) })
const executions = new ExecutionService(board, conversations, orchestrator, agentConfigs, git)
let disposeIpc: (() => void) | undefined

async function openDatabase(): Promise<void> {
  await database.open(async (db, from, to) => {
    await backups.create(db, `schema-upgrade-${from}-to-${to}`)
  })
  conversations.reconcileInterrupted()
  // Eventos que não chegaram ao history.jsonl (app fechou no meio, pasta indisponível) são gravados agora.
  try { history.reconcile() } catch { /* tenta de novo na próxima abertura */ }
}

/** Altura da faixa de cima (a mesma `--titlebar` do CSS). */
const titleBarHeight = 36

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
  const options: OpenDialogOptions = { properties: ['openDirectory'], title: 'Selecione uma pasta', ...(defaultPath ? { defaultPath } : {}) }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

/** Arquivos para anexar a uma mensagem do chat (viram contexto do agente). */
async function chooseFiles(): Promise<string[]> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: OpenDialogOptions = { properties: ['openFile', 'multiSelections'], title: 'Anexar arquivos à mensagem' }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}

async function chooseSkillSource(): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: OpenDialogOptions = { properties: ['openFile', 'openDirectory'], title: 'Escolha a pasta da skill ou o SKILL.md' }
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
    const options = { type: 'warning' as const, title: 'Sair do AgentBoard', message: prompt.message, detail: prompt.detail, buttons: [prompt.cancel, prompt.confirm], defaultId: 0, cancelId: 0, noLink: true }
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
    { label: 'Abrir AgentBoard', click: showWindow },
    { label: running ? trayTooltip(running).replace('AgentBoard · ', '') : 'Nenhum agente trabalhando', enabled: false },
    { type: 'separator' },
    { label: 'Sair', click: () => void requestQuit() }
  ]))
}

function createTray(): void {
  const icon = nativeImage.createFromPath(join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'tray' : 'resources/tray', 'tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.on('click', showWindow)
  updateTray()
}

// Uma cópia só: abrir o AgentBoard de novo (com ele escondido na bandeja) traz a janela de volta em vez de abrir outro app no mesmo banco.
if (!app.requestSingleInstanceLock()) app.exit(0)
app.on('second-instance', showWindow)

app.whenReady().then(async () => {
  app.setAppUserModelId('com.agentboard.desktop')  // necessário para as notificações do Windows
  await openDatabase()
  await mcpBridge.listen()
  disposeIpc = registerIpc(ipcMain, { database, backups, notes, settings, profiles, projects, board, git, chooseDirectory, chooseFiles, agentProbes, conversations, orchestrator, worktrees, quality, executions, agentConfigs, skills, constitution, checklists, voice, usage, collab, gitManager, history, playwright, specTools, toolUpdates, fileWatch, terminals, returnFile, ...fileActions, openExternal: (url) => shell.openExternal(url), openWindow: openPopout, placeWindow: (placement) => { const window = BrowserWindow.getFocusedWindow(); if (window) placeWindow(window, placement) }, openPath: async (path) => { await mkdir(path, { recursive: true }); const error = await shell.openPath(path); if (error) throw new Error(error) }, chooseSkillSource, appVersion, dataDir, reopen: openDatabase })
  Menu.setApplicationMenu(null)  // sem File/Edit/View/Window/Help: a faixa de cima é do app
  createTray()
  await createWindow()
  autoResume.start()  // confere a cada 30 s se chegou a hora de retomar algo que parou por limite de uso
  app.on('activate', showWindow)
}).catch((error: unknown) => {
  console.error('AgentBoard startup failed', error)
  app.exit(1)
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
// Qualquer saída (bandeja, desligar o Windows, atualização) libera o fechamento da janela.
app.on('before-quit', () => { quitting = true; orchestrator.shutdown(); autoResume.stop(); terminals.dispose(); fileWatch.dispose(); tray?.destroy(); disposeIpc?.(); void mcpBridge.close(); database.close() })
