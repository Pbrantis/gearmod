import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolsStatus } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import { nativeCommands, type CommandRunner } from './playwright-cli'

/** Primeira versão `x.y.z` de uma saída de `--version`; `null` se não houver. */
const versionOf = (output: string): string | null => /(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/.exec(output)?.[1] ?? null

/** Pastas (e padrão de nome) que o `specify init` cria para cada integração; é só um indício de qual agente foi configurado. */
const integrationTraces: Array<{ id: string; folder: string; pattern: RegExp }> = [
  { id: 'claude', folder: join('.claude', 'commands'), pattern: /^speckit/i }, { id: 'claude', folder: join('.claude', 'skills'), pattern: /^speckit/i },
  { id: 'codex', folder: join('.codex', 'prompts'), pattern: /^speckit/i }, { id: 'codex', folder: join('.agents', 'skills'), pattern: /^speckit/i },
  { id: 'copilot', folder: join('.github', 'prompts'), pattern: /^speckit/i }, { id: 'cursor', folder: join('.cursor', 'commands'), pattern: /^speckit/i },
  { id: 'gemini', folder: join('.gemini', 'commands'), pattern: /^speckit/i }, { id: 'windsurf', folder: join('.windsurf', 'workflows'), pattern: /^speckit/i },
  { id: 'opencode', folder: join('.opencode', 'command'), pattern: /^speckit/i }, { id: 'qwen', folder: join('.qwen', 'commands'), pattern: /^speckit/i }
]

/** Integrações do Spec Kit num repositório: `.specify/integration.json` (quando a CLI grava) ou os arquivos de comando que ela deixa. */
export function specKitIntegrations(repo: string): string[] {
  const found = new Set<string>()
  try {
    const saved = JSON.parse(readFileSync(join(repo, '.specify', 'integration.json'), 'utf8')) as { integration?: unknown; integrations?: unknown }
    for (const item of [saved.integration, ...(Array.isArray(saved.integrations) ? saved.integrations : [])]) if (typeof item === 'string' && item) found.add(item)
  } catch { /* sem o arquivo: cai para os rastros */ }
  for (const trace of integrationTraces) { try { if (readdirSync(join(repo, trace.folder)).some((name) => trace.pattern.test(name))) found.add(trace.id) } catch { /* pasta ausente */ } }
  return [...found]
}

/**
 * Só detecta Spec Kit e OpenSpec (o que está instalado e quais repositórios foram iniciados). Quem instala e atualiza é o terminal do app,
 * com comandos fixos; aqui nunca se instala nada. Cada comando tem tempo máximo curto e comando ausente vira `null`, não erro.
 */
export class SpecToolsService {
  constructor(private readonly database: AppDatabase, private readonly commands: CommandRunner = nativeCommands) {}

  private async version(command: string, args: string[]): Promise<string | null> { return this.commands.run(command, args, process.cwd(), 15_000).then(versionOf, () => null) }

  async status(projectId: string): Promise<ToolsStatus> {
    const [node, uv, python, specify, openspec] = await Promise.all([
      this.version('node', ['--version']), this.version('uv', ['--version']),
      this.version('python', ['--version']).then((found) => found ?? this.version('python3', ['--version'])),
      this.version('specify', ['version']).then((found) => found ?? this.version('specify', ['--version'])), this.version('openspec', ['--version'])
    ])
    const repos = (this.database.db.prepare('SELECT id, name, local_path AS path FROM project_sources WHERE project_id = ? ORDER BY sort_order').all(projectId) as Array<{ id: string; name: string; path: string }>)
      .map((source) => { const integrations = specKitIntegrations(source.path); return { sourceId: source.id, name: source.name, path: source.path, specKit: existsSync(join(source.path, '.specify')), specKitIntegrations: integrations, openSpec: existsSync(join(source.path, 'openspec')) } })
    return { node, uv, python, specify: { installed: specify !== null, version: specify }, openspec: { installed: openspec !== null, version: openspec }, repos, log: '', error: null }
  }
}
