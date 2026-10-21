import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { existsSync } from 'node:fs'
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
import { BoardRepository, GitService, ProfileRepository, ProjectRepository } from './projects'
import { AgentProbeService } from './agents'
import { ConversationRepository } from './conversations'
import { ClaudeCliAdapter, CodexAppServerAdapter, listCodexModels } from './adapters'
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
const usage = new UsageService(database, profiles)
const mcpServerScript = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'agentboard-mcp' : 'resources/agentboard-mcp', 'server.mjs')
const mcpBridge = new McpBridge({ board, context: agentContext, serverScript: mcpServerScript })
const writeback = new AgentWriteback(board, mcpBridge)
const orchestrator = new AgentOrchestrator(conversations, { codex: new CodexAppServerAdapter(), claude: new ClaudeCliAdapter() }, (event) => {
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', event))
}, worktrees, 2, agentContext, writeback, agentConfigs, usage)
const skills = new SkillService(profiles, projects, { adapters: { codex: new CodexAppServerAdapter(), claude: new ClaudeCliAdapter() }, profile: (id) => profiles.get(id) }, homedir(), (type, payload) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType: type, payload })))
const voice = new VoiceService({ dataDir, emit: (type, payload) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('runs:event-pushed', { runId: '', eventType: type, payload })) })
const executions = new ExecutionService(board, conversations, orchestrator, agentConfigs)
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
  await openDatabase()
  await mcpBridge.listen()
  disposeIpc = registerIpc(ipcMain, { database, backups, notes, settings, profiles, projects, board, git, chooseDirectory, agentProbes, conversations, orchestrator, worktrees, quality, executions, agentConfigs, skills, voice, usage, chooseSkillSource, appVersion, dataDir, reopen: openDatabase })
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
}).catch((error: unknown) => {
  console.error('AgentBoard startup failed', error)
  app.exit(1)
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { disposeIpc?.(); void mcpBridge.close(); database.close() })
