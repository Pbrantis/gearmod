import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { AgentProfile, SkillEntry, SkillProviderState, SkillScope } from '@agentboard/contracts'
import type { AgentAdapter } from './adapters'
import type { ProfileRepository, ProjectRepository } from './projects'

type Provider = 'claude' | 'codex'
const providers: Provider[] = ['claude', 'codex']
const nameRule = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Cabeçalho `name` e `description` de um SKILL.md (subconjunto de YAML suficiente para skills). */
export function parseSkillMd(text: string): { name: string | null; description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return { name: null, description: '', body: text }
  const fields: Record<string, string> = {}
  const lines = match[1]!.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]!)
    if (!line) continue
    let value = line[2]!.trim()
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      const parts: string[] = []
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) { i += 1; parts.push(lines[i]!.trim()) }
      value = parts.join(' ')
    }
    fields[line[1]!] = value.replace(/^(["'])(.*)\1$/, '$2')
  }
  return { name: fields.name ?? null, description: fields.description ?? '', body: match[2]! }
}

/** Regras de conversão entre agentes: cabeçalho só com name/description e referências do outro agente trocadas. */
export function convertSkillMd(text: string, from: Provider, to: Provider): string {
  const parsed = parseSkillMd(text), name = parsed.name ?? 'skill'
  const description = parsed.description.replace(/"/g, '\\"')
  const swaps: Array<[RegExp, string]> = to === 'codex'
    ? [[/CLAUDE\.md/g, 'AGENTS.md'], [/\.claude\/skills/g, '.agents/skills'], [/Claude Code/g, 'Codex']]
    : [[/AGENTS\.md/g, 'CLAUDE.md'], [/\.agents\/skills/g, '.claude/skills'], [/Codex/g, 'Claude Code']]
  const body = swaps.reduce((current, [pattern, value]) => current.replace(pattern, value), parsed.body)
  return `---\nname: ${name}\ndescription: "${description}"\n---\n${body.startsWith('\n') ? body : `\n${body}`}`
}

interface Found { provider: Provider; dir: string; name: string; description: string }

async function scanSkills(base: string, provider: Provider): Promise<Found[]> {
  if (!existsSync(base)) return []
  const found: Found[] = []
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const dir = join(base, entry.name), file = join(dir, 'SKILL.md')
    if (!existsSync(file)) continue
    const parsed = parseSkillMd(await readFile(file, 'utf8'))
    found.push({ provider, dir, name: parsed.name ?? entry.name, description: parsed.description })
  }
  return found
}

const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'target', 'vendor', '__pycache__', '.venv', 'venv', '.cache', 'coverage'])

/** Procura pastas com SKILL.md em qualquer lugar de uma raiz (até 5 níveis, ignorando node_modules, .git e builds). O agente é deduzido pelo caminho: .claude → Claude; .agents/.codex → Codex; o resto assume Claude. */
export async function discoverSkills(root: string, maxDepth = 5, budget = { left: 6000 }): Promise<Found[]> {
  const found: Found[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (budget.left-- <= 0) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
      const parsed = parseSkillMd(await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => ''))
      const parts = dir.split(sep).map((part) => part.toLowerCase())
      found.push({ provider: parts.includes('.agents') || parts.includes('.codex') ? 'codex' : 'claude', dir, name: parsed.name ?? basename(dir), description: parsed.description })
      return
    }
    if (depth >= maxDepth) return
    for (const entry of entries) if ((entry.isDirectory() || entry.isSymbolicLink()) && !skipDirs.has(entry.name)) await walk(join(dir, entry.name), depth + 1)
  }
  if (existsSync(root)) await walk(root, 0)
  return found
}

export type SkillReviewer = { adapters: Record<Provider, AgentAdapter>; profile(profileId: string): AgentProfile }

/** Skills globais (pastas dos agentes) e do projeto (`.claude/skills`, `.agents/skills`): detecção, importação e conversão com revisão por agente. */
export class SkillService {
  private readonly converting = new Map<string, 'convert' | 'review'>()  // chave: escopo|projeto|nome|destino
  constructor(private readonly profiles: ProfileRepository, private readonly projects: ProjectRepository, private readonly reviewer?: SkillReviewer, private readonly home: string = homedir(), private readonly emit: (type: string, payload: Record<string, unknown>) => void = () => undefined) {}

  private globalBases(provider: Provider): string[] {
    const dirs = this.profiles.list().filter((profile) => profile.provider === provider).map((profile) => join(profile.configDir, 'skills'))
    dirs.push(join(this.home, provider === 'claude' ? '.claude' : '.codex', 'skills'))
    return [...new Set(dirs)]
  }

  private projectBase(projectId: string, provider: Provider): string {
    const source = this.projects.get(projectId).sources[0]
    if (!source) throw new Error('Projeto sem pasta')
    return join(source.localPath, provider === 'claude' ? '.claude' : '.agents', 'skills')
  }

