import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type { PlaywrightStatus } from '@gearmod/contracts'
import type { AppDatabase } from './database'
import type { CardHistoryService } from './history'
import { applyEnvPolicy } from './env-policy'
import { tm } from './i18n'

const exec = promisify(execFile)

/** Runs a command in a folder. `env` goes on top of the already filtered environment; `path` goes in front of PATH. The arguments here are always fixed, never from the user. */
export interface CommandRunner { run(command: string, args: string[], cwd: string, timeoutMs: number, extra?: { env?: Record<string, string>; path?: string }): Promise<string> }
export const nativeCommands: CommandRunner = {
  run: async (command, args, cwd, timeoutMs, extra) => {
    const env: NodeJS.ProcessEnv = { ...applyEnvPolicy({ envPassthrough: [] }, process.env), CI: '1', ...extra?.env }
    if (extra?.path) {
      const key = Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'PATH'
      env[key] = `${extra.path}${delimiter}${env[key] ?? ''}`
    }
    const result = await exec(command, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, shell: process.platform === 'win32', env })
    return `${result.stdout}${result.stderr}`
  }
}

/** Portable Node the app downloads when the machine has no Node 18+ (fixed version and SHA-256, from nodejs.org/dist). */
export const nodeRelease = {
  version: '22.23.4',
  url: 'https://nodejs.org/dist/v22.23.4/node-v22.23.4-win-x64.zip',
  sha256: 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20'
}
const minNodeMajor = 18
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const wrapperName = 'gearmod-playwright-cli.cmd'

const compareVersions = (a: string, b: string): number => {
  const parts = (value: string): number[] => value.split('-')[0]!.split('.').map((item) => Number(item) || 0)
  const left = parts(a), right = parts(b)
  for (let index = 0; index < 3; index += 1) if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) - (right[index] ?? 0)
  return 0
}

export interface PlaywrightDeps {
  fetchImpl?: typeof fetch
  node?: { version: string; url: string; sha256?: string }
}

/**
 * Playwright CLI (`@playwright/cli`) as a tool of GearMod itself (docs/09, phase 11): lives in an app folder, never inside the project.
 * Each installed version has its own folder and the project chooses which one to use; installing a new version does not touch the others. The browsers are
 * shared. Without Node 18+ on the machine, the app downloads a portable Node (checked by SHA-256) and uses it only for this tool.
 *
 *   <toolsDir>/playwright-cli/<version>/  package + node_modules + gearmod-playwright-cli.cmd (the command the agent receives)
 *   <toolsDir>/playwright-browsers/       browsers
 *   <toolsDir>/node/                      portable Node, if needed
 */
export class PlaywrightCliService {
  private log = ''
  private error: string | null = null

  constructor(private readonly database: AppDatabase, private readonly history: Pick<CardHistoryService, 'config' | 'setConfig' | 'artifactsDir'>, private readonly commands: CommandRunner = nativeCommands, private readonly toolsDir: string = join(process.cwd(), '.gearmod-tools'), private readonly deps: PlaywrightDeps = {}) {}

  private get cliRoot(): string { return join(this.toolsDir, 'playwright-cli') }
  private get browsersDir(): string { return join(this.toolsDir, 'playwright-browsers') }
  private get nodeRoot(): string { return join(this.toolsDir, 'node') }
  private get release(): { version: string; url: string; sha256?: string } { return this.deps.node ?? nodeRelease }
  private versionDir(version: string): string { return join(this.cliRoot, version) }
  private bin(version: string): string { return join(this.versionDir(version), 'node_modules', '.bin', process.platform === 'win32' ? 'playwright-cli.cmd' : 'playwright-cli') }
  private wrapper(version: string): string { return join(this.versionDir(version), wrapperName) }
  private managedNodeDir(): string { return join(this.nodeRoot, `node-v${this.release.version}-win-x64`) }

  /** Installed versions, from newest to oldest. */
  installed(): Array<{ version: string; path: string }> {
    let names: string[] = []
    try { names = readdirSync(this.cliRoot) } catch { return [] }
    return names.filter((name) => versionPattern.test(name) && existsSync(this.wrapper(name))).sort((a, b) => compareVersions(b, a)).map((version) => ({ version, path: this.wrapper(version) }))
  }

  /** Version the project uses: the chosen one, if still installed; otherwise the newest installed. */
  selected(projectId: string): string | null {
    const all = this.installed(), chosen = this.history.config(projectId).playwrightVersion
    return all.find((item) => item.version === chosen)?.version ?? all[0]?.version ?? null
  }

  /** Downloaded browsers: a chromium-* folder exists in the app's shared folder. */
  private browserReady(): boolean {
    try { return readdirSync(this.browsersDir).some((name) => /^chromium(_headless_shell)?-/.test(name)) } catch { return false }
  }

