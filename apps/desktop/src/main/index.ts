import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, type OpenDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
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
import { ConversationRepository } from './conversations'
import { ClaudeCliAdapter, CodexAppServerAdapter, listCodexModels, probeClaudeLimits } from './adapters'
import { AgentOrchestrator } from './orchestrator'
import { WorktreeService } from './worktrees'
import { QualityService } from './quality'

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
const worktrees = new WorktreeService(database, dataDir)
const quality = new QualityService(database, worktrees)
const pluginDir = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'agentboard-plugin' : 'resources/agentboard-plugin')
const agentContext = new AgentContextService(board, settings, existsSync(pluginDir) ? pluginDir : null)
const agentConfigs = new AgentConfigRepository(database, board, profiles, (profileId) => listCodexModels(profiles.get(profileId)))
const usage = new UsageService(database, profiles, (profile) => probeClaudeLimits(profile))
const mcpServerScript = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'agentboard-mcp' : 'resources/agentboard-mcp', 'server.mjs')
const collab = new CollaborationService(database, board, conversations, agentConfigs, (cardId) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType: 'agentboard/card-updated', payload: { cardId, type: 'document' } })))
const mcpBridge = new McpBridge({ board, context: agentContext, serverScript: mcpServerScript, collab, conversations })
const writeback = new AgentWriteback(board, mcpBridge)
const shownNotifications = new Set<Notification>()
const notifier = new Notifier({
  enabled: () => settings.get().notificacoes,
  focused: () => BrowserWindow.getAllWindows().some((window) => window.isFocused()),
  show: (notice, onClick) => {
    if (!Notification.isSupported()) return
    const notification = new Notification({ title: notice.title, body: notice.body })
    shownNotifications.add(notification)  // guarda a referência até o clique ou o fechamento, senão o sistema pode descartá-la
    notification.on('click', () => { shownNotifications.delete(notification); onClick() })
    notification.on('close', () => shownNotifications.delete(notification))
    notification.show()
  },
  open: (target) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show(); window.focus()
    window.webContents.send('runs:event-pushed', { runId: '', eventType: 'agentboard/open-target', payload: target })
  }
})
const orchestrator = new AgentOrchestrator(conversations, { codex: new CodexAppServerAdapter(), claude: new ClaudeCliAdapter() }, (event) => {
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', event))
}, worktrees, 2, agentContext, writeback, agentConfigs, usage, collab, (info) => {
  // Notificação do sistema quando um agente termina (só com o app fora de foco); o clique abre o chat do card ou o chat livre.
  const card = info.cardId ? board.card(info.cardId) : null
  const title = card?.title || conversations.listChats(conversations.projectOf(info.chatId)).find((chat) => chat.id === info.chatId)?.title || ''
  const notice = finishNotice({ status: info.status, purpose: info.purpose, title, hasPlan: card?.hasPlan ?? false, pending: card?.pending ?? { changes: 0, questions: 0 }, error: info.error })
  if (notice) notifier.notify(notice, { projectId: card?.projectId ?? conversations.projectOf(info.chatId), cardId: info.cardId, chatId: info.chatId, purpose: info.purpose })
})
const skills = new SkillService(profiles, projects, { adapters: { codex: new CodexAppServerAdapter(), claude: new ClaudeCliAdapter() }, profile: (id) => profiles.get(id) }, homedir(), (type, payload) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType: type, payload })))
collab.setStarter((action) => { orchestrator.start(action) })
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
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: '#101211',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  // Só o microfone (ditado por voz) é liberado; qualquer outra permissão continua negada.
  window.webContents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => callback(permission === 'media' && (details as { mediaTypes?: string[] }).mediaTypes?.every((type) => type === 'audio') === true))
  window.webContents.session.setPermissionCheckHandler((_webContents, permission) => permission === 'media')
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
}

async function chooseDirectory(): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: OpenDialogOptions = { properties: ['openDirectory'], title: 'Selecione uma pasta de origem' }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

async function chooseSkillSource(): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: OpenDialogOptions = { properties: ['openFile', 'openDirectory'], title: 'Escolha a pasta da skill ou o SKILL.md' }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.agentboard.desktop')  // necessário para as notificações do Windows
  await openDatabase()
  await mcpBridge.listen()
  disposeIpc = registerIpc(ipcMain, { database, backups, notes, settings, profiles, projects, board, git, chooseDirectory, agentProbes, conversations, orchestrator, worktrees, quality, executions, agentConfigs, skills, voice, usage, collab, chooseSkillSource, appVersion, dataDir, reopen: openDatabase })
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
}).catch((error: unknown) => {
  console.error('AgentBoard startup failed', error)
  app.exit(1)
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { disposeIpc?.(); void mcpBridge.close(); database.close() })
