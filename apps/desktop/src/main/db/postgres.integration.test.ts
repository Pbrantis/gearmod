import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { expect, it, vi } from 'vitest'
import { PgDriver } from './pg-driver'
import { ConnectionManager } from './connection-manager'
import { DbService } from './service'
import type { DbConnection, DbConnections } from './connections'
it.skipIf(!process.env.AGENTBOARD_PG_TEST_URL || process.env.AGENTBOARD_PG_TEST_DISPOSABLE !== '1')('navega e filtra por OID, isola leitura e cancela consulta em PostgreSQL descartável', async () => {
  const url = new URL(process.env.AGENTBOARD_PG_TEST_URL!)
  const config: DbConnection = { id: 'test', projectId: 'p', name: 'test', klass: 'test', host: url.hostname, port: Number(url.port || 5432), database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username), sslMode: 'disable', hasSecret: true, allowWrite: true, agentAccess: 'none', origin: 'manual', envId: null }
  const password = decodeURIComponent(url.password), driver = new PgDriver(), admin = await driver.open(config, password, { type: 'user' })
  const schema = `test_${randomUUID().replaceAll('-', '')}`
  const schema2 = `${schema}_alt`
  try {
    await admin.write('setup', `CREATE SCHEMA "${schema}"; CREATE SCHEMA "${schema2}"; CREATE TABLE "${schema}"."Select Odd" ("ID" integer PRIMARY KEY, "nome" text); CREATE TABLE "${schema2}"."Select Odd" ("ID" integer PRIMARY KEY, "nome" text); INSERT INTO "${schema}"."Select Odd" VALUES (1, 'ab%_x'), (2, 'normal'), (3, 'abZZx'); INSERT INTO "${schema2}"."Select Odd" VALUES (99, 'outro'); CREATE TABLE "${schema}".sem_pk (txt text); INSERT INTO "${schema}".sem_pk VALUES (repeat('x', 9000)); CREATE SEQUENCE "${schema}".seq`)
    const reader = await driver.open({ ...config, allowWrite: false }, password, { type: 'user' })
    try {
      expect((await reader.read(randomUUID(), 'SHOW default_transaction_read_only')).rows).toEqual([['on']])
      for (const statement of [`INSERT INTO "${schema}".sem_pk VALUES ('x')`, `UPDATE "${schema}".sem_pk SET txt='x'`, `DELETE FROM "${schema}".sem_pk`, `CREATE TABLE "${schema}".nope(x int)`, `DROP TABLE "${schema}".sem_pk`, `SELECT nextval('${schema}.seq')`]) {
        await expect(reader.read(randomUUID(), statement)).rejects.toMatchObject({ code: '25006' })
      }
      await expect(reader.read(randomUUID(), 'SELECT 1; SELECT 2')).rejects.toMatchObject({ code: '42601' })
      await expect(reader.write(randomUUID(), 'DELETE FROM t')).rejects.toThrow('desativada')
    } finally { await reader.close() }
    const manager = new ConnectionManager({ get: () => config, password: async () => password }, driver)
    const service = new DbService({ get: () => config } as unknown as DbConnections, manager)
    try {
      const namespaces = await service.schemas('test'), namespace = namespaces.find((item) => item.name === schema)!
      const tables = await service.tables('test', namespace.oid), table = tables.find((item) => item.name === 'Select Odd')!
      const meta = await service.describe('test', table.oid), name = meta.columns.find((column) => column.name === 'nome')!, id = meta.columns.find((column) => column.name === 'ID')!
      expect(id.primaryKey).toBe(true)
      const filtered = await service.page('test', { oid: table.oid, requestId: randomUUID(), conditions: [{ column: name.attnum, operator: 'contains', value: '%_' }], order: [], limit: 20, offset: 0 })
      expect(filtered.rows).toEqual([[{ t: '1' }, { t: 'ab%_x' }]])
      const otherNamespace = namespaces.find((item) => item.name === schema2)!, otherTable = (await service.tables('test', otherNamespace.oid)).find((item) => item.name === 'Select Odd')!
      const other = await service.page('test', { oid: otherTable.oid, requestId: randomUUID(), conditions: [], order: [], limit: 20, offset: 0 })
      expect(other.rows).toEqual([[{ t: '99' }, { t: 'outro' }]])
      const counted = await service.count('test', { oid: table.oid, requestId: randomUUID(), conditions: [{ column: name.attnum, operator: 'contains', value: '%_' }], order: [], limit: 20, offset: 0 })
      expect(counted.count).toBe('1')
      const page = await service.page('test', { oid: table.oid, requestId: randomUUID(), conditions: [], order: [{ column: id.attnum, dir: 'desc' }], limit: 2, offset: 0 })
      expect(page.rows.map((row) => row[0]?.t)).toEqual(['3', '2']); expect(page.hasMore).toBe(true)
      const noPk = tables.find((item) => item.name === 'sem_pk')!
      const large = await service.page('test', { oid: noPk.oid, requestId: randomUUID(), conditions: [], order: [], limit: 20, offset: 0 })
      expect(large.orderedBy).toBe('ctid'); expect(large.rows[0]?.[0]).toMatchObject({ big: true }); expect(large.rows[0]?.[0]?.t?.length).toBe(8200)
      const requestId = randomUUID(), query = service.query('test', { requestId, sql: 'SELECT pg_sleep(20)', limit: 10 })
      await new Promise((resolve) => setTimeout(resolve, 250))
      await service.cancel('test', requestId)
      await expect(query).rejects.toThrow(/cancelada|57014/)
      await expect(service.query('test', { requestId: randomUUID(), sql: `SELECT 1; SELECT * FROM "${schema}".nao_existe`, limit: 10 })).rejects.toThrow(/Comandos recebidos antes da falha: SELECT/)
    } finally { await manager.closeAll() }
  } finally { await admin.write('cleanup', `DROP SCHEMA IF EXISTS "${schema}" CASCADE; DROP SCHEMA IF EXISTS "${schema2}" CASCADE`); await admin.close() }
}, 40_000)

