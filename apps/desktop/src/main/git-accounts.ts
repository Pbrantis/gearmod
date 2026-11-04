import type { GitAccountInfo, GitAccountsState } from '@gearmod/contracts'
import type { AppDatabase } from './database'
import type { SecretStore } from './secrets'
import { nativeGit, type GitRunner } from './worktrees'
import { guessProvider, HostApi, HostAuthError, parseRemote, type Fetch, type HostAccess, type HostProvider, type RemoteRef } from './git-host-api'
import { tm } from './i18n'

interface Stored { token: string; provider: HostProvider; host: string; login: string; name: string; email: string | null; invalid: boolean; savedAt: string }
type Vault = Record<string, Stored>

/** Result of looking up access for a repository: no token, a token the provider rejected, or a token ready to use. */
export type AccessLookup =
  | { status: 'none'; remote: RemoteRef | null }
  | { status: 'invalid'; remote: RemoteRef; key: string }
  | { status: 'ok'; remote: RemoteRef; key: string; access: HostAccess; login: string }

const projectKey = (projectId: string, host: string): string => `project:${projectId}|${host}`
const repoKey = (sourceId: string, host: string): string => `repo:${sourceId}|${host}`
const hintOf = (token: string): string => `••••${token.slice(-4)}`

/**
 * GitHub/GitLab tokens per project (valid for all repositories on the same server) and per repository (overrides the project's).
 * They live in a single file encrypted by the system vault; the token never goes back to the screen, only who the account is and the last 4 characters.
 */
export class GitAccounts {
  private cache: Vault | null = null
  constructor(private readonly database: AppDatabase, private readonly store: SecretStore, private readonly git: GitRunner = nativeGit, private readonly fetcher?: Fetch) {}

  private async vault(): Promise<Vault> {
    if (this.cache) return this.cache
    const raw = await this.store.read()
    this.cache = raw ? JSON.parse(raw) as Vault : {}
    return this.cache
  }
  private async save(vault: Vault): Promise<void> {
    await this.store.write(Object.keys(vault).length ? JSON.stringify(vault) : null)
    this.cache = vault
  }

  private source(sourceId: string): { projectId: string; name: string; path: string } {
    const row = this.database.db.prepare('SELECT project_id AS projectId, name, local_path AS path FROM project_sources WHERE id = ?').get(sourceId) as { projectId: string; name: string; path: string } | undefined
    if (!row) throw new Error(tm().common.repoNotFoundInProject)
    return row
  }
  private async remoteOf(path: string): Promise<RemoteRef | null> {
    try { return parseRemote((await this.git.run(['-C', path, 'remote', 'get-url', 'origin'])).stdout) } catch { return null }
  }

  private info(entry: Stored, scope: 'project' | 'repo'): GitAccountInfo {
    return { scope, host: entry.host, provider: entry.provider, login: entry.login, name: entry.name, email: entry.email, hint: hintOf(entry.token), invalid: entry.invalid, savedAt: entry.savedAt }
  }

  /** Servers used by the project's repositories, with the project token, each repository's token and which one applies to whom. */
  async state(projectId: string): Promise<GitAccountsState> {
    const vault = await this.vault()
    const sources = this.database.db.prepare('SELECT id, name, local_path AS path FROM project_sources WHERE project_id = ? AND is_git_repository = 1 ORDER BY sort_order').all(projectId) as Array<{ id: string; name: string; path: string }>
    const hosts = new Map<string, GitAccountsState['hosts'][number]>()
    for (const source of await Promise.all(sources.map(async (item) => ({ ...item, remote: await this.remoteOf(item.path) })))) {
      if (!source.remote) continue
      const host = source.remote.host
      let group = hosts.get(host)
      if (!group) { group = { host, provider: guessProvider(host), project: null, repos: [] }; hosts.set(host, group) }
      const own = vault[repoKey(source.id, host)], shared = vault[projectKey(projectId, host)]
      group.repos.push({ sourceId: source.id, name: source.name, own: own ? this.info(own, 'repo') : null, using: own ? 'repo' : shared ? 'project' : null })
    }
    for (const group of hosts.values()) { const entry = vault[projectKey(projectId, group.host)]; group.project = entry ? this.info(entry, 'project') : null; if (entry) group.provider = entry.provider }
    return { hosts: [...hosts.values()] }
  }

  async set(input: { projectId: string; sourceId?: string; provider: HostProvider; host: string; token: string }): Promise<GitAccountsState> {
    const token = input.token.trim(), host = input.host.trim().toLowerCase()
    if (!token) throw new Error(tm().gitAccounts.emptyToken)
    if (input.sourceId && this.source(input.sourceId).projectId !== input.projectId) throw new Error(tm().common.repoNotFoundInProject)
    let user
    try { user = await new HostApi({ provider: input.provider, host, token }, this.fetcher).user() } catch (error) {
      if (error instanceof HostAuthError) throw new Error(tm().gitAccounts.tokenRejected(host))
      throw new Error(tm().gitAccounts.cannotReach(host, (error as Error).message))
    }
    const vault = { ...(await this.vault()) }
    vault[input.sourceId ? repoKey(input.sourceId, host) : projectKey(input.projectId, host)] = { token, provider: input.provider, host, login: user.login, name: user.name, email: user.email, invalid: false, savedAt: new Date().toISOString() }
    await this.save(vault)
    return this.state(input.projectId)
  }

  async remove(input: { projectId: string; sourceId?: string; host: string }): Promise<GitAccountsState> {
    const vault = { ...(await this.vault()) }, key = input.sourceId ? repoKey(input.sourceId, input.host) : projectKey(input.projectId, input.host)
    if (vault[key]) { delete vault[key]; await this.save(vault) }
    return this.state(input.projectId)
  }

  /** Token that applies to this repository: its own, otherwise the project's on the same server. */
  async lookup(sourceId: string): Promise<AccessLookup> {
    const source = this.source(sourceId), remote = await this.remoteOf(source.path)
    if (!remote) return { status: 'none', remote: null }
    const vault = await this.vault()
    for (const key of [repoKey(sourceId, remote.host), projectKey(source.projectId, remote.host)]) {
      const entry = vault[key]
      if (!entry) continue
      if (entry.invalid) return { status: 'invalid', remote, key }
      return { status: 'ok', remote, key, access: { provider: entry.provider, host: entry.host, token: entry.token }, login: entry.login }
    }
    return { status: 'none', remote }
  }

  /** The provider rejected the token (revoked or expired): it stays flagged until the person provides another. */
  async markInvalid(key: string): Promise<void> {
    const vault = await this.vault()
    if (!vault[key] || vault[key]!.invalid) return
    await this.save({ ...vault, [key]: { ...vault[key]!, invalid: true } })
  }
}
