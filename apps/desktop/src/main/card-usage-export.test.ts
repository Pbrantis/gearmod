import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { BoardRepository, GitService, ProjectRepository } from './projects'
import { CardHistoryService } from './history'
import { WorktreeService } from './worktrees'
import { SddResolver } from './sdd/sdd-resolver'
import { SddWriter } from './sdd/sdd-writer'
import { CardUsageExport } from './card-usage-export'
const exec = promisify(execFile), roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
it('exporta somente quando habilitado e apenas na worktree do repositório SDD separado', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-usage-export-')); roots.push(root)
  const code = join(root, 'code'), docs = join(root, 'docs'), data = join(root, 'data')
  for (const repo of [code, docs]) {
    await exec('git', ['init', '-b', 'main', repo]); await exec('git', ['-C', repo, 'config', 'user.email', 't@example.invalid']); await exec('git', ['-C', repo, 'config', 'user.name', 'Test'])
    await writeFile(join(repo, 'README.md'), 'original'); await exec('git', ['-C', repo, 'add', '.']); await exec('git', ['-C', repo, 'commit', '-m', 'init'])
  }
  const database = new AppDatabase(join(data, 'db.sqlite'), '0.1.0'); await database.open()
  try {
    const projects = new ProjectRepository(database, new GitService()), project = await projects.create({ sourcePaths: [code, docs] })
    const board = new BoardRepository(database, projects), card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[0]!.id, title: 'Teste', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const history = new CardHistoryService(database, data), worktrees = new WorktreeService(database, data), resolver = new SddResolver(history, board, projects, worktrees), writer = new SddWriter(worktrees)
    const service = new CardUsageExport(database, board, history, resolver, worktrees, writer), docsSource = project.sources.find((s) => s.name === 'docs')!
    await service.export(card.id)
    expect(worktrees.repositories(card.id)).toHaveLength(0)
    const config = history.config(project.id)
    history.setConfig(project.id, { ...config, exportUsage: true, sdd: { ...config.sdd, sourceId: docsSource.id } })
    const insert = database.db.prepare("INSERT INTO usage_ledger(id,at,run_id,seq,source,provider,profile_id,model_configured,model_effective,card_id,input_tokens,output_tokens,cost_kind,cost_usd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    insert.run('delta', new Date().toISOString(), 'run-1', 0, 'run', 'codex', 'profile', 'configurado', null, card.id, 10, 4, 'unknown', null)
    insert.run('final', new Date().toISOString(), 'run-1', 2147483647, 'run', 'codex', 'profile', 'configurado', 'efetivo', card.id, 0, 0, 'billed', 0.1)
    await Promise.all([service.export(card.id), service.export(card.id)])
    const member = worktrees.repositories(card.id).find((m) => m.repoPath.toLowerCase() === docsSource.localPath.toLowerCase())!
    const relative = join('specs', `card-${card.id}`, 'usage.json'), file = join(member.path, relative)
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ cardId: card.id, runs: [{ runId: 'run-1', model: 'efetivo', inputTokens: 10, outputTokens: 4, costKinds: ['unknown', 'billed'], costs: { billed: 0.1 } }] })
    expect(existsSync(join(docs, relative))).toBe(false)
    expect(await readFile(join(docs, 'README.md'), 'utf8')).toBe('original')
  } finally { database.close() }
}, 30_000)
