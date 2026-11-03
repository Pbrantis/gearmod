import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentProfile } from '@gearmod/contracts'
import { GeminiCliAdapter, geminiApprovalMode, geminiUsage, syncGeminiSkills } from './gemini-adapter'
import type { ProcessFactory } from './adapters'
import { toolActivities, toolEditedFiles } from './tool-activity'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const profile = (configDir = 'C:\\profiles\\gemini'): AgentProfile => ({ id: '10000000-0000-4000-8000-000000000001', provider: 'gemini', label: 'Gemini', scope: 'work', color: '#7BA7FF', configDir, executablePath: null, enabled: true, billingMode: 'subscription', envPassthrough: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } as unknown as AgentProfile)

/** Processo falso: guarda o que foi escrito na entrada padrão e deixa o teste empurrar linhas de saída. */
function fakeGemini(script: (send: (value: Record<string, unknown>) => void, input: () => string) => void, seen?: { args: string[]; env: NodeJS.ProcessEnv; stdin: string; settings?: string }): ProcessFactory {
  return { start(_command, args, options) {
    const emitter = new EventEmitter() as EventEmitter & Partial<ChildProcessWithoutNullStreams>
    const stdin = new PassThrough(), stdout = new PassThrough(), stderr = new PassThrough()
    Object.assign(emitter, { stdin, stdout, stderr, killed: false, kill() { return true } })
    let input = ''
    stdin.on('data', (chunk: Buffer) => { input += chunk.toString() })
    stdin.on('end', () => { if (seen) { seen.stdin = input; seen.args = args; seen.env = options.env; const path = options.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH; if (path && existsSync(path)) seen.settings = readFileSync(path, 'utf8') } script((value) => stdout.write(`${JSON.stringify(value)}\n`), () => input) })
    return emitter as ChildProcessWithoutNullStreams
  } }
}
const run = (factory: ProcessFactory, extra: Record<string, unknown> = {}) => new GeminiCliAdapter(factory).run({ cwd: 'C:\\repo', prompt: 'planeje', sessionId: null, planning: true, profile: profile(), onEvent: () => undefined, ...extra } as never)
const happy = (send: (value: Record<string, unknown>) => void): void => {
  send({ type: 'init', session_id: 'sess-1', model: 'gemini-2.5-pro' })
  send({ type: 'message', role: 'user', content: 'planeje' })
  send({ type: 'message', role: 'assistant', content: 'Olá', delta: true }); send({ type: 'message', role: 'assistant', content: ' mundo', delta: true })
  send({ type: 'result', status: 'success', stats: { total_tokens: 150, input_tokens: 100, output_tokens: 50, cached: 30, input: 70, duration_ms: 10, tool_calls: 0, models: { 'gemini-2.5-pro': {} } } })
}