  private bases(scope: SkillScope, provider: Provider, projectId?: string): string[] {
    if (scope === 'global') return this.globalBases(provider)
    if (!projectId) throw new Error('Informe o projeto')
    const roots = this.projects.get(projectId).sources.map((source) => join(source.localPath, provider === 'claude' ? '.claude' : '.agents', 'skills'))
    return [...new Set(roots)]
  }

  /** Todas as skills do escopo (com todas as pastas de cada agente). Do projeto: procura em qualquer lugar da pasta do projeto e dos repositórios. */
  private async collect(scope: SkillScope, projectId?: string): Promise<Array<Found & { origin: string }>> {
    const result: Array<Found & { origin: string }> = []
    if (scope === 'global') {
      for (const provider of providers) for (const base of this.globalBases(provider)) for (const skill of await scanSkills(base, provider)) result.push({ ...skill, origin: `${relative(this.home, skill.dir).split(sep).join('/')}`.replace(/^(?!\.\.)/, '~/') })
      return result
    }
    if (!projectId) throw new Error('Informe o projeto')
    const project = this.projects.get(projectId), roots = [...new Set([project.localPath, ...project.sources.map((source) => source.localPath)])]
    const seen = new Set<string>(), budget = { left: 6000 }
    for (const root of roots) for (const skill of await discoverSkills(root, 5, budget)) {
      if (seen.has(skill.dir)) continue
      seen.add(skill.dir)
      const base = roots.filter((item) => skill.dir.startsWith(item)).sort((a, b) => b.length - a.length)[0] ?? root
      result.push({ ...skill, origin: relative(base, skill.dir).split(sep).join('/') })
    }
    return result
  }

  async list(scope: SkillScope, projectId?: string): Promise<SkillEntry[]> {
    const merged = new Map<string, SkillEntry>()
    for (const skill of await this.collect(scope, projectId)) {
      const entry = merged.get(skill.name) ?? { id: `${scope}:${skill.name}`, name: skill.name, description: skill.description, scope, detected: scope === 'project', providers: { claude: 'none', codex: 'none' }, paths: { claude: null, codex: null }, origin: skill.origin }
      entry.providers[skill.provider] = 'ready'; entry.paths[skill.provider] = skill.dir
      if (!entry.description) entry.description = skill.description
      merged.set(skill.name, entry)
    }
    for (const key of this.converting.keys()) {
      const [jobScope, jobProject, name, target] = key.split('|') as [SkillScope, string, string, Provider]
      const entry = merged.get(name)
      if (entry && jobScope === scope && (scope === 'global' || jobProject === projectId)) entry.providers[target] = 'converting' satisfies SkillProviderState
    }
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Exclui a skill (de um agente ou de todos). Só apaga pastas que a própria detecção encontrou, nunca um caminho qualquer. */
  async delete(input: { scope: SkillScope; projectId?: string; name: string; provider?: Provider }): Promise<SkillEntry[]> {
    const targets = (await this.collect(input.scope, input.projectId)).filter((skill) => skill.name === input.name && (!input.provider || skill.provider === input.provider))
    if (!targets.length) throw new Error('Skill não encontrada')
    for (const skill of targets) await rm(skill.dir, { recursive: true, force: true })
    return this.list(input.scope, input.projectId)
  }

  /** Importa de uma vez todas as skills (pastas com SKILL.md) de uma pasta escolhida; as que já existem ficam de fora. */
  async importFolder(input: { scope: SkillScope; projectId?: string; folderPath: string; provider: Provider }): Promise<{ imported: string[]; skipped: string[]; skills: SkillEntry[] }> {
    const found = await discoverSkills(resolve(input.folderPath))
    if (!found.length) throw new Error('Nenhuma skill (pasta com SKILL.md) encontrada nessa pasta')
    const imported: string[] = [], skipped: string[] = []
    for (const skill of found) {
      const name = skill.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64)
      if (!nameRule.test(name)) { skipped.push(skill.name); continue }
      try { await this.import({ scope: input.scope, projectId: input.projectId, sourcePath: skill.dir, name, provider: input.provider }); imported.push(name) } catch { skipped.push(name) }
    }
    return { imported, skipped, skills: await this.list(input.scope, input.projectId) }
  }

