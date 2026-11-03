import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { McpPreset, McpServer, McpServerInput } from '@gearmod/contracts'
import type { AppDatabase } from './database'
import { SecretStore, type SecureStorage } from './secrets'
import { tm } from './i18n'

export type McpProvider = 'claude' | 'codex' | 'gemini'
/** O que o adaptador recebe para injetar na execução; contém segredos, nunca vai ao renderer. */
export type McpRunServer = { name: string } & ({ transport: 'stdio'; command: string; args: string[]; env: Record<string, string> } | { transport: 'http'; url: string; headers: Record<string, string> })

/** Servidores mais usados para começar. Só preenchem o formulário: nada é instalado nem executado ao escolher. */
export const mcpPresets: McpPreset[] = [
  { id: 'filesystem', label: 'Filesystem', get description() { return tm().mcpPresets.filesystemDescription }, transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '<pasta permitida>'], env: [], headers: [], get note() { return tm().mcpPresets.filesystemNote } },
  { id: 'github', label: 'GitHub', get description() { return tm().mcpPresets.githubDescription }, transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: ['GITHUB_PERSONAL_ACCESS_TOKEN'], headers: [], get note() { return tm().mcpPresets.githubNote } },
  { id: 'playwright', label: 'Playwright', get description() { return tm().mcpPresets.playwrightDescription }, transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'], env: [], headers: [] },
  { id: 'context7', label: 'Context7', get description() { return tm().mcpPresets.context7Description }, transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: [], headers: [] },
  { id: 'fetch', label: 'Fetch', get description() { return tm().mcpPresets.fetchDescription }, transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'], env: [], headers: [], get note() { return tm().mcpPresets.fetchNote } },
  { id: 'memory', label: 'Memory', get description() { return tm().mcpPresets.memoryDescription }, transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: [], headers: [] },
  { id: 'sequential-thinking', label: 'Sequential Thinking', get description() { return tm().mcpPresets.sequentialThinkingDescription }, transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], env: [], headers: [] },
  { id: 'postgres', label: 'PostgreSQL', get description() { return tm().mcpPresets.postgresDescription }, transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', '<string de conexão>'], env: [], headers: [], get note() { return tm().mcpPresets.postgresNote } },
  { id: 'remote', get label() { return tm().mcpPresets.remoteLabel }, get description() { return tm().mcpPresets.remoteDescription }, transport: 'http', command: '', args: [], env: [], headers: ['Authorization'], get note() { return tm().mcpPresets.remoteNote } }
]

const nameRule = /^[a-z0-9][a-z0-9_-]{0,39}$/i
const reserved = new Set(['gearmod'])
type Secrets = { env: Record<string, string>; headers: Record<string, string> }
type Row = { id: string; scope: 'global' | 'project'; projectId: string | null; name: string; presetId: string | null; transport: 'stdio' | 'http'; command: string | null; argsJson: string; url: string | null; envKeysJson: string; headerKeysJson: string; providersJson: string; enabled: number }

/**
 * Cadastro de servidores MCP do GearMod: uma lista global e uma por projeto, com liga/desliga por agente.
 * Os servidores são injetados na hora de rodar cada agente; os arquivos de configuração do Claude/Codex não são tocados.
 * Valores de env e cabeçalhos ficam no cofre do sistema, nunca no SQLite nem no renderer.
 */
export class McpRegistry {
  constructor(private readonly database: AppDatabase, private readonly secretDir: string, private readonly storage: SecureStorage) {}
  private store(id: string): SecretStore { return new SecretStore(join(this.secretDir, `${id}.bin`), this.storage) }
  private async secrets(id: string): Promise<Secrets> {
    try { const raw = await this.store(id).read(); const parsed = raw ? JSON.parse(raw) as Partial<Secrets> : {}; return { env: parsed.env ?? {}, headers: parsed.headers ?? {} } } catch { return { env: {}, headers: {} } }
  }
  private rows(projectId?: string): Row[] {
    return this.database.db.prepare(`SELECT id, scope, project_id AS projectId, name, preset_id AS presetId, transport, command, args_json AS argsJson, url, env_keys_json AS envKeysJson, header_keys_json AS headerKeysJson, providers_json AS providersJson, enabled FROM mcp_servers
      WHERE scope = 'global' ${projectId ? "OR (scope = 'project' AND project_id = @projectId)" : ''} ORDER BY scope, name`).all(projectId ? { projectId } : {}) as Row[]
  }
  private disabledHere(projectId: string): Set<string> { return new Set(this.database.db.prepare('SELECT server_id FROM mcp_project_disabled WHERE project_id = ?').pluck().all(projectId) as string[]) }
  private async view(row: Row, disabled: Set<string>): Promise<McpServer> {
    const secrets = await this.secrets(row.id), keys = (json: string): string[] => JSON.parse(json) as string[]
    return { id: row.id, scope: row.scope, projectId: row.projectId, name: row.name, presetId: row.presetId, transport: row.transport, command: row.command ?? '', args: JSON.parse(row.argsJson) as string[], url: row.url ?? '', env: keys(row.envKeysJson).map((key) => ({ key, set: Boolean(secrets.env[key]) })), headers: keys(row.headerKeysJson).map((key) => ({ key, set: Boolean(secrets.headers[key]) })), providers: JSON.parse(row.providersJson) as McpProvider[], enabled: Boolean(row.enabled), disabledHere: disabled.has(row.id) }
  }

  /** Globais e, com `projectId`, também os do projeto. Valores secretos aparecem só como "definido ou não". */
  async list(projectId?: string): Promise<McpServer[]> {
    const disabled = projectId ? this.disabledHere(projectId) : new Set<string>()
    return Promise.all(this.rows(projectId).map((row) => this.view(row, disabled)))
  }

  async save(input: McpServerInput): Promise<McpServer> {
    const name = input.name.trim()
    if (!nameRule.test(name)) throw new Error(tm().mcpRegistry.invalidServerName)
    if (reserved.has(name.toLowerCase())) throw new Error(tm().mcpRegistry.reservedName(name))
    if (input.scope === 'project' && !input.projectId) throw new Error(tm().mcpRegistry.projectServerNeedsProject)
    if (input.scope === 'project' && !this.database.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(input.projectId)) throw new Error(tm().mcpRegistry.projectNotFoundDot)
    if (input.transport === 'stdio' && !input.command.trim()) throw new Error(tm().mcpRegistry.enterServerCommand)
    if (input.transport === 'http' && !/^https?:\/\/\S+$/i.test(input.url.trim())) throw new Error(tm().mcpRegistry.enterValidUrl)
    if (!input.providers.length) throw new Error(tm().mcpRegistry.chooseAtLeastOneAgent)
    const duplicate = this.database.db.prepare(`SELECT id FROM mcp_servers WHERE lower(name) = lower(?) AND scope = ? AND COALESCE(project_id, '') = ? AND id <> ?`).pluck().get(name, input.scope, input.scope === 'project' ? input.projectId ?? '' : '', input.id ?? '')
    if (duplicate) throw new Error(tm().mcpRegistry.serverNameExists(name))
    const id = input.id ?? randomUUID(), now = new Date().toISOString()
    const previous = input.id ? await this.secrets(id) : { env: {}, headers: {} }
    // Valor vazio mantém o segredo já guardado; chave removida some. Só o que foi digitado substitui.
    const merge = (keys: Array<{ key: string; value?: string }>, old: Record<string, string>): Record<string, string> => Object.fromEntries(keys.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value ? item.value : old[item.key.trim()] ?? '']))
    const env = merge(input.env, previous.env), headers = merge(input.headers, previous.headers)
    const row = { id, scope: input.scope, projectId: input.scope === 'project' ? input.projectId : null, name, presetId: input.presetId ?? null, transport: input.transport, command: input.transport === 'stdio' ? input.command.trim() : null, argsJson: JSON.stringify(input.transport === 'stdio' ? input.args.filter((arg) => arg !== '') : []), url: input.transport === 'http' ? input.url.trim() : null, envKeys: JSON.stringify(input.transport === 'stdio' ? Object.keys(env) : []), headerKeys: JSON.stringify(input.transport === 'http' ? Object.keys(headers) : []), providers: JSON.stringify([...new Set(input.providers)]), enabled: input.enabled ? 1 : 0, now }
    this.database.db.prepare(`INSERT INTO mcp_servers(id, scope, project_id, name, preset_id, transport, command, args_json, url, env_keys_json, header_keys_json, providers_json, enabled, created_at, updated_at)
      VALUES (@id, @scope, @projectId, @name, @presetId, @transport, @command, @argsJson, @url, @envKeys, @headerKeys, @providers, @enabled, @now, @now)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, preset_id = excluded.preset_id, transport = excluded.transport, command = excluded.command, args_json = excluded.args_json, url = excluded.url, env_keys_json = excluded.env_keys_json, header_keys_json = excluded.header_keys_json, providers_json = excluded.providers_json, enabled = excluded.enabled, updated_at = excluded.updated_at`).run(row)
    await this.store(id).write(Object.keys(env).length || Object.keys(headers).length ? JSON.stringify({ env: input.transport === 'stdio' ? env : {}, headers: input.transport === 'http' ? headers : {} }) : null)
    return (await this.list(input.scope === 'project' ? input.projectId : undefined)).find((item) => item.id === id)!
  }

  async remove(id: string): Promise<void> {
    this.database.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
    await this.store(id).write(null)
  }

  /** Servidor global ligado/desligado só para este projeto. */
  setProjectEnabled(projectId: string, serverId: string, enabled: boolean): void {
    if (!this.database.db.prepare("SELECT 1 FROM mcp_servers WHERE id = ? AND scope = 'global'").get(serverId)) throw new Error(tm().mcpRegistry.onlyGlobalCanBeDisabled)
    if (enabled) this.database.db.prepare('DELETE FROM mcp_project_disabled WHERE project_id = ? AND server_id = ?').run(projectId, serverId)
    else this.database.db.prepare('INSERT OR IGNORE INTO mcp_project_disabled(project_id, server_id) VALUES (?, ?)').run(projectId, serverId)
  }

  /** O que de fato roda neste projeto com este agente: ligado, do agente, e não desligado no projeto. */
  async effective(projectId: string, provider: McpProvider): Promise<McpRunServer[]> {
    const disabled = this.disabledHere(projectId), result: McpRunServer[] = []
    for (const row of this.rows(projectId)) {
      if (!row.enabled || disabled.has(row.id) || !(JSON.parse(row.providersJson) as string[]).includes(provider)) continue
      const secrets = await this.secrets(row.id)
      result.push(row.transport === 'stdio'
        ? { name: row.name, transport: 'stdio', command: row.command ?? '', args: JSON.parse(row.argsJson) as string[], env: secrets.env }
        : { name: row.name, transport: 'http', url: row.url ?? '', headers: secrets.headers })
    }
    // Projeto vence global quando têm o mesmo nome.
    const byName = new Map<string, McpRunServer>(); for (const server of result) byName.set(server.name.toLowerCase(), server)
    return [...byName.values()]
  }
}