  private async systemNode(): Promise<string | null> {
    const out = await this.commands.run('node', ['--version'], process.cwd(), 15_000).then((text) => text.trim() || null, () => null)
    return out && Number(/^v?(\d+)/.exec(out)?.[1]) >= minNodeMajor ? out : null
  }
  private managedNode(): string | null { return existsSync(join(this.managedNodeDir(), 'node.exe')) ? this.release.version : null }

  /** Versions published on npm (stable only, newest to oldest) for the screen to choose which one to install. */
  async availableVersions(): Promise<string[]> {
    const response = await (this.deps.fetchImpl ?? fetch)('https://registry.npmjs.org/@playwright%2fcli', { headers: { accept: 'application/vnd.npm.install-v1+json' }, signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(tm().voice.downloadFailed('npm', response.status))
    const body = await response.json() as { versions?: Record<string, unknown> }
    return Object.keys(body.versions ?? {}).filter((version) => /^\d+\.\d+\.\d+$/.test(version)).sort((a, b) => compareVersions(b, a)).slice(0, 60)
  }

  async status(projectId: string): Promise<PlaywrightStatus> {
    const sys = await this.commands.run('node', ['--version'], process.cwd(), 15_000).then((text) => text.trim() || null, () => null)
    return {
      node: { system: sys, managed: this.managedNode() }, enabled: this.history.config(projectId).playwrightCli, selected: this.selected(projectId),
      versions: this.installed(), browserReady: this.browserReady(), toolsDir: this.toolsDir, log: this.log.slice(-20_000), error: this.error
    }
  }

  private async download(url: string, target: string, sha256: string | undefined): Promise<void> {
    await mkdir(join(target, '..'), { recursive: true })
    const response = await (this.deps.fetchImpl ?? fetch)(url, { redirect: 'follow' })
    if (!response.ok) throw new Error(tm().voice.downloadFailed('programa', response.status))
    const bytes = Buffer.from(await response.arrayBuffer())
    if (sha256 && createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error(tm().voice.checksumMismatch('programa'))
    await writeFile(target, bytes)
  }

  /** Node that will run npm and playwright-cli: the system one, if 18+; otherwise the portable one (downloaded once, with SHA-256 checked). Returns its folder, or null for the system one. */
  private async ensureNode(): Promise<string | null> {
    if (await this.systemNode()) return null
    const dir = this.managedNodeDir()
    if (existsSync(join(dir, 'node.exe'))) return dir
    this.log += `\n$ ${tm().playwrightCli.downloadingNode(this.release.version)}\n`
    await mkdir(this.nodeRoot, { recursive: true })
    const zip = join(this.nodeRoot, 'node.zip')
    try {
      await this.download(this.release.url, zip, this.release.sha256)
      await this.commands.run('tar', ['-xf', zip, '-C', this.nodeRoot], this.nodeRoot, 5 * 60_000)
    } finally { await rm(zip, { force: true }) }
    if (!existsSync(join(dir, 'node.exe'))) throw new Error(tm().playwrightCli.nodeNotFound)
    return dir
  }

  /** Installs a version in the app folder (and optionally the browser and the agent skill in a repository), and starts using it in this project. */
  async install(input: { projectId: string; version: string; browser: boolean; skills: Array<'claude' | 'agents'>; sourceId?: string | undefined }): Promise<PlaywrightStatus> {
    this.log = ''; this.error = null
    const step = async (title: string, run: () => Promise<string>): Promise<string> => {
      this.log += `\n$ ${title}\n`
      try { const out = await run(); this.log += out; return out }
      catch (error) { const text = error instanceof Error ? error.message : String(error); this.log += `${text}\n`; throw new Error(tm().playwrightCli.stepFailed(title, text.split(/\r?\n/).find((line) => line.trim())?.slice(0, 300) ?? text)) }
    }
    try {
      const nodeDir = await this.ensureNode()
      const extra = (env: Record<string, string> = {}): { env: Record<string, string>; path?: string } => ({ env, ...(nodeDir ? { path: nodeDir } : {}) })
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
      let version = input.version.trim()
      if (version === 'latest') version = (await step('npm view @playwright/cli version', () => this.commands.run(npm, ['view', '@playwright/cli', 'version'], this.toolsDir, 60_000, extra()))).trim().split(/\r?\n/).pop()?.trim() ?? ''
      if (!versionPattern.test(version)) throw new Error(tm().playwrightCli.invalidVersion(input.version))
      const dir = this.versionDir(version)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'gearmod-playwright-cli', private: true }), 'utf8')
      await step(`npm install @playwright/cli@${version}`, () => this.commands.run(npm, ['install', '--no-audit', '--no-fund', '--no-package-lock', `@playwright/cli@${version}`], dir, 10 * 60_000, extra()))
      if (!existsSync(this.bin(version))) throw new Error(tm().playwrightCli.binNotFound)
      // The command the agent receives: points to the right Node and to the shared browsers, wherever the agent runs.
      const lines = ['@echo off', ...(nodeDir ? [`set "PATH=${nodeDir};%PATH%"`] : []), `set "PLAYWRIGHT_BROWSERS_PATH=${this.browsersDir}"`, `"${this.bin(version)}" %*`]
      await writeFile(this.wrapper(version), `${lines.join('\r\n')}\r\n`, 'utf8')
      const cli = this.wrapper(version)
      const quote = (path: string): string => (process.platform === 'win32' ? `"${path}"` : path)
      if (input.browser) await step('playwright-cli install-browser', () => this.commands.run(quote(cli), ['install-browser'], dir, 15 * 60_000, extra({ PLAYWRIGHT_BROWSERS_PATH: this.browsersDir })))
      if (input.skills.length) {
        const source = this.sources(input.projectId).find((item) => item.id === input.sourceId)
        if (!source) throw new Error(tm().common.repoNotFoundInProject)
        for (const skill of [...new Set(input.skills)]) {
          const target = join(source.path, skill === 'claude' ? '.claude' : '.agents', 'skills', 'playwright-cli')
          if (existsSync(target)) this.log += `\n${tm().playwrightCli.skillExists(target)}\n`
          else await step(`playwright-cli install --skills=${skill}`, () => this.commands.run(quote(cli), ['install', `--skills=${skill}`], source.path, 5 * 60_000, extra()))
        }
      }
      this.history.setConfig(input.projectId, { ...this.history.config(input.projectId), playwrightCli: true, playwrightVersion: version })
    } catch (error) { this.error = error instanceof Error ? error.message : String(error) }
    return this.status(input.projectId)
  }

