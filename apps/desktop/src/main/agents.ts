import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, extname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentProbe, AgentProfile } from '@agentboard/contracts'
import { readAccountEmail } from './account'
import type { ProfileRepository } from './projects'
import { tm } from './i18n'

const exec = promisify(execFile)
export interface CommandRunner { run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> }
const systemRunner: CommandRunner = { async run(command, args, env) {
  const executable = resolveCommand(command, env)
  if (process.platform === 'win32' && ['.cmd', '.bat'].includes(extname(executable).toLowerCase())) {
    const commandLine = [executable, ...args].map(quoteCmdArgument).join(' ')
    return exec(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], { env, timeout: 10_000, windowsHide: true })
  }
  return exec(executable, args, { env, timeout: 10_000, windowsHide: true })
} }

export class AgentProbeService {
  constructor(private readonly profiles: ProfileRepository, private readonly runner: CommandRunner = systemRunner) {}

  async probe(profileId: string): Promise<AgentProbe> {
    const profile = this.profiles.list().find((item) => item.id === profileId)
    if (!profile) throw new Error(tm().common.profileNotFound)
    const command = profile.executablePath || profile.provider
    const env = this.environment(profile)
    try {
      const versionResult = await this.runner.run(command, ['--version'], env)
      const resolved = resolveCommand(command, env)
      if (isAbsolute(resolved)) this.profiles.setExecutable(profile.id, resolved)
      const version = versionResult.stdout.trim() || versionResult.stderr.trim() || null
      const authenticated = await this.authentication(profile, command, env)
      const account = authenticated ? readAccountEmail(profile) : null
      return { profileId, provider: profile.provider, installed: true, authenticated, version, executablePath: command, capabilities: profile.provider === 'codex' ? ['app-server', 'streaming', 'resume', 'approvals', 'plan'] : profile.provider === 'gemini' ? ['stream-json', 'resume', 'plan', 'skills', 'mcp'] : ['stream-json', 'resume', 'permissions', 'plan'], checkedAt: new Date().toISOString(), error: null, account }
    } catch (error) {
      return { profileId, provider: profile.provider, installed: false, authenticated: false, version: null, executablePath: command, capabilities: [], checkedAt: new Date().toISOString(), error: safeError(error), account: null }
    }
  }

  async probeAll(): Promise<AgentProbe[]> { return Promise.all(this.profiles.list().map((profile) => this.probe(profile.id))) }

  async detectProvider(provider: 'codex' | 'claude' | 'gemini'): Promise<{ installed: boolean; version: string | null; error: string | null }> {
    try {
      const result = await systemRunner.run(provider, ['--version'], process.env)
      return { installed: true, version: result.stdout.trim() || result.stderr.trim() || null, error: null }
    } catch (error) { return { installed: false, version: null, error: safeError(error) } }
  }

  installProvider(provider: 'codex' | 'claude' | 'gemini'): { started: true } {
    const packageName = provider === 'codex' ? '@openai/codex@latest' : provider === 'gemini' ? '@google/gemini-cli@latest' : '@anthropic-ai/claude-code@latest'
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/d', '/c', 'start', '', 'cmd.exe', '/k', 'npm', 'install', '-g', packageName], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
    } else {
      const child = spawn('npm', ['install', '-g', packageName], { detached: true, stdio: 'ignore' })
      child.unref()
    }
    return { started: true }
  }

  /** Atualiza a CLI do agente num terminal aberto para o usuário acompanhar: `claude update` (serve para instalação nativa e npm) ou o npm do Codex. */
  updateProvider(provider: 'codex' | 'claude' | 'gemini'): { started: true } {
    const command = provider === 'claude' ? ['claude', 'update'] : provider === 'gemini' ? ['npm', 'install', '-g', '@google/gemini-cli@latest'] : ['npm', 'install', '-g', '@openai/codex@latest']
    if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/c', 'start', '', 'cmd.exe', '/k', ...command], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    else spawn(command[0]!, command.slice(1), { detached: true, stdio: 'ignore' }).unref()
    return { started: true }
  }

  install(profileId: string): { started: true } {
    const profile = this.profiles.get(profileId)
    return this.installProvider(profile.provider)
  }

  login(profileId: string): { started: true } {
    const profile = this.profiles.get(profileId)
    const env = this.environment(profile)
    const command = resolveCommand(profile.executablePath || profile.provider, env)
    // O Gemini CLI não tem subcomando de login: abrir a CLI interativa mostra a escolha de login (Google ou chave); depois é só sair com /quit.
    const args = profile.provider === 'codex' ? ['login'] : profile.provider === 'gemini' ? [] : ['auth', 'login']
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/d', '/c', 'start', '', command, ...args], { env, detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
    } else {
      const child = spawn(command, args, { env, detached: true, stdio: 'ignore' })
      child.unref()
    }
    return { started: true }
  }

  private environment(profile: AgentProfile): NodeJS.ProcessEnv {
    const env = { ...process.env }
    if (profile.provider === 'codex') env.CODEX_HOME = profile.configDir
    else if (profile.provider === 'gemini') env.GEMINI_CLI_HOME = profile.configDir
    else env.CLAUDE_CONFIG_DIR = profile.configDir
    return env
  }

  private async authentication(profile: AgentProfile, command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
    // Gemini: logado = credencial OAuth do perfil ou chave de API liberada para o perfil (nada é executado nem consumido aqui).
    if (profile.provider === 'gemini') return existsSync(join(profile.configDir, '.gemini', 'oauth_creds.json')) || Boolean(env.GEMINI_API_KEY && profile.envPassthrough.includes('GEMINI_API_KEY'))
    try {
      const result = await this.runner.run(command, profile.provider === 'codex' ? ['login', 'status'] : ['auth', 'status'], env)
      if (profile.provider === 'codex') return /logged in/i.test(`${result.stdout}\n${result.stderr}`)
      const status = JSON.parse(result.stdout) as { loggedIn?: boolean }
      return status.loggedIn === true
    } catch { return false }
  }
}

export function resolveCommand(command: string, env: NodeJS.ProcessEnv): string {
  if (process.platform !== 'win32') return command
  if (isAbsolute(command)) {
    if (existsSync(command)) return command
    command = /claude/i.test(command) ? 'claude' : /gemini/i.test(command) ? 'gemini' : 'codex'
  }
  const folders = [...new Set([
    ...(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean),
    join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm'),
    join(homedir(), '.local', 'bin'),
    join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links')
  ])]
  if (command === 'codex') {
    // The desktop installation uses versioned folders and may not be in the
    // PATH inherited by an application launched from Windows Explorer.
    const desktopBin = join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin')
    if (existsSync(desktopBin)) {
      for (const entry of readdirSync(desktopBin, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => statSync(join(desktopBin, b.name)).mtimeMs - statSync(join(desktopBin, a.name)).mtimeMs)) {
        folders.push(join(desktopBin, entry.name))
      }
    }
    const npmVendor = join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@openai', 'codex')
    const roots = [join(npmVendor, 'node_modules', '@openai', 'codex-win32-x64', 'vendor'), join(npmVendor, 'vendor')]
    for (const root of roots) {
      if (!existsSync(root)) continue
      for (const entry of readdirSync(root)) folders.unshift(join(root, entry, 'codex'))
    }
  }
  for (const extension of ['.exe', '.cmd', '.bat']) {
    for (const folder of folders) {
      const candidate = join(folder, `${command}${extension}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return command
}

function quoteCmdArgument(value: string): string { return `"${value.replace(/"/g, '""')}"` }

function safeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[redacted]').slice(0, 500)
}
