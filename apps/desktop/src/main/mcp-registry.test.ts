import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { McpServerInput } from '@gearmod/contracts'
import { AppDatabase } from './database'
import { ProjectRepository, GitService } from './projects'
import { McpRegistry, claudeMcpServers, codexMcpServers, geminiMcpServers, mcpPresets } from './mcp-registry'

const roots: string[] = [], opened: AppDatabase[] = []
afterEach(async () => { opened.splice(0).forEach((item) => item.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const storage = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value, 'utf8'), decryptString: (value: Buffer) => value.toString('utf8') }

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-mcp-')); roots.push(root)
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open(); opened.push(database)
  await mkdir(join(root, 'a')); await mkdir(join(root, 'b'))
  const projects = new ProjectRepository(database, new GitService())
  const one = await projects.create({ localPath: join(root, 'a') }), two = await projects.create({ localPath: join(root, 'b') })
  return { registry: new McpRegistry(database, join(root, 'secrets'), storage), database, root, one: one.id, two: two.id }
}
const stdio = (extra: Partial<McpServerInput> = {}): McpServerInput => ({ scope: 'global', name: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'x'], url: '', env: [{ key: 'TOKEN', value: 'segredo' }], headers: [], providers: ['claude', 'codex'], enabled: true, ...extra })

describe('cadastro de servidores MCP', () => {
  it('traz uma lista pronta com os mais usados', () => {
    expect(mcpPresets.map((item) => item.id)).toEqual(expect.arrayContaining(['filesystem', 'github', 'playwright', 'context7', 'postgres', 'remote']))
  })

  it('guarda segredos fora do SQLite e nunca devolve o valor', async () => {
    const { registry, database, root } = await setup()
    const saved = await registry.save(stdio())
    expect(saved.env).toEqual([{ key: 'TOKEN', set: true }])
    expect(JSON.stringify(database.db.prepare('SELECT * FROM mcp_servers').all())).not.toContain('segredo')
    expect(JSON.stringify(saved)).not.toContain('segredo')
    const run = await registry.effective((database.db.prepare('SELECT id FROM projects').pluck().get() as string), 'claude')
    expect(run[0]).toMatchObject({ transport: 'stdio', env: { TOKEN: 'segredo' } })
    void root
  })

  it('valor vazio na edição mantém o segredo já guardado', async () => {
    const { registry, one } = await setup()
    const saved = await registry.save(stdio())
    await registry.save(stdio({ id: saved.id, env: [{ key: 'TOKEN', value: '' }], args: ['novo'] }))
    expect((await registry.effective(one, 'claude'))[0]).toMatchObject({ args: ['novo'], env: { TOKEN: 'segredo' } })
  })

  it('liga e desliga por agente, por projeto e globalmente', async () => {
    const { registry, one, two } = await setup()
    const saved = await registry.save(stdio({ providers: ['claude'] }))
    expect(await registry.effective(one, 'claude')).toHaveLength(1)
    expect(await registry.effective(one, 'codex')).toHaveLength(0)
    registry.setProjectEnabled(one, saved.id, false)
    expect(await registry.effective(one, 'claude')).toHaveLength(0)
    expect(await registry.effective(two, 'claude')).toHaveLength(1)
    expect((await registry.list(one))[0]!.disabledHere).toBe(true)
    registry.setProjectEnabled(one, saved.id, true)
    await registry.save(stdio({ id: saved.id, providers: ['claude'], enabled: false }))
    expect(await registry.effective(two, 'claude')).toHaveLength(0)
  })

  it('servidor do projeto só vale nele e vence o global de mesmo nome', async () => {
    const { registry, one, two } = await setup()
    await registry.save(stdio({ env: [] }))
    await registry.save(stdio({ scope: 'project', projectId: one, command: 'local', env: [] }))
    expect((await registry.effective(one, 'claude')).map((item) => item.transport === 'stdio' && item.command)).toEqual(['local'])
    expect((await registry.effective(two, 'claude')).map((item) => item.transport === 'stdio' && item.command)).toEqual(['npx'])
    expect((await registry.list(two)).every((item) => item.scope === 'global')).toBe(true)
  })

  it('valida nome, comando, URL e o nome reservado do GearMod', async () => {
    const { registry } = await setup()
    await expect(registry.save(stdio({ name: 'gearmod' }))).rejects.toThrow(/reservado/)
    await expect(registry.save(stdio({ name: 'a b' }))).rejects.toThrow(/Nome inválido/)
    await expect(registry.save(stdio({ command: ' ' }))).rejects.toThrow(/comando/)
    await expect(registry.save(stdio({ transport: 'http', url: 'ftp://x' }))).rejects.toThrow(/URL/)
    await registry.save(stdio())
    await expect(registry.save(stdio())).rejects.toThrow(/Já existe/)
  })

  it('remove o servidor e os desligamentos por projeto', async () => {
    const { registry, one } = await setup()
    const saved = await registry.save(stdio()); registry.setProjectEnabled(one, saved.id, false)
    await registry.remove(saved.id)
    expect(await registry.list(one)).toEqual([])
  })
})

describe('formato de cada agente', () => {
  const servers = [{ name: 'a', transport: 'stdio' as const, command: 'npx', args: ['x'], env: { K: 'v' } }, { name: 'b', transport: 'http' as const, url: 'https://h/mcp', headers: { Authorization: 'Bearer t' } }]
  it('Claude, Codex e Gemini recebem stdio e http no formato de cada um', () => {
    expect(claudeMcpServers(servers).b).toEqual({ type: 'http', url: 'https://h/mcp', headers: { Authorization: 'Bearer t' } })
    expect(codexMcpServers(servers).a).toEqual({ command: 'npx', args: ['x'], env: { K: 'v' } })
    expect(codexMcpServers(servers).b).toEqual({ url: 'https://h/mcp', http_headers: { Authorization: 'Bearer t' } })
    expect(geminiMcpServers(servers).b).toEqual({ httpUrl: 'https://h/mcp', headers: { Authorization: 'Bearer t' } })
  })
})
