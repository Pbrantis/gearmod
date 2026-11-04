import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import type { VoiceModel, VoiceStatus } from '@gearmod/contracts'
import { tm } from './i18n'

const execFileAsync = promisify(execFile)
type LocalVoiceModel = Exclude<VoiceModel, 'groq'>
export const voiceModels: Record<LocalVoiceModel, { file: string; label: string; sizeMb: number; sha256: string }> = {
  small: { file: 'ggml-small.bin', label: 'Small', sizeMb: 466, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b' },
  'large-v3-turbo': { file: 'ggml-large-v3-turbo.bin', label: 'Large v3 Turbo', sizeMb: 1624, sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69' }
}
const groqUrl = 'https://api.groq.com/openai/v1/audio/transcriptions'
const modelBase = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const engineAsset = 'https://github.com/ggml-org/whisper.cpp/releases'
/** Fixed version and SHA-256: the downloaded executable runs on the user's machine, so only the exact file that was checked is accepted. */
const windowsEngine = { url: `${engineAsset}/download/v1.7.6/whisper-bin-x64.zip`, sha256: '0d2eca299c248f965bd0341bcb219db4b433c7f0c0ce2200d4df85765e8156a9' }
/** English terms that show up in the middle of Portuguese; they help Whisper not to "translate" worktree, commit etc. */
export const supportVocabulary = 'worktree, commit, branch, pull request, merge, rebase, lint, typecheck, deploy, backend, frontend, Kanban, backlog, To do, Doing, Test, Done, Claude, Codex, GearMod, Markdown, SQLite, Electron, React, TypeScript, skill, prompt'

export interface VoiceDeps {
  dataDir: string
  platform?: NodeJS.Platform
  fetchImpl?: typeof fetch
  run?: (command: string, args: string[], timeoutMs: number) => Promise<{ stdout: string; stderr: string }>
  pathEnv?: string
  emit?: (type: string, payload: Record<string, unknown>) => void
  modelUrl?: (model: VoiceModel) => string
  /** Expected SHA-256 when the URLs are injected (tests); with the default URLs the checksum fixed in the code always applies. */
  expectedSha256?: Partial<Record<'engine' | LocalVoiceModel, string>>
  engineUrl?: string
  /** Stores the Groq key outside the database (in the app, encrypted by the operating system). */
  secrets?: { read(): Promise<string | null>; write(value: string | null): Promise<void> }
  groqUrl?: string
}

/** Voice dictation: local whisper.cpp as a separate process (never on the UI thread, model downloaded on demand) or cloud Groq with the user's key. */
export class VoiceService {
  private downloading: VoiceStatus['downloading'] = null
  private readonly platform: NodeJS.Platform
  constructor(private readonly deps: VoiceDeps) { this.platform = deps.platform ?? process.platform }

  private get binDir(): string { return join(this.deps.dataDir, 'whisper', 'bin') }
  private get modelsDir(): string { return join(this.deps.dataDir, 'whisper', 'models') }
  private modelPath(model: LocalVoiceModel): string { return join(this.modelsDir, voiceModels[model].file) }

  private engineNames(): string[] { return this.platform === 'win32' ? ['whisper-cli.exe'] : ['whisper-cli', 'whisper-cpp'] }

  async findEngine(): Promise<string | null> {
    // The Windows package ships whisper-cli.exe alongside the DLLs (and an obsolete main.exe that only warns and exits with an error): uses whisper-cli wherever it is.
    const local = await findFile(this.binDir, this.engineNames()).catch(() => null)
    if (local) return local
    for (const folder of (this.deps.pathEnv ?? process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
      for (const name of this.engineNames()) { const candidate = join(folder, name); if (existsSync(candidate)) return candidate }
    }
    return null
  }

  async status(model: VoiceModel): Promise<VoiceStatus> {
    if (model === 'groq') return { model, cloud: true, modelInstalled: Boolean(await this.groqKey()), engineInstalled: true, canInstallEngine: false, sizeMb: 0, downloading: null }
    const enginePath = await this.findEngine()
    return { model, cloud: false, modelInstalled: await this.hasModel(model), engineInstalled: Boolean(enginePath), canInstallEngine: this.platform === 'win32', sizeMb: voiceModels[model].sizeMb, downloading: this.downloading }
  }

  private async groqKey(): Promise<string | null> { return (await this.deps.secrets?.read().catch(() => null)) || null }

  async setGroqKey(key: string, model: VoiceModel): Promise<VoiceStatus> {
    if (!this.deps.secrets) throw new Error(tm().voice.cannotStoreKey)
    // Removes line breaks and invisible characters that usually come along when pasting.
    const value = key.replace(/[^\x21-\x7e]/g, '')
    if (value) await this.checkGroqKey(value)
    await this.deps.secrets.write(value || null)
    return this.status(model)
  }

  /** Tests the key before storing it: Groq (groq.com, key gsk_…) is easy to confuse with xAI's Grok (key xai-…). */
  private async checkGroqKey(key: string): Promise<void> {
    if (/^xai-/i.test(key)) throw new Error(tm().voice.grokKeyMistake)
    const modelsUrl = (this.deps.groqUrl ?? groqUrl).replace(/\/audio\/transcriptions$/, '/models')
    let response: Response
    try { response = await (this.deps.fetchImpl ?? fetch)(modelsUrl, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) }) } catch { throw new Error(tm().voice.groqUnreachable) }
    if (response.status === 401 || response.status === 403) throw new Error(tm().voice.groqRejectedKey(await groqReason(response)))
    if (!response.ok) throw new Error(tm().voice.groqKeyCheckFailed(response.status))
  }

  private async hasModel(model: LocalVoiceModel): Promise<boolean> {
    const info = await stat(this.modelPath(model)).catch(() => null)
    return Boolean(info && info.size > 10 * 1024 * 1024)
  }

  /** Downloads the model (and, on Windows, the executable) with progress; nothing is downloaded unless the user asks. */
  async install(model: VoiceModel): Promise<VoiceStatus> {
    if (model === 'groq') throw new Error(tm().voice.registerGroqKey)
    if (this.downloading) throw new Error(tm().voice.downloadInProgress)
    try {
      if (!await this.findEngine()) {
        if (this.platform !== 'win32') throw new Error(tm().voice.installWhisper)
        await this.installEngine()
      }
      if (!await this.hasModel(model)) await this.download(this.deps.modelUrl?.(model) ?? `${modelBase}/${voiceModels[model].file}`, this.modelPath(model), 'modelo', this.deps.modelUrl ? this.deps.expectedSha256?.[model] : voiceModels[model].sha256)
    } finally { this.downloading = null; this.deps.emit?.('voice/progress', { item: null }) }
    return this.status(model)
  }

  private async installEngine(): Promise<void> {
    await mkdir(this.binDir, { recursive: true })
    const zip = join(this.binDir, 'whisper-bin.zip')
    // Injected URL (tests) has no known checksum; the default one is always checked.
    if (this.deps.engineUrl) await this.download(this.deps.engineUrl, zip, 'programa', this.deps.expectedSha256?.engine)
    else await this.download(windowsEngine.url, zip, 'programa', windowsEngine.sha256)
    await (this.deps.run ?? defaultRun)('tar', ['-xf', zip, '-C', this.binDir], 120_000)
    await rm(zip, { force: true })
    const found = await findFile(this.binDir, this.engineNames())
    if (!found) throw new Error(tm().voice.whisperCliMissing)
  }

  private async download(url: string, target: string, item: 'programa' | 'modelo', sha256?: string): Promise<void> {
    await mkdir(join(target, '..'), { recursive: true })
    const response = await (this.deps.fetchImpl ?? fetch)(url, { redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(tm().voice.downloadFailed(item, response.status))
    const total = Number(response.headers.get('content-length')) || null
    let received = 0
    const partial = `${target}.part`
    this.downloading = { item, received: 0, total }
    const source = Readable.fromWeb(response.body as never), hash = createHash('sha256')
    source.on('data', (chunk: Buffer) => { hash.update(chunk); received += chunk.length; this.downloading = { item, received, total }; this.deps.emit?.('voice/progress', { item, received, total }) })
    try {
      await pipeline(source, createWriteStream(partial))
      if (sha256 && hash.digest('hex') !== sha256) throw new Error(tm().voice.checksumMismatch(item))
      await rename(partial, target)
    } catch (error) { await rm(partial, { force: true }); throw error }
  }

  /** Transcribes a WAV (16 kHz, mono, 16 bits). The text goes back to the chat field; dictation does not spend the agents' tokens. */
  async transcribe(input: { wav: Uint8Array; model: VoiceModel; language: string; prompt?: string }): Promise<string> {
    if (input.model === 'groq') return this.transcribeGroq(input)
    const engine = await this.findEngine()
    if (!engine) throw new Error(tm().voice.transcriberNotInstalled)
    if (!await this.hasModel(input.model)) throw new Error(tm().voice.voiceModelNotDownloaded)
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

  private async transcribeGroq(input: { wav: Uint8Array; language: string; prompt?: string }): Promise<string> {
    const key = await this.groqKey()
    if (!key) throw new Error(tm().voice.registerGroqKey)
    if (input.wav.byteLength < 2000) return ''
    const form = new FormData()
    form.append('file', new Blob([Buffer.from(input.wav)],{ type: 'audio/wav' }), 'ditado.wav')
    form.append('model', 'whisper-large-v3-turbo')
    form.append('language', input.language)
    form.append('response_format', 'json')
    form.append('temperature', '0')
    // Groq accepts up to 224 prompt tokens.
    form.append('prompt', [supportVocabulary, input.prompt].filter(Boolean).join(', ').slice(0, 600))
    const response = await (this.deps.fetchImpl ?? fetch)(this.deps.groqUrl ?? groqUrl, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(60_000) })
    if (response.status === 401) throw new Error(tm().voice.groqRejectedSavedKey(await groqReason(response)))
    if (response.status === 429) throw new Error(tm().voice.groqRateLimit)
    if (!response.ok) throw new Error(tm().voice.groqNoTranscription(await groqReason(response), response.status))
    const { text } = await response.json() as { text?: string }
    return (text ?? '').replace(/\s+/g, ' ').trim()
  }
}

/** Reason Groq returns in the error body ({ error: { message } }), so as not to hide what it said. */
async function groqReason(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
  const message = body?.error?.message?.trim()
  return message ? ` ("${message.slice(0, 160)}")` : ''
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
