import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { GitManager } from './git-manager'
import { GitService, ProjectRepository } from './projects'

const exec = promisify(execFile), roots: string[] = [], opened: AppDatabase[] = []
afterEach(async () => { opened.splice(0).forEach((item) => item.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })

async function folderWithoutGit(): Promise<{ folder: string; manager: GitManager; projectId: string; sourceId: string; database: AppDatabase }> {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-gitsetup-')); roots.push(root)
  const folder = join(root, 'projeto'); await mkdir(folder); await writeFile(join(folder, 'notas.txt'), 'não apague\n')
  const database = new AppDatabase(join(root, 'data', 'db.sqlite'), '0.1.0'); await database.open(); opened.push(database)
  const project = await new ProjectRepository(database, new GitService()).create({ localPath: folder })
  const source = database.db.prepare('SELECT id FROM project_sources WHERE project_id = ?').get(project.id) as { id: string }
  return { folder, manager: new GitManager(database), projectId: project.id, sourceId: source.id, database }
}

describe('Git do projeto sem repositório', () => {
  it('mostra a pasta como destino e inicia o Git do zero sem mexer nos arquivos', async () => {
    const { folder, manager, projectId, sourceId } = await folderWithoutGit()
    expect((await manager.detect(projectId)).repos).toEqual([])
    expect(manager.setupTargets(projectId).map((item) => item.sourceId)).toEqual([sourceId])
    const repos = await manager.setup({ projectId, sourceId, mode: 'init' })
    expect(repos).toHaveLength(1); expect(repos[0]).toMatchObject({ sourceId, hasRemote: false })
    expect(await readFile(join(folder, 'notas.txt'), 'utf8')).toBe('não apague\n')
    expect(manager.setupTargets(projectId)).toEqual([])
  })
  it('vincula a origin por SSH ou HTTPS, cria o repositório se faltar e recusa endereços inválidos', async () => {
    const { folder, manager, projectId, sourceId } = await folderWithoutGit()
    await expect(manager.setup({ projectId, sourceId, mode: 'origin', url: 'isso não é endereço' })).rejects.toThrow(/SSH/)
    await expect(manager.setup({ projectId, sourceId, mode: 'origin', url: '--upload-pack=x' })).rejects.toThrow(/SSH/)
    const repos = await manager.setup({ projectId, sourceId, mode: 'origin', url: 'git@github.com:acme/app.git' })
    expect(repos[0]).toMatchObject({ hasRemote: true })
    expect((await exec('git', ['-C', folder, 'remote', 'get-url', 'origin'])).stdout.trim()).toBe('git@github.com:acme/app.git')
    await manager.setup({ projectId, sourceId, mode: 'origin', url: 'https://github.com/acme/app.git' })
    expect((await exec('git', ['-C', folder, 'remote', 'get-url', 'origin'])).stdout.trim()).toBe('https://github.com/acme/app.git')
  })
  it('descobre sozinho um repositório criado por fora depois do cadastro', async () => {
    const { folder, manager, projectId } = await folderWithoutGit()
    expect((await manager.detect(projectId)).changed).toBe(false)
    await exec('git', ['init', '-b', 'main', folder])
    const found = await manager.detect(projectId)
    expect(found.changed).toBe(true); expect(found.repos).toHaveLength(1); expect(found.repos[0]!.head).toBe('main')
    expect((await manager.detect(projectId)).changed).toBe(false)
  })
})
