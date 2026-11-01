import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { PermissionMode } from '@agentboard/contracts'
import { applyEnvPolicy } from './env-policy'
import { geminiMcpServers } from './mcp-registry'
import { redact, redactObject } from './redaction'
import { runGeminiAcp } from './gemini-acp'
import type { AgentAdapter, AgentRunOptions, AgentRunResult, ProcessFactory, RunTokens } from './adapters'
import { tm } from './i18n'

type JsonObject = Record<string, unknown>

/** Modos do AgentBoard → `--approval-mode` do Gemini CLI. O modo não interativo não tem aprovação por ação: o que pediria confirmação é negado. */
export const geminiApprovalMode: Partial<Record<PermissionMode, string>> = { plan: 'plan', manual: 'default', accept_edits: 'auto_edit', auto: 'yolo', bypass: 'yolo' }

/** Uso do `result` do Gemini: `input` já exclui o cache; `cached` é a parte lida do cache. */
export function geminiUsage(stats: unknown): RunTokens | undefined {
  if (!stats || typeof stats !== 'object') return undefined
  const data = stats as Record<string, unknown>, count = (key: string): number => (typeof data[key] === 'number' && Number.isFinite(data[key]) ? Math.max(0, Math.round(data[key] as number)) : 0)
  const cached = count('cached'), input = typeof data.input === 'number' ? count('input') : Math.max(0, count('input_tokens') - cached)
  return { input, cached, output: count('output_tokens') }
}

/** Copia as skills do plugin do AgentBoard para a pasta de skills do perfil (o Gemini só descobre skills em pastas conhecidas). */
export function syncGeminiSkills(pluginDir: string | null | undefined, configDir: string): void {
  if (!pluginDir || !configDir) return
  const from = join(pluginDir, 'skills'), to = join(configDir, '.gemini', 'skills')
  try { if (existsSync(from)) { mkdirSync(to, { recursive: true }); cpSync(from, to, { recursive: true, force: true }) } } catch { /* sem as skills do plugin a execução ainda roda */ }
}

/**
 * Gemini CLI em modo não interativo (`--output-format stream-json`: eventos init, message, tool_use, tool_result, error, result).
 * O prompt vai pela entrada padrão (evita limites de linha de comando no Windows); servidores MCP vão num settings de sistema
 * temporário (`GEMINI_CLI_SYSTEM_SETTINGS_PATH`) apagado ao fim da execução; o login fica isolado por perfil (`GEMINI_CLI_HOME`).
 */
export class GeminiCliAdapter implements AgentAdapter {
  constructor(private readonly processes: ProcessFactory) {}
  async run(options: AgentRunOptions): Promise<AgentRunResult> {
    if (options.signal?.aborted) throw new Error(tm().common.executionCancelled)
    // Modo Padrão (manual): protocolo ACP, para que cada ação pendente apareça na tela de permissões do AgentBoard.
    if (!options.planning && options.mode === 'manual' && options.requestPermission) return runGeminiAcp(this.processes, options)
    // Com as ferramentas do AgentBoard ligadas, o planejamento roda no modo padrão (leitura livre; escrita e shell negados) e confia só no servidor do AgentBoard.
    const readOnlyPlanning = options.planning && Boolean(options.mcp)
    const approval = options.planning ? (readOnlyPlanning ? 'default' : 'plan') : geminiApprovalMode[options.mode ?? 'manual']
    if (!approval) throw new Error(tm().adapters.unsupportedGeminiMode(String(options.mode)))
    const args = ['--output-format', 'stream-json', '--approval-mode', approval, '--skip-trust']
    if (options.model) args.push('--model', options.model)
    if (options.sessionId) args.push('--resume', options.sessionId)
    for (const dir of new Set((options.attachments ?? []).map((path) => dirname(path)))) args.push('--include-directories', dir)
    const servers = { ...geminiMcpServers(options.mcpServers ?? []), ...(options.mcp ? { agentboard: { command: options.mcp.command, args: options.mcp.args, env: options.mcp.env, trust: true } } : {}) }
    let settingsDir: string | null = null
    const env: NodeJS.ProcessEnv = { ...applyEnvPolicy(options.profile, process.env), GEMINI_CLI_HOME: options.profile.configDir, GEMINI_CLI_TRUST_WORKSPACE: 'true', ...options.env }
    if (Object.keys(servers).length) {
      settingsDir = mkdtempSync(join(tmpdir(), 'agentboard-gemini-'))
      const file = join(settingsDir, 'settings.json')
      writeFileSync(file, JSON.stringify({ mcpServers: servers }), { mode: 0o600 })
      env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = file
    }
    syncGeminiSkills(options.pluginDir, options.profile.configDir)
    const cleanup = (): void => { if (settingsDir) { try { rmSync(settingsDir, { recursive: true, force: true }) } catch { /* temporário do sistema */ } settingsDir = null } }
    const prompt = `${options.developerInstructions ? `${options.developerInstructions}\n\n` : ''}${options.prompt}`
    let child: ChildProcessWithoutNullStreams
    try { child = this.processes.start(options.profile.executablePath || 'gemini', args, { cwd: options.cwd, env }) } catch (error) { cleanup(); throw error }
    let text = '', sessionId = options.sessionId ?? '', stderr = '', modelEffective: string | undefined, failure: string | null = null
    const abort = (): void => { child.kill() }; options.signal?.addEventListener('abort', abort, { once: true })
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000) })
    child.stdin.on('error', () => undefined)
    return new Promise<AgentRunResult>((resolve, reject) => {
      let done = false
      const finish = (result: AgentRunResult): void => { if (done) return; done = true; resolve(result) }
      createInterface({ input: child.stdout }).on('line', (line) => {
        let message: JsonObject; try { message = JSON.parse(line) as JsonObject } catch { return }
        const type = String(message.type ?? 'event')
        if (type === 'init') { if (typeof message.session_id === 'string') sessionId = message.session_id; if (typeof message.model === 'string') modelEffective = message.model }
        if (type === 'message') {
          if (message.role === 'assistant' && typeof message.content === 'string') { text += message.content; options.onEvent({ type: 'item/agentMessage/delta', payload: { delta: message.content } }) }
          return
        }
        options.onEvent({ type: `gemini/${type}`, payload: redactObject(message) })
        if (type === 'error' && message.severity === 'error' && typeof message.message === 'string') failure = redact(message.message)
        if (type === 'result') {
          const error = message.error as JsonObject | undefined, failed = message.status === 'error'
          const models = (message.stats as JsonObject | undefined)?.models as JsonObject | undefined
          const only = models && Object.keys(models).length === 1 ? Object.keys(models)[0] : undefined
          const model = modelEffective ?? only
          finish({ sessionId, turnId: null, text, status: failed ? 'failed' : 'completed', error: failed ? redact(typeof error?.message === 'string' ? error.message : failure ?? 'Gemini failed') : null, usage: geminiUsage(message.stats), ...(model ? { modelEffective: model } : {}) })
        }
      })
      child.on('error', (error) => { cleanup(); reject(error) })
      child.on('exit', (code) => {
        if (done) return
        if (options.signal?.aborted) finish({ sessionId, turnId: null, text, status: 'interrupted', error: 'Interrompido pelo usuário' })
        else { done = true; reject(new Error(tm().adapters.geminiExitedNoResult(code, redact(failure ?? stderr)))) }
      })
      child.stdin.write(prompt); child.stdin.end()
      if (options.signal?.aborted) abort()
    }).finally(() => { options.signal?.removeEventListener('abort', abort); cleanup(); if (!child.killed) child.kill() })
  }
}
