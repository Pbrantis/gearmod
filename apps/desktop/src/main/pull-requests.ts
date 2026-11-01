import type { PullRequestDetail, PullRequestList, PullRequestSummary } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import { nativeCli, type CliRunner } from './git-manager'
import { nativeGit, type GitRunner } from './worktrees'
import { tm } from './i18n'

type Provider = 'github' | 'gitlab'
const MAX_DIFF = 300_000
const cliOf = (provider: Provider): string => provider === 'gitlab' ? 'glab' : 'gh'
const cliError = (provider: Provider, error: unknown): string => {
  const cli = cliOf(provider), name = provider === 'gitlab' ? 'GitLab CLI' : 'GitHub CLI'
  const text = [(error as { stderr?: string })?.stderr, error instanceof Error ? error.message : String(error)].filter(Boolean).join('\n')
  if (/ENOENT|not recognized|não é reconhecido/i.test(text)) return tm().pullRequests.installCli(name, cli)
  if (/auth login|not logged in|authentication|401/i.test(text)) return tm().pullRequests.notAuthenticated(name, cli)
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !/^Command failed/i.test(line))?.slice(0, 300) ?? tm().pullRequests.cliFailed(name)
}
const countDiff = (diff: string): { additions: number; deletions: number } => {
  let additions = 0, deletions = 0
  for (const line of diff.split('\n')) { if (line.startsWith('+') && !line.startsWith('+++')) additions++; else if (line.startsWith('-') && !line.startsWith('---')) deletions++ }
  return { additions, deletions }
}
const cutDiff = (diff: string): string => diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n… diff cortado (muito grande); abra o PR no navegador para ver tudo.` : diff

interface RawPr {
  number: number; title: string; url: string; isDraft?: boolean; headRefName: string; baseRefName: string; updatedAt: string; reviewDecision?: string | null
  author?: { login?: string } | null; reviewRequests?: Array<{ login?: string; slug?: string }>; comments?: unknown[]
}
interface RawMr {
  iid: number; title: string; web_url: string; draft?: boolean; work_in_progress?: boolean; source_branch: string; target_branch: string; updated_at: string
  author?: { username?: string } | null; reviewers?: Array<{ username?: string }>; user_notes_count?: number
}

/** Pull requests (GitHub, pelo gh) e merge requests (GitLab, pelo glab) por repositório do projeto. Só roda quando a tela pede; nunca guarda credencial. */
export class PullRequestService {
  private viewers = new Map<Provider, string | null>()
  constructor(private readonly database: AppDatabase, private readonly cli: CliRunner = nativeCli, private readonly git: GitRunner = nativeGit) {}

  private path(sourceId: string): string {
    const row = this.database.db.prepare('SELECT local_path FROM project_sources WHERE id = ?').pluck().get(sourceId) as string | undefined
    if (!row) throw new Error(tm().common.repoNotFoundInProject)
    return row
  }
  private async provider(dir: string): Promise<Provider | null> {
    try {
      const remote = (await this.git.run(['-C', dir, 'remote', 'get-url', 'origin'])).stdout
      return /github\.com/i.test(remote) ? 'github' : /gitlab/i.test(remote) ? 'gitlab' : null
    } catch { return null }
  }
  private async need(dir: string): Promise<Provider> {
    const provider = await this.provider(dir)
    if (!provider) throw new Error(tm().pullRequests.notGithubNorGitlab)
    return provider
  }
  private async exec(provider: Provider, dir: string, args: string[]): Promise<string> {
    try { return await this.cli.run(cliOf(provider), args, dir) } catch (error) { throw new Error(cliError(provider, error)) }
  }
  private async viewer(provider: Provider, dir: string): Promise<string | null> {
    if (this.viewers.get(provider)) return this.viewers.get(provider)!
    let login: string | null = null
    try {
      login = provider === 'github' ? (await this.exec(provider, dir, ['api', 'user', '--jq', '.login'])).trim() || null
        : (JSON.parse(await this.exec(provider, dir, ['api', 'user'])) as { username?: string }).username ?? null
    } catch { /* sem login: nada é "meu" */ }
    if (login) this.viewers.set(provider, login)
    return login
  }

  async list(sourceId: string): Promise<PullRequestList> {
    const dir = this.path(sourceId), provider = await this.provider(dir)
    if (!provider) return { supported: false, provider: null, error: tm().pullRequests.unsupportedRepo, viewer: null, prs: [] }
    try {
      const viewer = await this.viewer(provider, dir)
      let prs: PullRequestSummary[]
      if (provider === 'github') {
        const raw = JSON.parse(await this.exec(provider, dir, ['pr', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,url,isDraft,headRefName,baseRefName,updatedAt,reviewDecision,author,reviewRequests,comments'])) as RawPr[]
        prs = raw.map((pr) => ({
          number: pr.number, title: pr.title, url: pr.url, draft: Boolean(pr.isDraft), head: pr.headRefName, base: pr.baseRefName, updatedAt: pr.updatedAt,
          reviewDecision: pr.reviewDecision || null, author: pr.author?.login ?? '', comments: pr.comments?.length ?? 0,
          reviewRequested: Boolean(viewer && pr.reviewRequests?.some((item) => item.login === viewer))
        }))
      } else {
        const raw = JSON.parse(await this.exec(provider, dir, ['mr', 'list', '-F', 'json', '--per-page', '50'])) as RawMr[]
        prs = raw.map((mr) => ({
          number: mr.iid, title: mr.title, url: mr.web_url, draft: Boolean(mr.draft ?? mr.work_in_progress), head: mr.source_branch, base: mr.target_branch, updatedAt: mr.updated_at,
          reviewDecision: null, author: mr.author?.username ?? '', comments: mr.user_notes_count ?? 0,
          reviewRequested: Boolean(viewer && mr.reviewers?.some((item) => item.username === viewer))
        }))
      }
      return { supported: true, provider, error: null, viewer, prs }
    } catch (error) { return { supported: true, provider, error: error instanceof SyntaxError ? `Resposta inesperada do ${cliOf(provider)}.` : (error as Error).message, viewer: null, prs: [] } }
  }

  async view(sourceId: string, number: number): Promise<PullRequestDetail> {
    const dir = this.path(sourceId), provider = await this.need(dir)
    if (provider === 'gitlab') return this.viewMr(dir, number)
    const raw = JSON.parse(await this.exec(provider, dir, ['pr', 'view', String(number), '--json', 'number,title,body,url,state,isDraft,headRefName,baseRefName,reviewDecision,author,comments,reviews,files,additions,deletions,mergeable'])) as {
      number: number; title: string; body: string; url: string; state: string; isDraft: boolean; headRefName: string; baseRefName: string; reviewDecision?: string | null; mergeable?: string
      author?: { login?: string }; additions: number; deletions: number; files?: Array<{ path: string; additions: number; deletions: number }>
      comments?: Array<{ author?: { login?: string }; body: string; createdAt: string }>; reviews?: Array<{ author?: { login?: string }; body: string; state: string; submittedAt?: string }>
    }
    let diff = ''
    try { diff = await this.exec(provider, dir, ['pr', 'diff', String(number)]) } catch { /* o resto ainda abre */ }
    return {
      number: raw.number, title: raw.title, body: raw.body ?? '', url: raw.url, state: raw.state, draft: raw.isDraft, head: raw.headRefName, base: raw.baseRefName,
      reviewDecision: raw.reviewDecision || null, author: raw.author?.login ?? '', additions: raw.additions, deletions: raw.deletions, mergeable: raw.mergeable ?? null,
      files: (raw.files ?? []).map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions })),
      comments: (raw.comments ?? []).map((item) => ({ author: item.author?.login ?? '', body: item.body, at: item.createdAt })),
      reviews: (raw.reviews ?? []).filter((item) => item.state !== 'PENDING').map((item) => ({ author: item.author?.login ?? '', body: item.body, state: item.state, at: item.submittedAt ?? '' })),
      diff: cutDiff(diff)
    }
  }

  /** Merge request do GitLab pela API do glab (`:id` é o projeto da pasta). */
  private async viewMr(dir: string, number: number): Promise<PullRequestDetail> {
    const api = async <T>(path: string): Promise<T> => JSON.parse(await this.exec('gitlab', dir, ['api', path])) as T
    const base = `projects/:id/merge_requests/${number}`
    const mr = await api<{ iid: number; title: string; description?: string; web_url: string; state: string; draft?: boolean; source_branch: string; target_branch: string; has_conflicts?: boolean; author?: { username?: string } }>(base)
    const [notes, changes, approvals] = await Promise.all([
      api<Array<{ author?: { username?: string }; body: string; created_at: string; system?: boolean }>>(`${base}/notes?per_page=100&sort=asc`).catch(() => []),
      api<{ changes?: Array<{ new_path: string; diff: string }> }>(`${base}/changes`).catch(() => ({ changes: [] })),
      api<{ approved_by?: Array<{ user?: { username?: string } }> }>(`${base}/approvals`).catch(() => ({ approved_by: [] }))
    ])
    const files = (changes.changes ?? []).map((item) => ({ path: item.new_path, ...countDiff(item.diff) }))
    const diff = (changes.changes ?? []).map((item) => `diff --git a/${item.new_path} b/${item.new_path}\n${item.diff}`).join('\n')
    const approved = approvals.approved_by ?? []
    return {
      number: mr.iid, title: mr.title, body: mr.description ?? '', url: mr.web_url, state: mr.state.toUpperCase(), draft: Boolean(mr.draft), head: mr.source_branch, base: mr.target_branch,
      reviewDecision: approved.length ? 'APPROVED' : null, author: mr.author?.username ?? '', additions: files.reduce((sum, file) => sum + file.additions, 0), deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      mergeable: mr.has_conflicts ? 'CONFLICTING' : null, files,
      comments: notes.filter((note) => !note.system).map((note) => ({ author: note.author?.username ?? '', body: note.body, at: note.created_at })),
      reviews: approved.map((item) => ({ author: item.user?.username ?? '', body: '', state: 'APPROVED', at: '' })),
      diff: cutDiff(diff)
    }
  }

  async comment(sourceId: string, number: number, body: string): Promise<void> {
    const dir = this.path(sourceId), provider = await this.need(dir)
    await this.exec(provider, dir, provider === 'gitlab' ? ['mr', 'note', String(number), '-m', body] : ['pr', 'comment', String(number), '--body', body])
  }

  async review(sourceId: string, number: number, action: 'approve' | 'request-changes' | 'comment', body: string): Promise<void> {
    const dir = this.path(sourceId), provider = await this.need(dir)
    if (provider === 'gitlab') {
      if (action === 'request-changes') throw new Error(tm().pullRequests.gitlabNoRequestChanges)
      if (action === 'comment') { await this.comment(sourceId, number, body); return }
      if (body.trim()) await this.exec(provider, dir, ['mr', 'note', String(number), '-m', body])
      await this.exec(provider, dir, ['mr', 'approve', String(number)])
      return
    }
    if (action !== 'approve' && !body.trim()) throw new Error(tm().pullRequests.writeReviewComment)
    await this.exec(provider, dir, ['pr', 'review', String(number), `--${action}`, ...(body.trim() ? ['--body', body] : [])])
  }

  /** Publica a branch e abre o PR/MR. O título e o corpo vêm da tela; nada é enviado sem o usuário pedir. */
  async create(sourceId: string, input: { head: string; base: string; title: string; body: string; draft: boolean }): Promise<{ url: string }> {
    const dir = this.path(sourceId), provider = await this.need(dir)
    try { await this.git.run(['-C', dir, 'push', '-u', 'origin', input.head]) } catch (error) { throw new Error(tm().pullRequests.couldNotPublishBranch(cliError(provider, error))) }
    const output = await this.exec(provider, dir, provider === 'gitlab'
      ? ['mr', 'create', '--source-branch', input.head, '--target-branch', input.base, '--title', input.title, '--description', input.body, '--yes', ...(input.draft ? ['--draft'] : [])]
      : ['pr', 'create', '--head', input.head, '--base', input.base, '--title', input.title, '--body', input.body, ...(input.draft ? ['--draft'] : [])])
    const url = output.match(/https?:\/\/\S+/g)?.at(-1)
    if (!url) throw new Error(tm().pullRequests.cliNoPrUrl(cliOf(provider)))
    return { url }
  }

  /** Só abre no navegador um endereço de PR que o CLI listou para este repositório. */
  async assertUrl(sourceId: string, url: string): Promise<string> {
    const list = await this.list(sourceId)
    if (!list.prs.some((pr) => pr.url === url)) throw new Error(tm().pullRequests.unknownPrUrlRepo)
    return url
  }
}
