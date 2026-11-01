import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AppDatabase } from '../database'
import { DbConnections, type DbConnectionInput } from './connections'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const secure = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value.split('').reverse().join('')), decryptString: (value: Buffer) => value.toString().split('').reverse().join('') }
it('mantém senha fora do SQLite e exige confirmação para escrita externa', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-db-connections-')); roots.push(root)
  const db = new AppDatabase(join(root, 'db.sqlite'), '0.1'); await db.open()
  try {
    db.db.prepare("INSERT INTO projects(id,name,local_path,base_branch,created_at,updated_at) VALUES ('p','P','x','main','now','now')").run()
    const service = new DbConnections(db, join(root, 'secrets'), secure)
    const config: DbConnectionInput = { projectId: 'p', name: 'Local', klass: 'dev', host: 'localhost', port: 5432, database: 'app', user: 'me', sslMode: 'disable', allowWrite: true, agentAccess: 'read', password: 'secret-password' }
    const saved = await service.save(config)
    expect(saved.hasSecret).toBe(true)
    expect(saved).not.toHaveProperty('password')
    expect(await service.password(saved.id)).toBe('secret-password')
    expect(JSON.stringify(db.db.prepare('SELECT * FROM db_connections').all())).not.toContain('secret-password')
    expect((await readFile(join(root, 'secrets', `${saved.id}.bin`))).toString()).not.toContain('secret-password')
    await expect(service.save({ ...config, id: saved.id, klass: 'prod', agentAccess: 'none', password: undefined })).rejects.toThrow('Confirme')
    const changed = await service.save({ ...config, id: saved.id, klass: 'prod', agentAccess: 'none', confirmWrite: 'Local', password: undefined })
    expect(changed.klass).toBe('prod')
    await service.delete(saved.id); expect(service.list('p')).toEqual([])
  } finally { db.close() }
})
it('permite senha só em memória quando não existe cofre seguro', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-db-session-')); roots.push(root)
  const db = new AppDatabase(join(root, 'db.sqlite'), '0.1'); await db.open()
  try {
    db.db.prepare("INSERT INTO projects(id,name,local_path,base_branch,created_at,updated_at) VALUES ('p','P','x','main','now','now')").run()
    const service = new DbConnections(db, join(root, 'secrets'), { ...secure, isEncryptionAvailable: () => false })
    const config: DbConnectionInput = { projectId: 'p', name: 'Local', klass: 'dev', host: 'localhost', port: 5432, database: 'app', user: 'me', sslMode: 'disable', allowWrite: false, agentAccess: 'none', password: 'pw' }
    await expect(service.save(config)).rejects.toThrow('cofre seguro')
    const saved = await service.save({ ...config, passwordStorage: 'session' })
    expect(await service.password(saved.id)).toBe('pw')
    expect(new DbConnections(db, join(root, 'secrets'), secure).get(saved.id).hasSecret).toBe(false)
  } finally { db.close() }
})
it('banco herda host, usuário e senha do servidor e some junto com ele', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-db-parent-')); roots.push(root)
  const db = new AppDatabase(join(root, 'db.sqlite'), '0.1'); await db.open()
  try {
    db.db.prepare("INSERT INTO projects(id,name,local_path,base_branch,created_at,updated_at) VALUES ('p','P','x','main','now','now')").run()
    const service = new DbConnections(db, join(root, 'secrets'), secure)
    const server = await service.save({ projectId: 'p', name: 'Local', klass: 'dev', host: 'localhost', port: 5432, database: 'postgres', user: 'me', sslMode: 'disable', allowWrite: true, agentAccess: 'none', password: 'pw-1' })
    const child = await service.save({ projectId: 'p', parentId: server.id, name: 'App', klass: 'prod', host: 'outro', port: 1, database: 'app', user: 'x', sslMode: 'require', allowWrite: true, agentAccess: 'none', password: 'ignorada' })
    expect(child).toMatchObject({ parentId: server.id, host: 'localhost', port: 5432, user: 'me', klass: 'dev', sslMode: 'disable', hasSecret: true, database: 'app' })
    expect(await service.password(child.id)).toBe('pw-1')
    await service.save({ projectId: 'p', id: server.id, name: 'Local', klass: 'dev', host: '127.0.0.1', port: 5432, database: 'postgres', user: 'me', sslMode: 'disable', allowWrite: false, agentAccess: 'none', password: 'pw-2' })
    expect(service.get(child.id)).toMatchObject({ host: '127.0.0.1', allowWrite: false })
    expect(await service.password(child.id)).toBe('pw-2')
    await expect(service.save({ projectId: 'p', parentId: child.id, name: 'Neto', klass: 'dev', host: 'h', port: 1, database: 'd', user: 'u', sslMode: 'disable', allowWrite: false, agentAccess: 'none' })).rejects.toThrow('servidor')
    await service.delete(server.id); expect(service.list('p')).toEqual([])
  } finally { db.close() }
})
