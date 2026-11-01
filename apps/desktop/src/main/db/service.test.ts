import { expect, it, vi } from 'vitest'
import { DbService } from './service'
import type { DbConnections } from './connections'
import type { ConnectionManager } from './connection-manager'
it('resolve tabela e colunas pelo catálogo antes de gerar consulta parametrizada', async () => {
  const read = vi.fn(async (_id: string, sql: string, _values: unknown[]) => sql.includes('pg_catalog.pg_attribute')
    ? { rows: [['public', 'select', 'r', '1', 'id', 'integer', 'N', 'int4', 'b', 'true'], ['public', 'select', 'r', '2', 'name', 'text', 'S', 'text', 'b', 'false']], columns: [], truncated: false, durationMs: 0 }
    : { rows: [['1', 'valor']], columns: ['id', 'name'], truncated: false, durationMs: 1 })
  const manager = { open: async () => ({ read }) } as unknown as ConnectionManager
  const service = new DbService({} as DbConnections, manager)
  const result = await service.page('c', { oid: 55, requestId: 'q', conditions: [{ column: 2, operator: 'eq', value: "' OR 1=1 --" }], order: [], limit: 20, offset: 0 })
  expect(result.rows).toEqual([[{ t: '1' }, { t: 'valor' }]])
  expect(read.mock.calls[0]?.[2]).toEqual([55])
  expect(read.mock.calls[1]?.[1]).toContain('FROM "public"."select"')
  expect(read.mock.calls[1]?.[1]).not.toContain("' OR 1=1 --")
  expect(read.mock.calls[1]?.[2]).toEqual(["' OR 1=1 --", 21, 0])
  await expect(service.page('c', { oid: 55, requestId: 'q2', conditions: [{ column: 999, operator: 'eq', value: 'x' }], order: [], limit: 20, offset: 0 })).rejects.toThrow('Coluna')
})

it('seleciona modo da conexão e não expõe mensagens SQL com dados sensíveis', async () => {
  const read = vi.fn(async () => ({ columns: ['x'], rows: [['ok']], truncated: false, durationMs: 1 }))
  const write = vi.fn(async () => ({ columns: [], rows: [], truncated: false, durationMs: 1, commands: [{ command: 'UPDATE', rowCount: 1 }] }))
  let writable = false
  const connections = { get: () => ({ allowWrite: writable }) } as unknown as DbConnections
  const manager = { open: async () => ({ read, write }) } as unknown as ConnectionManager
  const service = new DbService(connections, manager)
  expect((await service.query('c', { requestId: 'a', sql: 'SELECT 1', limit: 10 })).rows).toEqual([[{ t: 'ok' }]])
  expect(write).not.toHaveBeenCalled()
  writable = true
  expect((await service.query('c', { requestId: 'b', sql: 'UPDATE t SET x=1 WHERE id=1', limit: 10 })).commands).toEqual([{ command: 'UPDATE', rowCount: 1 }])
  read.mockRejectedValueOnce(Object.assign(new Error('secret-password'), { code: '42601' }))
  writable = false
  await expect(service.query('c', { requestId: 'c', sql: 'x', limit: 10 })).rejects.toThrow('SQLSTATE 42601')
})

it('com escrita liberada, comando destrutivo só roda com o nome do banco como confirmação, em qualquer ambiente (D9)', async () => {
  const write = vi.fn(async () => ({ columns: [], rows: [], truncated: false, durationMs: 1, commands: [{ command: 'DROP TABLE', rowCount: null }] }))
  let config = { allowWrite: true, klass: 'dev', database: 'app' }
  const connections = { get: () => config } as unknown as DbConnections
  const service = new DbService(connections, { open: async () => ({ write }) } as unknown as ConnectionManager)
  await expect(service.query('c', { requestId: 'a', sql: 'DROP TABLE t', limit: 10 })).rejects.toThrow(/destrutivo|destructive/)
  expect(write).not.toHaveBeenCalled()
  await expect(service.query('c', { requestId: 'b0', sql: 'DROP TABLE t', limit: 10, confirmDestructive: 'yes' })).rejects.toThrow(/destrutivo|destructive/)
  await service.query('c', { requestId: 'b', sql: 'DROP TABLE t', limit: 10, confirmDestructive: 'app' })
  expect(write).toHaveBeenCalledTimes(1)
  config = { allowWrite: true, klass: 'prod', database: 'app' }
  await expect(service.query('c', { requestId: 'c', sql: 'TRUNCATE t', limit: 10, confirmDestructive: 'yes' })).rejects.toThrow(/destrutivo|destructive/)
  await service.query('c', { requestId: 'd', sql: 'TRUNCATE t', limit: 10, confirmDestructive: 'app' })
  expect(write).toHaveBeenCalledTimes(2)
})