  async import(input: { scope: SkillScope; projectId?: string; sourcePath: string; name: string; provider: Provider }): Promise<SkillEntry[]> {
    if (!nameRule.test(input.name)) throw new Error('O nome da skill deve ter letras minúsculas, números e hífens (até 64 caracteres)')
    const source = resolve(input.sourcePath), info = await stat(source).catch(() => null)
    if (!info) throw new Error('Arquivo ou pasta não encontrado')
    const base = input.scope === 'global' ? this.globalBases(input.provider)[0]! : this.projectBase(input.projectId ?? '', input.provider)
    const target = join(base, input.name)
    if (existsSync(target)) throw new Error(`Já existe uma skill chamada ${input.name} para ${input.provider === 'claude' ? 'Claude' : 'Codex'}`)
    await mkdir(target, { recursive: true })
    if (info.isDirectory()) {
      if (!existsSync(join(source, 'SKILL.md'))) throw new Error('A pasta escolhida não tem SKILL.md')
      await cp(source, target, { recursive: true })
    } else {
      if (basename(source).toLowerCase() !== 'skill.md') throw new Error('Escolha uma pasta de skill ou um arquivo SKILL.md')
      await cp(source, join(target, 'SKILL.md'))
      const extras = dirname(source)
      for (const entry of await readdir(extras, { withFileTypes: true })) if (entry.isDirectory() && ['templates', 'references', 'scripts', 'assets'].includes(entry.name)) await cp(join(extras, entry.name), join(target, entry.name), { recursive: true })
    }
    const file = join(target, 'SKILL.md'), parsed = parseSkillMd(await readFile(file, 'utf8'))
    if (parsed.name !== input.name) await writeFile(file, `---\nname: ${input.name}\ndescription: "${parsed.description.replace(/"/g, '\\"')}"\n---\n${parsed.body.startsWith('\n') ? parsed.body : `\n${parsed.body}`}`)
    return this.list(input.scope, input.projectId)
  }

  /** Converte por regra e devolve na hora; a revisão pelo agente escolhido roda em segundo plano. */
  async convert(input: { scope: SkillScope; projectId?: string; name: string; from: Provider; to: Provider; reviewProfileId?: string; model?: string | null }): Promise<{ converted: true; reviewing: boolean }> {
    if (input.from === input.to) throw new Error('Escolha o outro agente')
    const entry = (await this.list(input.scope, input.projectId)).find((item) => item.name === input.name)
    const sourceDir = entry?.paths[input.from]
    if (!entry || !sourceDir) throw new Error(`A skill ${input.name} não existe para ${input.from === 'claude' ? 'Claude' : 'Codex'}`)
    if (entry.providers[input.to] !== 'none') throw new Error('Esta skill já existe para o outro agente')
    const base = input.scope === 'global' ? this.globalBases(input.to)[0]! : this.projectBase(input.projectId ?? '', input.to)
    const targetDir = join(base, input.name), key = `${input.scope}|${input.projectId ?? ''}|${input.name}|${input.to}`
    this.converting.set(key, 'convert')
    try {
      await mkdir(targetDir, { recursive: true })
      await cp(sourceDir, targetDir, { recursive: true })
      const file = join(targetDir, 'SKILL.md')
      await writeFile(file, convertSkillMd(await readFile(file, 'utf8'), input.from, input.to))
    } catch (error) { this.converting.delete(key); throw error }
    const reviewing = Boolean(input.reviewProfileId && this.reviewer)
    if (reviewing) void this.review(key, targetDir, input)
    else this.converting.delete(key)
    return { converted: true, reviewing }
  }

  private async review(key: string, targetDir: string, input: { name: string; from: Provider; to: Provider; reviewProfileId?: string; model?: string | null }): Promise<void> {
    this.converting.set(key, 'review')
    this.emit('skills/review-started', { name: input.name })
    try {
      const profile = this.reviewer!.profile(input.reviewProfileId!)
      const names = { claude: 'Claude Code', codex: 'Codex' }
      const prompt = `Esta skill "${input.name}" foi convertida automaticamente de ${names[input.from]} para ${names[input.to]}. Revise só os arquivos desta pasta: confirme que o SKILL.md tem "name" e "description" válidos para ${names[input.to]}, troque referências a ferramentas, caminhos e convenções de ${names[input.from]} pelas de ${names[input.to]} e corrija o que ficou faltando. Não crie nem altere nada fora desta pasta. Responda com um resumo curto do que mudou.`
      await this.reviewer!.adapters[profile.provider].run({ cwd: targetDir, prompt, sessionId: null, planning: false, profile, model: input.model ?? null, mode: profile.provider === 'claude' ? 'accept_edits' : 'auto', onEvent: () => undefined })
      this.emit('skills/review-finished', { name: input.name })
    } catch (error) {
      this.emit('skills/review-failed', { name: input.name, error: error instanceof Error ? error.message : String(error) })
    } finally { this.converting.delete(key) }
  }

  /** Só aceita skills que a própria detecção conhece (globais ou do projeto), nunca um caminho qualquer. */
  async assertKnown(skill: { name: string; path: string }, projectId: string): Promise<void> {
    const known = [...await this.list('global'), ...await this.list('project', projectId)].some((entry) => entry.name === skill.name && Object.values(entry.paths).includes(skill.path))
    if (!known) throw new Error('Skill desconhecida')
  }

  /** Conteúdo de uma skill para o provedor (usado para injetar a skill escolhida no chat do Codex). */
  async read(path: string): Promise<string> { return parseSkillMd(await readFile(join(path, 'SKILL.md'), 'utf8')).body.trim() }
}
