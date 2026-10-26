import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { PlaywrightStatus } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import type { CardHistoryService } from './history'

const exec = promisify(execFile)
/** Roda um comando numa pasta. No Windows, `npm`/`.cmd` precisam de shell; os argumentos aqui são sempre fixos, nunca do usuário. */
export interface CommandRunner { run(command: string, args: string[], cwd: string, timeoutMs: number): Promise<string> }
export const nativeCommands: CommandRunner = {
  run: async (command, args, cwd, timeoutMs) => {
    const result = await exec(command, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, shell: process.platform === 'win32', env: { ...process.env, CI: '1' } })
    return `${result.stdout}${result.stderr}`
  }
}

const bin = (repo: string): string => join(repo, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright-cli.cmd' : 'playwright-cli')
/** Onde o Playwright guarda os navegadores baixados; tem navegador quando existe uma pasta chromium-* ali. */
const browserReady = (): boolean => {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0' ? process.env.PLAYWRIGHT_BROWSERS_PATH : process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ms-playwright') : process.platform === 'darwin' ? join(homedir(), 'Library', 'Caches', 'ms-playwright') : join(homedir(), '.cache', 'ms-playwright')
  try { return readdirSync(root).some((name) => /^chromium(_headless_shell)?-/.test(name)) } catch { return false }
}
const quote = (path: string): string => process.platform === 'win32' ? `"${path}"` : path

/**
 * Playwright CLI oficial (`@playwright/cli`, comando `playwright-cli`) como capacidade opcional do testador (docs/09, fase 11).
 * Só detecta e, quando o usuário confirma na tela, instala localmente num repositório (`npm install -D`). Nunca instala global.
 */
export class PlaywrightCliService {
  private log = ''
  private error: string | null = null

  constructor(private readonly database: AppDatabase, private readonly history: Pick<CardHistoryService, 'config' | 'setConfig' | 'artifactsDir'>, private readonly commands: CommandRunner = nativeCommands) {}

  async status(projectId: string): Promise<PlaywrightStatus> {
    const node = await this.commands.run('node', ['--version'], process.cwd(), 15_000).then((out) => out.trim() || null, () => null)
    const installs: PlaywrightStatus['installs'] = []
    for (const source of this.sources(projectId)) {
      if (!existsSync(bin(source.path))) continue
      const manifest = join(source.path, 'node_modules', '@playwright', 'cli', 'package.json')
      const version = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version ?? null : null
      installs.push({ sourceId: source.id, repo: source.name, path: bin(source.path), origin: 'local', version })
    }
    const global = await this.commands.run(process.platform === 'win32' ? 'where' : 'which', ['playwright-cli'], process.cwd(), 15_000).then((out) => out.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null, () => null)
    if (global) installs.push({ sourceId: null, repo: 'global', path: global, origin: 'global', version: await this.commands.run('playwright-cli', ['--version'], process.cwd(), 15_000).then((out) => out.trim().split(/\r?\n/)[0] ?? null, () => null) })
    return { node, enabled: this.history.config(projectId).playwrightCli, installs, browserReady: browserReady(), log: this.log.slice(-20_000), error: this.error }
  }