  /** Chooses, for this project, one of the already installed versions. */
  async select(input: { projectId: string; version: string }): Promise<PlaywrightStatus> {
    if (!this.installed().some((item) => item.version === input.version)) throw new Error(tm().playwrightCli.versionNotInstalled(input.version))
    this.history.setConfig(input.projectId, { ...this.history.config(input.projectId), playwrightVersion: input.version })
    return this.status(input.projectId)
  }

  /** Deletes an installed version. Projects that used it switch to the newest one left. */
  async remove(input: { projectId: string; version: string }): Promise<PlaywrightStatus> {
    if (!versionPattern.test(input.version)) throw new Error(tm().playwrightCli.invalidVersion(input.version))
    await rm(this.versionDir(input.version), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    return this.status(input.projectId)
  }

  /** Downloads only the browser (shared folder), using the version chosen in this project. */
  async installBrowser(input: { projectId: string }): Promise<PlaywrightStatus> {
    const version = this.selected(input.projectId)
    if (!version) throw new Error(tm().playwrightCli.notInstalled)
    this.log = '\n$ playwright-cli install-browser\n'; this.error = null
    try {
      const nodeDir = await this.ensureNode()
      this.log += await this.commands.run(process.platform === 'win32' ? `"${this.wrapper(version)}"` : this.wrapper(version), ['install-browser'], this.versionDir(version), 15 * 60_000, { env: { PLAYWRIGHT_BROWSERS_PATH: this.browsersDir }, ...(nodeDir ? { path: nodeDir } : {}) })
    } catch (error) { const text = error instanceof Error ? error.message : String(error); this.log += `${text}\n`; this.error = tm().playwrightCli.stepFailed('playwright-cli install-browser', text.split(/\r?\n/).find((line) => line.trim())?.slice(0, 300) ?? text) }
    return this.status(input.projectId)
  }

  /** What the tester receives in context: the command, the card's session and where to store evidence. `null` = turned off or not installed. */
  forCard(cardId: string): { comando: string; sessao: string; evidencias: string; regra: string } | null {
    const card = this.database.db.prepare('SELECT project_id AS projectId FROM cards WHERE id = ?').get(cardId) as { projectId: string } | undefined
    if (!card || !this.history.config(card.projectId).playwrightCli) return null
    const version = this.selected(card.projectId)
    if (!version) return null
    return {
      comando: this.wrapper(version), sessao: `ab-${cardId.slice(0, 8)}`, evidencias: join(this.history.artifactsDir(cardId), 'playwright'),
      regra: 'Always use -s=<sessao>. Headless is the default; when the user asks to watch the browser, open with --headed (open <url> --headed) and say so if no window appeared. Prefer snapshot and refs over screenshots; only take a screenshot (--filename inside evidencias) to prove a criterion or a failure. Close with close when done.'
    }
  }

  /** Project repositories: where the agent skill can be installed (optional). */
  nodeSources(projectId: string): Array<{ id: string; name: string; node: boolean }> {
    return this.sources(projectId).map((item) => ({ id: item.id, name: item.name, node: existsSync(join(item.path, 'package.json')) }))
  }

  private sources(projectId: string): Array<{ id: string; name: string; path: string }> {
    return this.database.db.prepare('SELECT id, name, local_path AS path FROM project_sources WHERE project_id = ? ORDER BY sort_order').all(projectId) as Array<{ id: string; name: string; path: string }>
  }
}

/** Reads the installed version of a package (used by tests and by the tools screen). */
export const packageVersion = (dir: string): string | null => {
  try { return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string }).version ?? null } catch { return null }
}
