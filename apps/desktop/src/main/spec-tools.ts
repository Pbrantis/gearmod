import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolsStatus } from '@gearmod/contracts'
import type { AppDatabase } from './database'
import { nativeCommands, type CommandRunner } from './playwright-cli'
import { tm } from './i18n'

/** First `x.y.z` version in a `--version` output; `null` if there is none. */
const versionOf = (output: string): string | null => /(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/.exec(output)?.[1] ?? null

/** Folders (and name pattern) that `specify init` creates for each integration; just a hint of which agent was configured. */
const integrationTraces: Array<{ id: string; folder: string; pattern: RegExp }> = [
  { id: 'claude', folder: join('.claude', 'commands'), pattern: /^speckit/i }, { id: 'claude', folder: join('.claude', 'skills'), pattern: /^speckit/i },
  { id: 'codex', folder: join('.codex', 'prompts'), pattern: /^speckit/i }, { id: 'codex', folder: join('.agents', 'skills'), pattern: /^speckit/i },
  { id: 'copilot', folder: join('.github', 'prompts'), pattern: /^speckit/i }, { id: 'cursor', folder: join('.cursor', 'commands'), pattern: /^speckit/i },
  { id: 'gemini', folder: join('.gemini', 'commands'), pattern: /^speckit/i }, { id: 'windsurf', folder: join('.windsurf', 'workflows'), pattern: /^speckit/i },
  { id: 'opencode', folder: join('.opencode', 'command'), pattern: /^speckit/i }, { id: 'qwen', folder: join('.qwen', 'commands'), pattern: /^speckit/i }
]

/** Spec Kit integrations in a repository: `.specify/integration.json` (when the CLI writes it) or the command files it leaves behind. */
export function specKitIntegrations(repo: string): string[] {
  const found = new Set<string>()
  try {
    const saved = JSON.parse(readFileSync(join(repo, '.specify', 'integration.json'), 'utf8')) as { integration?: unknown; integrations?: unknown }
    for (const item of [saved.integration, ...(Array.isArray(saved.integrations) ? saved.integrations : [])]) if (typeof item === 'string' && item) found.add(item)
  } catch { /* no file: falls back to the traces */ }
  for (const trace of integrationTraces) { try { if (readdirSync(join(repo, trace.folder)).some((name) => trace.pattern.test(name))) found.add(trace.id) } catch { /* folder absent */ } }
  return [...found]
}

export type SpecKitStage = 'specify' | 'clarify' | 'plan' | 'checklist' | 'tasks' | 'analyze' | 'implement'

/** `speckit-implement` request in the planning chat: run control refuses and the screen offers to move the card. */
export class SpecKitImplementBlocked extends Error {
  constructor() { super(tm().speckit.implementBlocked) }
}

/** Blocks the explicit invocation of the implementation skill in planning.
 * This does not restrict other tools or prevent other file edits. */
export function isSpecKitImplementRequest(prompt: string, skill?: { name: string; path: string } | null): boolean {
  return /(?:^|[\s/\\$])speckit[-.]implement(?:\b|$)/i.test(prompt) ||
    Boolean(skill && /(?:^|[\s/\\$])speckit[-.]implement(?:\b|$)/i.test(`${skill.name} ${skill.path}`))
}

/** Checks the concrete skill, not just the traces or the integration manifest. Does not install or change files. */
export function specKitSkill(repo: string, provider: 'codex' | 'claude' | 'gemini', stage: SpecKitStage): string | null {
  if (!existsSync(join(repo, '.specify'))) return null
  const folder = provider === 'codex' ? join('.agents', 'skills') : join('.claude', 'skills')
  const skill = join(repo, folder, `speckit-${stage}`, 'SKILL.md')
  try { return readFileSync(skill, 'utf8').trim() ? skill : null } catch { return null }
}

/**
 * Only detects Spec Kit and OpenSpec (what is installed and which repositories were initialized). Whoever installs and updates is the app's terminal,
 * with fixed commands; nothing is ever installed here. Each command has a short maximum time and a missing command becomes `null`, not an error.
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