it.skipIf(!process.env.AGENTBOARD_PG_TEST_URL || process.env.AGENTBOARD_PG_TEST_DISPOSABLE !== '1')('reconecta após perda real da sessão sem repetir consultas', async () => {
  const url = new URL(process.env.AGENTBOARD_PG_TEST_URL!)
  const config: DbConnection = { id: 'reconnect', projectId: 'p', name: 'test', klass: 'test', host: url.hostname, port: Number(url.port || 5432), database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username), sslMode: 'disable', hasSecret: true, allowWrite: false, agentAccess: 'none', origin: 'manual', envId: null }
  const password = decodeURIComponent(url.password), driver = new PgDriver(), open = vi.spyOn(driver, 'open')
  const manager = new ConnectionManager({ get: () => config, password: async () => password }, driver, 600_000, 100)
  const control = new pg.Client({ host: config.host, port: config.port, database: config.database, user: config.user, password, application_name: 'AgentBoard-reconnect-test' })
  await control.connect()
  try {
    const initial = await manager.open(config.id)
    const terminated = await control.query('SELECT pg_terminate_backend($1) AS terminated', [initial.controlBackendPid])
    expect(terminated.rows[0]?.terminated).toBe(true)
    const limit = Date.now() + 5000
    while (Date.now() < limit && (open.mock.calls.length < 2 || manager.state(config.id) !== 'ready')) await new Promise((resolve) => setTimeout(resolve, 25))
    expect(open).toHaveBeenCalledTimes(2); expect(manager.state(config.id)).toBe('ready')
    expect((await (await manager.open(config.id)).read(randomUUID(), 'SELECT 1::text')).rows).toEqual([['1']])
  } finally { await manager.closeAll(); await control.end() }
}, 15_000)