describe('adaptador do Gemini CLI', () => {
  it('lê o stream-json: sessão, texto em partes, modelo e consumo (cache separado)', async () => {
    const events: string[] = []
    const result = await run(fakeGemini(happy), { onEvent: (event: { type: string }) => events.push(event.type) })
    expect(result).toMatchObject({ sessionId: 'sess-1', text: 'Olá mundo', status: 'completed', modelEffective: 'gemini-2.5-pro', usage: { input: 70, cached: 30, output: 50 } })
    expect(events).toEqual(expect.arrayContaining(['item/agentMessage/delta', 'gemini/init', 'gemini/result']))
  })

  it('manda o prompt pela entrada padrão e usa login isolado por perfil, retomando a sessão', async () => {
    const seen = { args: [] as string[], env: {} as NodeJS.ProcessEnv, stdin: '' }
    await run(fakeGemini(happy, seen), { sessionId: 'sess-0', developerInstructions: 'Regras do app', model: 'flash', prompt: 'faça X' })
    expect(seen.stdin).toBe('Regras do app\n\nfaça X')
    expect(seen.args).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--resume', 'sess-0', '--model', 'flash', '--skip-trust']))
    expect(seen.args).not.toContain('faça X')
    expect(seen.env.GEMINI_CLI_HOME).toBe('C:\\profiles\\gemini')
  })

  it('traduz os modos: planejamento é plan; execução segue o modo escolhido', async () => {
    const modes: string[] = []
    const capture = (mode: string, planning: boolean, extra: Record<string, unknown> = {}) => { const seen = { args: [] as string[], env: {}, stdin: '' }; return run(fakeGemini(happy, seen), { planning, mode, ...extra }).then(() => modes.push(seen.args[seen.args.indexOf('--approval-mode') + 1]!)) }
    await capture('plan', true); await capture('accept_edits', false); await capture('auto', false); await capture('manual', false)
    expect(modes).toEqual(['plan', 'auto_edit', 'yolo', 'default'])
    expect(geminiApprovalMode.read_only).toBeUndefined()
    await expect(run(fakeGemini(happy), { planning: false, mode: 'read_only' })).rejects.toThrow(/Modo não suportado pelo Gemini/)
  })

  it('injeta servidores MCP (GearMod e cadastrados) num settings temporário e o apaga depois', async () => {
    const seen = { args: [] as string[], env: {} as NodeJS.ProcessEnv, stdin: '', settings: undefined as string | undefined }
    await run(fakeGemini(happy, seen), { planning: true, mcp: { command: 'node', args: ['server.mjs'], env: { A: '1' } }, mcpServers: [{ name: 'gh', transport: 'stdio', command: 'npx', args: ['-y', 'x'], env: { TOKEN: 't' } }, { name: 'api', transport: 'http', url: 'https://h/mcp', headers: { Authorization: 'Bearer z' } }] })
    const settings = JSON.parse(seen.settings!) as { mcpServers: Record<string, Record<string, unknown>> }
    expect(settings.mcpServers.gearmod).toMatchObject({ command: 'node', trust: true })
    expect(settings.mcpServers.gh).toEqual({ command: 'npx', args: ['-y', 'x'], env: { TOKEN: 't' } })
    expect(settings.mcpServers.api).toEqual({ httpUrl: 'https://h/mcp', headers: { Authorization: 'Bearer z' } })
    expect(seen.args[seen.args.indexOf('--approval-mode') + 1]).toBe('default')
    expect(existsSync(seen.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH!)).toBe(false)
  })

  it('sem MCP não cria settings de sistema', async () => {
    const seen = { args: [] as string[], env: {} as NodeJS.ProcessEnv, stdin: '' }
    await run(fakeGemini(happy, seen))
    expect(seen.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH).toBeUndefined()
  })

  it('erro no result vira falha com a mensagem do Gemini', async () => {
    const failed = await run(fakeGemini((send) => { send({ type: 'init', session_id: 's', model: 'm' }); send({ type: 'result', status: 'error', error: { type: 'Auth', message: 'Faça login' } }) }))
    expect(failed).toMatchObject({ status: 'failed', error: 'Faça login' })
  })

  it('interrompido pelo usuário vira "interrupted"', async () => {
    const controller = new AbortController()
    const factory: ProcessFactory = { start() {
      const emitter = new EventEmitter() as EventEmitter & Partial<ChildProcessWithoutNullStreams>
      Object.assign(emitter, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), killed: false, kill() { queueMicrotask(() => emitter.emit('exit', 1)); return true } })
      return emitter as ChildProcessWithoutNullStreams
    } }
    const pending = run(factory, { signal: controller.signal }); controller.abort()
    expect(await pending).toMatchObject({ status: 'interrupted' })
  })

  it('consumo: aceita estatística parcial e ignora lixo', () => {
    expect(geminiUsage({ input_tokens: 10, output_tokens: 4, cached: 3 })).toEqual({ input: 7, cached: 3, output: 4 })
    expect(geminiUsage(undefined)).toBeUndefined()
  })

  it('copia as skills do plugin do GearMod para a pasta de skills do perfil', () => {
    const root = mkdtempSync(join(tmpdir(), 'gearmod-gskills-')); dirs.push(root)
    mkdirSync(join(root, 'plugin', 'skills', 'gearmod-planning'), { recursive: true }); writeFileSync(join(root, 'plugin', 'skills', 'gearmod-planning', 'SKILL.md'), '# x')
    syncGeminiSkills(join(root, 'plugin'), join(root, 'home'))
    expect(existsSync(join(root, 'home', '.gemini', 'skills', 'gearmod-planning', 'SKILL.md'))).toBe(true)
    expect(() => syncGeminiSkills(null, join(root, 'home'))).not.toThrow()
  })
})

describe('atividade de ferramentas do Gemini no chat', () => {
  it('mostra a ferramenta usada e os arquivos editados', () => {
    expect(toolActivities('gemini/tool_use', { tool_name: 'read_file', parameters: { file_path: 'a.ts' } })[0]!.title).toBe('read_file a.ts')
    expect(toolEditedFiles('gemini/tool_use', { tool_name: 'write_file', parameters: { file_path: 'a.ts' } })).toEqual(['a.ts'])
    expect(toolEditedFiles('gemini/tool_use', { tool_name: 'read_file', parameters: { file_path: 'a.ts' } })).toEqual([])
  })
})