  /** Instalação local confirmada pelo usuário: pacote, navegador (opcional) e skill do agente (opcional, sem sobrescrever). */
  async install(input: { projectId: string; sourceId: string; browser: boolean; skills: Array<'claude' | 'agents'> }): Promise<PlaywrightStatus> {
    const source = this.sources(input.projectId).find((item) => item.id === input.sourceId)
    if (!source) throw new Error('Repositório não encontrado no projeto')
    this.log = ''; this.error = null
    const step = async (title: string, command: string, args: string[], timeoutMs: number): Promise<void> => {
      this.log += `\n$ ${title}\n`
      try { this.log += await this.commands.run(command, args, source.path, timeoutMs) }
      catch (error) { const text = error instanceof Error ? error.message : String(error); this.log += `${text}\n`; throw new Error(`${title} falhou: ${text.split(/\r?\n/).find((line) => line.trim())?.slice(0, 300) ?? text}`) }
    }
    try {
      if (!(await this.commands.run('node', ['--version'], source.path, 15_000).then(() => true, () => false))) throw new Error('Node.js não encontrado no PATH. Instale o Node.js 18 ou mais novo e tente de novo.')
      if (!existsSync(join(source.path, 'package.json'))) throw new Error(`${source.name} não tem package.json; a instalação local precisa de um projeto Node. Escolha outro repositório.`)
      await step('npm install -D @playwright/cli@latest', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '-D', '@playwright/cli@latest'], 10 * 60_000)
      if (!existsSync(bin(source.path))) throw new Error('O pacote foi instalado, mas o comando playwright-cli não apareceu em node_modules/.bin.')
      if (input.browser) await step('playwright-cli install-browser', quote(bin(source.path)), ['install-browser'], 15 * 60_000)
      for (const skill of [...new Set(input.skills)]) {
        const target = join(source.path, skill === 'claude' ? '.claude' : '.agents', 'skills', 'playwright-cli')
        if (existsSync(target)) this.log += `\nA skill já existe em ${target}; nada foi sobrescrito.\n`
        else await step(`playwright-cli install --skills=${skill}`, quote(bin(source.path)), ['install', `--skills=${skill}`], 5 * 60_000)
      }
      this.history.setConfig(input.projectId, { ...this.history.config(input.projectId), playwrightCli: true })
    } catch (error) { this.error = error instanceof Error ? error.message : String(error) }
    return this.status(input.projectId)
  }

  /** Baixa só o navegador (depois da instalação do CLI), usando o CLI local do repositório escolhido. */
  async installBrowser(input: { projectId: string; sourceId: string }): Promise<PlaywrightStatus> {
    const source = this.sources(input.projectId).find((item) => item.id === input.sourceId)
    if (!source) throw new Error('Repositório não encontrado no projeto')
    if (!existsSync(bin(source.path))) throw new Error('O Playwright CLI ainda não está instalado neste repositório.')
    this.log = '\n$ playwright-cli install-browser\n'; this.error = null
    try { this.log += await this.commands.run(quote(bin(source.path)), ['install-browser'], source.path, 15 * 60_000) } catch (error) { const text = error instanceof Error ? error.message : String(error); this.log += `${text}\n`; this.error = `playwright-cli install-browser falhou: ${text.split(/\r?\n/).find((line) => line.trim())?.slice(0, 300) ?? text}` }
    return this.status(input.projectId)
  }

  /** O que o testador recebe no contexto: o comando, a sessão do card e onde guardar evidências. `null` = desligado ou não instalado. */
  forCard(cardId: string): { comando: string; sessao: string; evidencias: string; regra: string } | null {
    const card = this.database.db.prepare('SELECT project_id AS projectId FROM cards WHERE id = ?').get(cardId) as { projectId: string } | undefined
    if (!card || !this.history.config(card.projectId).playwrightCli) return null
    const local = this.sources(card.projectId).find((source) => existsSync(bin(source.path)))
    if (!local) return null
    return {
      comando: bin(local.path), sessao: `ab-${cardId.slice(0, 8)}`, evidencias: join(this.history.artifactsDir(cardId), 'playwright'),
      regra: 'Use sempre -s=<sessao>; headless (padrão). Prefira snapshot e refs a screenshots; só tire screenshot (--filename dentro de evidencias) para provar um critério ou uma falha. Feche com close ao terminar.'
    }
  }

  /** Repositórios do projeto e se cada um é um projeto Node (tem package.json), requisito da instalação local. */
  nodeSources(projectId: string): Array<{ id: string; name: string; node: boolean }> {
    return this.sources(projectId).map((item) => ({ id: item.id, name: item.name, node: existsSync(join(item.path, 'package.json')) }))
  }

  private sources(projectId: string): Array<{ id: string; name: string; path: string }> {
    return this.database.db.prepare('SELECT id, name, local_path AS path FROM project_sources WHERE project_id = ? ORDER BY sort_order').all(projectId) as Array<{ id: string; name: string; path: string }>
  }
}
