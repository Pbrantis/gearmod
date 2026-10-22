import { execFile } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { VoiceModel, VoiceStatus } from '@agentboard/contracts'

const execFileAsync = promisify(execFile)
export const voiceModels: Record<VoiceModel, { file: string; label: string; sizeMb: number }> = {
  small: { file: 'ggml-small.bin', label: 'Small', sizeMb: 466 },
  'large-v3-turbo': { file: 'ggml-large-v3-turbo.bin', label: 'Large v3 Turbo', sizeMb: 1624 }
}
const modelBase = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const engineAsset = 'https://github.com/ggml-org/whisper.cpp/releases'
/** "latest" muda de nome de pacote entre versões e já devolveu 404; as versões fixas são o plano B. */
const windowsEngineUrls = [`${engineAsset}/latest/download/whisper-bin-x64.zip`, `${engineAsset}/download/v1.7.6/whisper-bin-x64.zip`, `${engineAsset}/download/v1.7.5/whisper-bin-x64.zip`]
/** Termos em inglês que aparecem no meio do português; ajudam o Whisper a não "traduzir" worktree, commit etc. */
export const supportVocabulary = 'worktree, commit, branch, pull request, merge, rebase, lint, typecheck, deploy, backend, frontend, Kanban, backlog, To do, Doing, Test, Done, Claude, Codex, AgentBoard, Markdown, SQLite, Electron, React, TypeScript, skill, prompt'

export interface VoiceDeps {
  dataDir: string
  platform?: NodeJS.Platform
  fetchImpl?: typeof fetch
  run?: (command: string, args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string }>
  pathEnv?: string
  emit?: (type: string, payload: Record<string, unknown>) => void
  modelUrl?: (model: VoiceModel) => string
  engineUrl?: string
}

/** Ditado por voz local: whisper.cpp como processo separado (nunca na thread da interface) e modelo baixado sob demanda para a pasta de dados. */
export class VoiceService {
  private downloading: VoiceStatus['downloading'] = null
  private readonly platform: NodeJS.Platform
  constructor(private readonly deps: VoiceDeps) { this.platform = deps.platform ?? process.platform }

  private get binDir(): string { return join(this.deps.dataDir, 'whisper', 'bin') }
  private get modelsDir(): string { return join(this.deps.dataDir, 'whisper', 'models') }
  private modelPath(model: VoiceModel): string { return join(this.modelsDir, voiceModels[model].file) }

  private engineNames(): string[] { return this.platform === 'win32' ? ['whisper-cli.exe'] : ['whisper-cli', 'whisper-cpp'] }

  async findEngine(): Promise<string | null> {
    // O pacote do Windows traz o whisper-cli.exe junto das DLLs (e um main.exe obsoleto que só avisa e sai com erro): usa o whisper-cli onde ele estiver.
    const local = await findFile(this.binDir, this.engineNames()).catch(() => null)
    if (local) return local
    for (const folder of (this.deps.pathEnv ?? process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
      for (const name of this.engineNames()) { const candidate = join(folder, name); if (existsSync(candidate)) return candidate }
    }
    return null
  }

  async status(model: VoiceModel): Promise<VoiceStatus> {
    const enginePath = await this.findEngine()
    return { model, modelInstalled: await this.hasModel(model), engineInstalled: Boolean(enginePath), canInstallEngine: this.platform === 'win32', sizeMb: voiceModels[model].sizeMb, downloading: this.downloading }
  }

  private async hasModel(model: VoiceModel): Promise<boolean> {
    const info = await stat(this.modelPath(model)).catch(() => null)
    return Boolean(info && info.size > 10 * 1024 * 1024)
  }

  /** Baixa o modelo (e, no Windows, o executável) com progresso; nada é baixado sem o usuário pedir. */
  async install(model: VoiceModel): Promise<VoiceStatus> {
    if (this.downloading) throw new Error('Já existe um download em andamento')
    try {
      if (!await this.findEngine()) {
        if (this.platform !== 'win32') throw new Error('Instale o whisper.cpp (comando whisper-cli) e deixe no PATH; depois baixe o modelo aqui.')
        await this.installEngine()
      }
      if (!await this.hasModel(model)) await this.download(this.deps.modelUrl?.(model) ?? `${modelBase}/${voiceModels[model].file}`, this.modelPath(model), 'modelo')
    } finally { this.downloading = null; this.deps.emit?.('voice/progress', { item: null }) }
    return this.status(model)
  }

  private async installEngine(): Promise<void> {
    await mkdir(this.binDir, { recursive: true })
    const zip = join(this.binDir, 'whisper-bin.zip')
    let failure: unknown
    for (const url of this.deps.engineUrl ? [this.deps.engineUrl] : windowsEngineUrls) {
      try { await this.download(url, zip, 'programa'); failure = undefined; break } catch (error) { failure = error }
    }
    if (failure) throw failure
    await (this.deps.run ?? defaultRun)('tar', ['-xf', zip, '-C', this.binDir], 120_000)
    await rm(zip, { force: true })
    const found = await findFile(this.binDir, this.engineNames())
    if (!found) throw new Error('O pacote baixado não trouxe o whisper-cli.exe (só o main.exe obsoleto). Instale o whisper.cpp manualmente.')
  }

  private async download(url: string, target: string, item: 'programa' | 'modelo'): Promise<void> {
    await mkdir(join(target, '..'), { recursive: true })
    const response = await (this.deps.fetchImpl ?? fetch)(url, { redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`Não foi possível baixar o ${item} (HTTP ${response.status})`)
    const total = Number(response.headers.get('content-length')) || null
    let received = 0
    const partial = `${target}.part`
    this.downloading = { item, received: 0, total }
    const source = Readable.fromWeb(response.body as never)
    source.on('data', (chunk: Buffer) => { received += chunk.length; this.downloading = { item, received, total }; this.deps.emit?.('voice/progress', { item, received, total }) })
    try { await pipeline(source, createWriteStream(partial)); await rename(partial, target) } catch (error) { await rm(partial, { force: true }); throw error }
  }

  /** Transcreve um WAV (16 kHz, mono, 16 bits). O texto volta para o campo do chat; ditado não gasta token. */
  async transcribe(input: { wav: Uint8Array; model: VoiceModel; language: string; prompt?: string }): Promise<string> {
    const engine = await this.findEngine()
    if (!engine) throw new Error('O programa de transcrição não está instalado')
    if (!await this.hasModel(input.model)) throw new Error('O modelo de voz ainda não foi baixado')
    if (input.wav.byteLength < 2000) return ''
    const temp = join(this.deps.dataDir, 'whisper', `ditado-${Date.now()}-${Math.random().toString(16).slice(2)}.wav`)
    await mkdir(join(this.deps.dataDir, 'whisper'), { recursive: true })
    await writeFile(temp, input.wav)
    try {
      const prompt = [supportVocabulary, input.prompt].filter(Boolean).join(', ').slice(0, 800)
      const args = ['-m', this.modelPath(input.model), '-f', temp, '-l', input.language, '-nt', '-np', '--prompt', prompt]
      const { stdout } = await (this.deps.run ?? defaultRun)(engine, args, 180_000)
      return stdout.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
    } finally { await rm(temp, { force: true }) }
  }
}

async function defaultRun(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' })
}

async function findFile(dir: string, names: string[]): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { const nested = await findFile(full, names); if (nested) return nested }
    else if (names.includes(entry.name)) return full
  }
  return null
}
