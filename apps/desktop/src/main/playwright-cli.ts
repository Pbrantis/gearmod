import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import type { PlaywrightStatus } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import type { CardHistoryService } from './history'
import { applyEnvPolicy } from './env-policy'
import { tm } from './i18n'

const exec = promisify(execFile)

/** Roda um comando numa pasta. `env` entra por cima do ambiente já filtrado; `path` vai na frente do PATH. Os argumentos aqui são sempre fixos, nunca do usuário. */
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

/** Node portátil que o app baixa quando a máquina não tem um Node 18+ (versão e SHA-256 fixos, de nodejs.org/dist). */
export const nodeRelease = {
  version: '22.23.4',
  url: 'https://nodejs.org/dist/v22.23.4/node-v22.23.4-win-x64.zip',
  sha256: 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20'
}
const minNodeMajor = 18
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const wrapperName = 'agentboard-playwright-cli.cmd'

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
 * Playwright CLI (`@playwright/cli`) como ferramenta do próprio AgentBoard (docs/09, fase 11): fica numa pasta do app, nunca dentro do projeto.
 * Cada versão instalada tem a sua pasta e o projeto escolhe qual usar; instalar uma versão nova não mexe nas outras. Os navegadores são
 * compartilhados. Sem Node 18+ na máquina, o app baixa um Node portátil (conferido por SHA-256) e usa só para esta ferramenta.
 *
 *   <toolsDir>/playwright-cli/<versão>/   pacote + node_modules + agentboard-playwright-cli.cmd (o comando que o agente recebe)
 *   <toolsDir>/playwright-browsers/       navegadores
 *   <toolsDir>/node/                      Node portátil, se precisar
 */
export class PlaywrightCliService {
  private log = ''
  private error: string | null = null

  constructor(private readonly database: AppDatabase, private readonly history: Pick<CardHistoryService, 'config' | 'setConfig' | 'artifactsDir'>, private readonly commands: CommandRunner = nativeCommands, private readonly toolsDir: string = join(process.cwd(), '.agentboard-tools'), private readonly deps: PlaywrightDeps = {}) {}

  private get cliRoot(): string { return join(this.toolsDir, 'playwright-cli') }
  private get browsersDir(): string { return join(this.toolsDir, 'playwright-browsers') }
  private get nodeRoot(): string { return join(this.toolsDir, 'node') }
  private get release(): { version: string; url: string; sha256?: string } { return this.deps.node ?? nodeRelease }
  private versionDir(version: string): string { return join(this.cliRoot, version) }
  private bin(version: string): string { return join(this.versionDir(version), 'node_modules', '.bin', process.platform === 'win32' ? 'playwright-cli.cmd' : 'playwright-cli') }
  private wrapper(version: string): string { return join(this.versionDir(version), wrapperName) }
  private managedNodeDir(): string { return join(this.nodeRoot, `node-v${this.release.version}-win-x64`) }

  /** Versões instaladas, da mais nova para a mais antiga. */
  installed(): Array<{ version: string; path: string }> {
    let names: string[] = []
    try { names = readdirSync(this.cliRoot) } catch { return [] }
    return names.filter((name) => versionPattern.test(name) && existsSync(this.wrapper(name))).sort((a, b) => compareVersions(b, a)).map((version) => ({ version, path: this.wrapper(version) }))
  }

  /** Versão que o projeto usa: a escolhida, se ainda estiver instalada; senão a mais nova instalada. */
  selected(projectId: string): string | null {
    const all = this.installed(), chosen = this.history.config(projectId).playwrightVersion
    return all.find((item) => item.version === chosen)?.version ?? all[0]?.version ?? null
  }

  /** Browsers baixados: existe uma pasta chromium-* na pasta compartilhada do app. */
  private browserReady(): boolean {
    try { return readdirSync(this.browsersDir).some((name) => /^chromium(_headless_shell)?-/.test(name)) } catch { return false }
  }

  private async systemNode(): Promise<string | null> {
    const out = await this.commands.run('node', ['--version'], process.cwd(), 15_000).then((text) => text.trim() || null, () => null)
    return out && Number(/^v?(\d+)/.exec(out)?.[1]) >= minNodeMajor ? out : null
  }
  private managedNode(): string | null { return existsSync(join(this.managedNodeDir(), 'node.exe')) ? this.release.version : null }

  /** Versões publicadas no npm (só as estáveis, da mais nova para a mais antiga) para a tela escolher qual instalar. */
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

  /** Node que vai rodar o npm e o playwright-cli: o do sistema, se for 18+; senão o portátil (baixado uma vez, com SHA-256 conferido). Devolve a pasta dele, ou null para o do sistema. */
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

  /** Instala uma versão na pasta do app (e opcionalmente o navegador e a skill do agente em um repositório), e passa a usá-la neste projeto. */
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
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'agentboard-playwright-cli', private: true }), 'utf8')
      await step(`npm install @playwright/cli@${version}`, () => this.commands.run(npm, ['install', '--no-audit', '--no-fund', '--no-package-lock', `@playwright/cli@${version}`], dir, 10 * 60_000, extra()))
      if (!existsSync(this.bin(version))) throw new Error(tm().playwrightCli.binNotFound)
      // O comando que o agente recebe: aponta para o Node certo e para os navegadores compartilhados, onde quer que o agente rode.
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

  /** Escolhe, para este projeto, uma das versões já instaladas. */
  async select(input: { projectId: string; version: string }): Promise<PlaywrightStatus> {
    if (!this.installed().some((item) => item.version === input.version)) throw new Error(tm().playwrightCli.versionNotInstalled(input.version))
    this.history.setConfig(input.projectId, { ...this.history.config(input.projectId), playwrightVersion: input.version })
    return this.status(input.projectId)
  }

  /** Apaga uma versão instalada. Projetos que a usavam passam à mais nova que sobrar. */
  async remove(input: { projectId: string; version: string }): Promise<PlaywrightStatus> {
    if (!versionPattern.test(input.version)) throw new Error(tm().playwrightCli.invalidVersion(input.version))
    await rm(this.versionDir(input.version), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    return this.status(input.projectId)
  }

  /** Baixa só o navegador (pasta compartilhada), usando a versão escolhida neste projeto. */
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

  /** O que o testador recebe no contexto: o comando, a sessão do card e onde guardar evidências. `null` = desligado ou não instalado. */
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

  /** Repositórios do projeto: onde a skill do agente pode ser instalada (opcional). */
  nodeSources(projectId: string): Array<{ id: string; name: string; node: boolean }> {
    return this.sources(projectId).map((item) => ({ id: item.id, name: item.name, node: existsSync(join(item.path, 'package.json')) }))
  }

  private sources(projectId: string): Array<{ id: string; name: string; path: string }> {
    return this.database.db.prepare('SELECT id, name, local_path AS path FROM project_sources WHERE project_id = ? ORDER BY sort_order').all(projectId) as Array<{ id: string; name: string; path: string }>
  }
}

/** Lê a versão instalada de um pacote (usado pelos testes e pela tela de ferramentas). */
export const packageVersion = (dir: string): string | null => {
  try { return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string }).version ?? null } catch { return null }
}