/** Servidores extras no formato `mcp_servers` do Codex (config do thread). */
export function codexMcpServers(servers: McpRunServer[]): Record<string, Record<string, unknown>> {
  return Object.fromEntries(servers.map((server) => [server.name, server.transport === 'stdio'
    ? { command: server.command, args: server.args, env: server.env }
    : { url: server.url, ...(Object.keys(server.headers).length ? { http_headers: server.headers } : {}) }]))
}

/** Servidores extras no formato `--mcp-config` do Claude Code. */
export function claudeMcpServers(servers: McpRunServer[]): Record<string, Record<string, unknown>> {
  return Object.fromEntries(servers.map((server) => [server.name, server.transport === 'stdio'
    ? { command: server.command, args: server.args, env: server.env }
    : { type: 'http', url: server.url, ...(Object.keys(server.headers).length ? { headers: server.headers } : {}) }]))
}

/** Servidores extras no formato `mcpServers` do settings.json do Gemini CLI. */
export function geminiMcpServers(servers: McpRunServer[]): Record<string, Record<string, unknown>> {
  return Object.fromEntries(servers.map((server) => [server.name, server.transport === 'stdio'
    ? { command: server.command, args: server.args, env: server.env }
    : { httpUrl: server.url, ...(Object.keys(server.headers).length ? { headers: server.headers } : {}) }]))
}
