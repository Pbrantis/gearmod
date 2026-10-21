import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgentProbe, AgentProfile } from '@agentboard/contracts'
import type { ProfileRepository } from './projects'

const exec = promisify(execFile)
export interface CommandRunner { run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> }
const systemRunner: CommandRunner = { async run(command, args, env) { return exec(command, args, { env, timeout: 10_000, windowsHide: true }) } }

export class AgentProbeService {
  constructor(private readonly profiles: ProfileRepository, private readonly runner: CommandRunner = systemRunner) {}

  async probe(profileId: string): Promise<AgentProbe> {
    const profile = this.profiles.list().find((item) => item.id === profileId)
    if (!profile) throw new Error('Perfil não encontrado')
    const command = profile.executablePath || profile.provider
    const env = this.environment(profile)
    try {
      const versionResult = await this.runner.run(command, ['--version'], env)
      const version = versionResult.stdout.trim() || versionResult.stderr.trim() || null
      const authenticated = await this.authentication(profile, command, env)
      return { profileId, provider: profile.provider, installed: true, authenticated, version, executablePath: command, capabilities: profile.provider === 'codex' ? ['app-server', 'streaming', 'resume', 'approvals', 'plan'] : ['stream-json', 'resume', 'permissions', 'plan'], checkedAt: new Date().toISOString(), error: null }
    } catch (error) {
      return { profileId, provider: profile.provider, installed: false, authenticated: false, version: null, executablePath: command, capabilities: [], checkedAt: new Date().toISOString(), error: safeError(error) }
    }
  }

  async probeAll(): Promise<AgentProbe[]> { return Promise.all(this.profiles.list().map((profile) => this.probe(profile.id))) }

  install(profileId: string): { started: true } {
    const profile = this.profiles.get(profileId)
    const packageName = profile.provider === 'codex' ? '@openai/codex@latest' : '@anthropic-ai/claude-code@latest'
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/d', '/c', 'start', '', 'cmd.exe', '/k', 'npm', 'install', '-g', packageName], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
    } else {
      const child = spawn('npm', ['install', '-g', packageName], { detached: true, stdio: 'ignore' })
      child.unref()
    }
    return { started: true }
  }

  login(profileId: string): { started: true } {
    const profile = this.profiles.get(profileId)
    const command = profile.executablePath || profile.provider
    const args = profile.provider === 'codex' ? ['login'] : ['auth', 'login']
    const env = this.environment(profile)
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
    else env.CLAUDE_CONFIG_DIR = profile.configDir
    return env
  }

  private async authentication(profile: AgentProfile, command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
    try {
      const result = await this.runner.run(command, profile.provider === 'codex' ? ['login', 'status'] : ['auth', 'status'], env)
      if (profile.provider === 'codex') return /logged in/i.test(`${result.stdout}\n${result.stderr}`)
      const status = JSON.parse(result.stdout) as { loggedIn?: boolean }
      return status.loggedIn === true
    } catch { return false }
  }
}

function safeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[redacted]').slice(0, 500)
}
