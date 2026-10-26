import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultWorkflowConfig } from '@agentboard/contracts'
import type { AgentAdapter } from './adapters'
import { ConversationRepository } from './conversations'
import { AppDatabase } from './database'
import { GitManager, type CliRunner } from './git-manager'
import { HarnessService, outOfScope, repeatedFailure } from './harness'
import { CardHistoryService } from './history'
import { AgentOrchestrator } from './orchestrator'
import { PlaywrightCliService, type CommandRunner } from './playwright-cli'
import { BoardRepository, GitService, ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'
import { WorktreeService } from './worktrees'

const exec = promisify(execFile), roots: string[] = [], closers: Array<() => void> = []
afterEach(async () => { closers.splice(0).forEach((close) => close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })

async function repo(path: string): Promise<void> {
  await exec('git', ['init', '-b', 'main', path]); await exec('git', ['-C', path, 'config', 'user.email', 'test@example.invalid']); await exec('git', ['-C', path, 'config', 'user.name', 'AgentBoard Test'])
  await writeFile(join(path, 'README.md'), '# fixture'); await exec('git', ['-C', path, 'add', 'README.md']); await exec('git', ['-C', path, 'commit', '-m', 'fixture'])
}

/** Workspace com docs, frontend e backend (cenários E e H). */
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-coord-')); roots.push(root)
  const ws = join(root, 'ws'), data = join(root, 'data'); await mkdir(ws)
  for (const name of ['backend', 'docs', 'frontend']) await repo(join(ws, name))
  const database = new AppDatabase(join(data, 'db.sqlite'), '0.1.0'); await database.open(); closers.push(() => database.close())
  const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
  const projects = new ProjectRepository(database, new GitService()), project = await projects.create({ localPath: ws, profileIds: profiles.list().map((profile) => profile.id) })
  const board = new BoardRepository(database, projects), column = board.get(project.id).columns[2]!
  const card = board.create({ projectId: project.id, columnId: column.id, title: 'Push', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
  const sources = Object.fromEntries(board.get(project.id).project.sources.map((source) => [source.name, source]))
  return { root, ws, data, database, profiles, projects, board, project, card, sources, worktrees: new WorktreeService(database, data) }
}

describe('Worktrees coordenados', () => {
  it('cria worktree só nos repositórios do card e acrescenta um repositório novo na mesma worktree', async () => {
    const { board, card, sources, worktrees } = await workspace()
    board.setRepos(card.id, [sources.frontend!.id, sources.backend!.id])
    const first = await worktrees.prepare(card.id)
    expect(worktrees.repositories(card.id).map((repo) => [repo.repoPath.split(/[\\/]/).pop(), repo.status]).sort()).toEqual([['backend', 'active'], ['frontend', 'active']])
    board.setRepos(card.id, [sources.frontend!.id, sources.backend!.id, sources.docs!.id])
    const again = await worktrees.prepare(card.id)
    expect(again.id).toBe(first.id)
    expect(worktrees.repositories(card.id)).toHaveLength(3)
    expect(() => board.setRepos(card.id, ['00000000-0000-4000-8000-000000000009'])).toThrow(/não pertence/)
    expect(board.setRepos(card.id, null).repoIds).toBeNull()
  })

  it('falha num repositório não derruba os outros, bloqueia Done e é refeita na próxima preparação', async () => {
    const { board, card, sources, worktrees, database } = await workspace()
    database.db.prepare("UPDATE project_sources SET current_branch = 'nao-existe' WHERE id = ?").run(sources.backend!.id)
    const worktree = await worktrees.prepare(card.id)
    const repos = worktrees.repositories(card.id), backend = repos.find((repo) => repo.repoPath.endsWith('backend'))!
    expect(backend.status).toBe('failed'); expect(backend.error).toContain('backend')
    expect(repos.filter((repo) => repo.status === 'active')).toHaveLength(2)
    const done = board.get(card.projectId).columns.find((column) => column.semanticState === 'done')!
    database.db.prepare("INSERT INTO test_runs(id, card_id, command, status, summary, started_at) VALUES ('t1', ?, 'npm test', 'passed', '', ?)").run(card.id, new Date().toISOString())
    database.db.prepare("INSERT INTO reviews(id, card_id, provider, state, target_branch, source_branch, updated_at) VALUES ('r1', ?, 'local', 'approved', 'main', 'x', ?)").run(card.id, new Date().toISOString())
    expect(() => board.move(card.id, done.id, null)).toThrow(/falhou: backend/)
    database.db.prepare("UPDATE project_sources SET current_branch = 'main' WHERE id = ?").run(sources.backend!.id)
    expect((await worktrees.prepare(card.id)).id).toBe(worktree.id)
    expect(worktrees.repositories(card.id).every((repo) => repo.status === 'active')).toBe(true)
    expect(board.move(card.id, done.id, null).columnId).toBe(done.id)
  })

  it('abre um PR por repositório com commits e diz o que faltou nos outros', async () => {
    const { root, board, card, sources, worktrees, database } = await workspace()
    board.setRepos(card.id, [sources.frontend!.id, sources.backend!.id])
    await worktrees.prepare(card.id)
    const remote = join(root, 'remote-front.git'); await exec('git', ['init', '--bare', remote])
    const front = worktrees.repositories(card.id).find((repo) => repo.repoPath.endsWith('frontend'))!
    await exec('git', ['-C', front.repoPath, 'remote', 'add', 'origin', remote])
    await writeFile(join(front.path, 'push.ts'), 'export {}'); await exec('git', ['-C', front.path, 'add', '.']); await exec('git', ['-C', front.path, 'commit', '-m', 'Push'])
    const calls: Array<{ command: string; args: string[] }> = []
    const cli: CliRunner = { run: async (command, args) => { calls.push({ command, args }); return 'https://github.com/acme/frontend/pull/7\n' } }
    const git = new GitManager(database, undefined, cli)
    const { results } = await git.createPullRequests(card.id, { draft: true })
    expect(results.find((item) => item.repo === 'frontend')).toEqual({ repo: 'frontend', url: 'https://github.com/acme/frontend/pull/7', error: null })
    expect(results.find((item) => item.repo === 'backend')?.error).toMatch(/sem commits/)
    expect(calls[0]!.command).toBe('gh'); expect(calls[0]!.args).toContain('--draft')
    expect((await exec('git', ['--git-dir', remote, 'branch', '--list'])).stdout).toContain('agentboard/push-')
    const view = await git.card(card.id)
    expect(view.repos.find((repo) => repo.name === 'frontend')?.prUrl).toBe('https://github.com/acme/frontend/pull/7')
    expect(view.delivery.complete).toBe(true)
    expect(git.prUrlOf(card.id, 'https://github.com/acme/frontend/pull/7')).toContain('/pull/7')
    expect(() => git.prUrlOf(card.id, 'https://evil.example/x')).toThrow(/desconhecido/)
    await writeFile(join(front.path, 'solto.ts'), 'x')
    expect((await git.card(card.id)).delivery.pending[0]).toMatch(/frontend: 1 alteração/)
  })
})

describe('Harness', () => {
  it('aponta arquivos fora das áreas do Plano e ignora lock/build', () => {
    const plan = 'Áreas afetadas: `src/push/` e `src/app.ts`. Testes em tests/push.test.ts'
    expect(outOfScope(plan, ['src/push/fcm.ts', 'src/app.ts', 'src/billing/x.ts', 'package-lock.json', 'tests/push.test.ts'])).toEqual(['src/billing/x.ts'])
    expect(outOfScope('Plano sem caminhos', ['qualquer.ts'])).toEqual([])
    expect(outOfScope('Mexe em `api/routes/`', ['backend/api/routes/a.ts', 'frontend/src/b.ts'], ['backend', 'frontend'])).toEqual(['frontend/src/b.ts'])
  })

  it('para por orçamento e por falhas repetidas só nas retomadas automáticas', async () => {
    const { database, board, card, project, data, worktrees, profiles } = await workspace()
    const history = new CardHistoryService(database, data), harness = new HarnessService(database, history, worktrees)
    history.setConfig(project.id, { ...defaultWorkflowConfig, harness: { timeoutMinutes: 30, maxTokens: 5000, maxCostUsd: null, maxAttempts: 2, scopeCheck: true } })
    const conversations = new ConversationRepository(database), chat = conversations.createChat({ projectId: project.id, cardId: card.id, purpose: 'execution', profileId: profiles.list()[0]!.id })
    for (const reason of ['Claude exited (1): rede caiu 12', 'Claude exited (1): rede caiu 13']) {
      const run = conversations.createRun({ cardId: card.id, chatId: chat.id, profileId: profiles.list()[0]!.id }); conversations.updateRun(run.id, 'failed', reason)
    }
    expect(repeatedFailure(database, chat.id, 2)).toContain('rede caiu')
    expect(harness.before({ cardId: card.id, chatId: chat.id, automatic: false })).toBeNull()
    expect(harness.before({ cardId: card.id, chatId: chat.id, automatic: true })).toMatch(/falharam com o mesmo erro/)
    database.db.prepare('UPDATE runs SET input_tokens = 4000, output_tokens = 1500 WHERE card_id = ?').run(card.id)
    expect(harness.before({ cardId: card.id, chatId: chat.id, automatic: false })).toMatch(/acima do limite/)
    expect(harness.timeoutMs(card.id)).toBe(30 * 60_000)
    expect(board.card(card.id).id).toBe(card.id)
  })

  it('o orquestrador marca a execução que estourou o tempo como falha, não como parada do usuário', async () => {
    const { database, card, profiles } = await workspace()
    const conversations = new ConversationRepository(database), chat = conversations.createChat({ projectId: card.projectId, cardId: card.id, purpose: 'planning', profileId: profiles.list()[0]!.id })
    const slow: AgentAdapter = { run: (options) => new Promise((resolve) => options.signal?.addEventListener('abort', () => resolve({ sessionId: 's', turnId: null, text: '', status: 'interrupted', error: 'Interrompido pelo usuário' }))) } as AgentAdapter
    const orchestrator = new AgentOrchestrator(conversations, { codex: slow, claude: slow }, () => undefined, {} as WorktreeService, 1)
    orchestrator.setHarness({ before: () => null, timeoutMs: () => 50, after: async () => [] })
    const runOf = (id: string) => database.db.prepare('SELECT status, exit_reason AS exitReason FROM runs WHERE id = ?').get(id) as { status: string; exitReason: string | null }
    const run = orchestrator.start({ chatId: chat.id, prompt: 'planeje', planning: true })
    for (let i = 0; i < 100 && runOf(run.id).status !== 'failed'; i += 1) await new Promise((resolve) => setTimeout(resolve, 20))
    expect(runOf(run.id)).toMatchObject({ status: 'failed', exitReason: expect.stringContaining('Tempo limite') })
    orchestrator.setHarness({ before: () => 'Orçamento estourado', timeoutMs: () => null, after: async () => [] })
    expect(() => orchestrator.start({ chatId: chat.id, prompt: 'de novo', planning: true })).toThrow('Orçamento estourado')
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
})

describe('Playwright CLI', () => {
  it('detecta, instala só localmente com os passos certos, não sobrescreve skill e entrega a sessão do card', async () => {
    const { database, ws, project, card, sources, data } = await workspace()
    const history = new CardHistoryService(database, data)
    const front = join(ws, 'frontend'), binPath = join(front, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright-cli.cmd' : 'playwright-cli')
    const calls: string[] = []
    const runner: CommandRunner = { run: async (command, args) => {
      calls.push([command, ...args].join(' '))
      if (command === 'node') return 'v22.1.0'
      if (command === 'where' || command === 'which') throw new Error('not found')
      if (args[0] === 'install' && args[1] === '-D') { mkdirSync(join(front, 'node_modules', '.bin'), { recursive: true }); writeFileSync(binPath, ''); mkdirSync(join(front, 'node_modules', '@playwright', 'cli'), { recursive: true }); writeFileSync(join(front, 'node_modules', '@playwright', 'cli', 'package.json'), '{"version":"0.1.5"}') }
      return 'ok'
    } }
    const service = new PlaywrightCliService(database, history, runner)
    expect((await service.status(project.id)).installs).toEqual([])
    expect(service.forCard(card.id)).toBeNull()
    const noPackage = await service.install({ projectId: project.id, sourceId: sources.frontend!.id, browser: true, skills: ['claude'] })
    expect(noPackage.error).toMatch(/package.json/)
    writeFileSync(join(front, 'package.json'), '{"name":"front"}')
    mkdirSync(join(front, '.claude', 'skills', 'playwright-cli'), { recursive: true })
    const installed = await service.install({ projectId: project.id, sourceId: sources.frontend!.id, browser: true, skills: ['claude'] })
    expect(installed.error).toBeNull()
    expect(installed.installs).toEqual([{ sourceId: sources.frontend!.id, repo: 'frontend', path: expect.stringContaining('playwright-cli'), origin: 'local', version: '0.1.5' }])
    expect(calls.some((call) => call.includes('install -D @playwright/cli@latest'))).toBe(true)
    expect(calls.some((call) => call.endsWith('install-browser'))).toBe(true)
    expect(calls.some((call) => call.includes('--skills'))).toBe(false)
    expect(installed.log).toContain('nada foi sobrescrito')
    expect(calls.some((call) => / -g\b|--global/.test(call))).toBe(false)
    expect(installed.enabled).toBe(true)
    expect(service.forCard(card.id)).toMatchObject({ comando: installed.installs[0]!.path, sessao: `ab-${card.id.slice(0, 8)}` })
    expect(existsSync(binPath)).toBe(true)
  })
})
