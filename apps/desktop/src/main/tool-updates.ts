import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { toolKeys, type ToolVersions } from '@agentboard/contracts'

type Key = typeof toolKeys[number]
/** De onde vem a última versão de cada ferramenta: pacote do npm ou release do GitHub. */
const sources: Record<Key, { kind: 'npm'; name: string } | { kind: 'github'; repo: string }> = {
  claude: { kind: 'npm', name: '@anthropic-ai/claude-code' }, codex: { kind: 'npm', name: '@openai/codex' }, openspec: { kind: 'npm', name: '@fission-ai/openspec' },
  playwright: { kind: 'npm', name: '@playwright/cli' }, specify: { kind: 'github', repo: 'github/spec-kit' }
}
const day = 24 * 60 * 60 * 1000
export type FetchJson = (url: string, timeoutMs: number) => Promise<unknown>
const nativeFetch: FetchJson = async (url, timeoutMs) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json', 'user-agent': 'AgentBoard' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}
const empty = (): ToolVersions => ({ checkedAt: null, versions: { claude: null, codex: null, specify: null, openspec: null, playwright: null }, error: null })

/**
 * Última versão publicada de Claude Code, Codex, Spec Kit, OpenSpec e Playwright CLI, para avisar de atualização. Busca no máximo uma vez a cada 24 h
 * (ou com `force`), guarda o resultado num arquivo e, sem internet, devolve o que tinha com `error` em vez de estourar.
 */
export class ToolUpdateService {
  private cache: ToolVersions | null = null
  constructor(private readonly file: string, private readonly fetchJson: FetchJson = nativeFetch, private readonly now: () => number = Date.now) {}

  private load(): ToolVersions {
    if (this.cache) return this.cache
    try { const saved = JSON.parse(readFileSync(this.file, 'utf8')) as ToolVersions; this.cache = { ...empty(), ...saved, versions: { ...empty().versions, ...saved.versions }, error: null } } catch { this.cache = empty() }
    return this.cache
  }

  async latest(force = false): Promise<ToolVersions> {
    const cached = this.load()
    if (!force && cached.checkedAt && this.now() - Date.parse(cached.checkedAt) < day) return cached
    const versions = { ...cached.versions }
    let failed = 0
    await Promise.all(toolKeys.map(async (key) => {
      const source = sources[key]
      try {
        const data = await this.fetchJson(source.kind === 'npm' ? `https://registry.npmjs.org/${source.name.replace('/', '%2F')}/latest` : `https://api.github.com/repos/${source.repo}/releases/latest`, 8000) as { version?: unknown; tag_name?: unknown }
        const text = source.kind === 'npm' ? data.version : data.tag_name
        if (typeof text !== 'string' || !text) throw new Error('resposta sem versão')
        versions[key] = text.replace(/^v/i, '')
      } catch { failed++ }
    }))
    const error = failed ? 'Não foi possível verificar atualizações' : null
    // Só marca como verificado quando tudo respondeu; assim uma falha não esconde a próxima tentativa por 24 h.
    this.cache = { checkedAt: failed ? cached.checkedAt : new Date(this.now()).toISOString(), versions, error }
    if (failed < toolKeys.length) { try { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, JSON.stringify({ checkedAt: this.cache.checkedAt, versions })) } catch { /* só não guarda o cache */ } }
    return this.cache
  }
}
