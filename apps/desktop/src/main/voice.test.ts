import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { supportVocabulary, VoiceService } from './voice'

const roots: string[] = []
const servers: Server[] = []
afterEach(async () => { servers.splice(0).forEach((server) => server.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const tmp = async (): Promise<string> => { const root = await mkdtemp(join(tmpdir(), 'agentboard-voice-')); roots.push(root); return root }
async function serve(body: Buffer, status = 200): Promise<string> {
  const server = createServer((_request, response) => { response.writeHead(status, { 'content-length': body.length }); response.end(body) })
  servers.push(server); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/file`
}
const wav = new Uint8Array(4000)

describe('VoiceService', () => {
  it('reports what is missing and downloads the model on demand with progress, atomically', async () => {
    const dataDir = await tmp(), binDir = await tmp(), progress: Array<Record<string, unknown>> = []
    await writeFile(join(binDir, 'whisper-cli'), '')
    const url = await serve(Buffer.alloc(12 * 1024 * 1024, 1))
    const voice = new VoiceService({ dataDir, platform: 'linux', pathEnv: binDir, modelUrl: () => url, emit: (_type, payload) => progress.push(payload) })
    expect(await voice.status('small')).toMatchObject({ modelInstalled: false, engineInstalled: true, canInstallEngine: false, sizeMb: 466, downloading: null })
    const after = await voice.install('small')
    expect(after).toMatchObject({ modelInstalled: true, downloading: null })
    expect(existsSync(join(dataDir, 'whisper', 'models', 'ggml-small.bin.part'))).toBe(false)
    expect(progress.some((item) => item.item === 'modelo' && Number(item.received) > 0)).toBe(true); expect(progress.at(-1)).toEqual({ item: null })
  })

  it('fails with a clear message when the model download fails and leaves no partial file', async () => {
    const dataDir = await tmp(), binDir = await tmp()
    await writeFile(join(binDir, 'whisper-cli'), '')
    const missing = new VoiceService({ dataDir, platform: 'linux', pathEnv: binDir, modelUrl: () => '' })
    const notFound = await serve(Buffer.from('nada'), 404)
    await expect(new VoiceService({ dataDir, platform: 'linux', pathEnv: binDir, modelUrl: () => notFound }).install('small')).rejects.toThrow('HTTP 404')
    await expect(new VoiceService({ dataDir, platform: 'linux', pathEnv: binDir, modelUrl: () => 'http://127.0.0.1:1/none' }).install('small')).rejects.toThrow()
    expect(existsSync(join(dataDir, 'whisper', 'models', 'ggml-small.bin.part'))).toBe(false)
    expect((await missing.status('small')).downloading).toBeNull()
  })

  it('asks for whisper-cli outside Windows and explains it', async () => {
    const dataDir = await tmp()
    await expect(new VoiceService({ dataDir, platform: 'linux', pathEnv: '' }).install('small')).rejects.toThrow('whisper-cli')
  })

  it('transcribes through the engine with language, model and the support vocabulary and cleans the output', async () => {
    const dataDir = await tmp(), binDir = await tmp()
    await writeFile(join(binDir, 'whisper-cli'), '')
    await mkdir(join(dataDir, 'whisper', 'models'), { recursive: true }); await writeFile(join(dataDir, 'whisper', 'models', 'ggml-small.bin'), Buffer.alloc(11 * 1024 * 1024))
    const calls: Array<{ command: string; args: string[] }> = []
    const voice = new VoiceService({ dataDir, platform: 'linux', pathEnv: binDir, run: async (command, args) => { calls.push({ command, args }); expect(existsSync(args[args.indexOf('-f') + 1]!)).toBe(true); return { stdout: ' [00:00.000 --> 00:02.000]  Crie uma worktree\n nova  \n', stderr: '' } } })
    expect(await voice.transcribe({ wav, model: 'small', language: 'pt', prompt: 'Card X' })).toBe('Crie uma worktree nova')
    expect(calls[0]!.command).toBe(join(binDir, 'whisper-cli'))
    expect(calls[0]!.args).toEqual(expect.arrayContaining(['-l', 'pt', '-nt', '-np']))
    const prompt = calls[0]!.args[calls[0]!.args.indexOf('--prompt') + 1]!
    expect(prompt).toContain('worktree'); expect(prompt).toContain('Card X'); expect(prompt.startsWith(supportVocabulary.slice(0, 20))).toBe(true)
    expect(existsSync(calls[0]!.args[calls[0]!.args.indexOf('-f') + 1]!)).toBe(false)
    expect(await voice.transcribe({ wav: new Uint8Array(10), model: 'small', language: 'pt' })).toBe('')
  })

  it('refuses to transcribe without the engine or the model', async () => {
    const dataDir = await tmp(), binDir = await tmp()
    await expect(new VoiceService({ dataDir, platform: 'linux', pathEnv: '' }).transcribe({ wav, model: 'small', language: 'pt' })).rejects.toThrow('não está instalado')
    await writeFile(join(binDir, 'whisper-cli'), '')
    await expect(new VoiceService({ dataDir, platform: 'linux', pathEnv: binDir }).transcribe({ wav, model: 'small', language: 'pt' })).rejects.toThrow('ainda não foi baixado')
  })
})
