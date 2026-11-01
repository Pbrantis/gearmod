import { expect, it } from 'vitest'
import { PgDriver } from './pg-driver'
import type { DbConnection } from './connections'
it('recusa agente antes de tentar abrir conexão na V1a', async () => {
  const config: DbConnection = { id: 'x', projectId: 'p', name: 'x', klass: 'dev', host: 'localhost', port: 1, database: 'test', user: 'user', sslMode: 'disable', hasSecret: false, allowWrite: false, agentAccess: 'read', origin: 'manual', envId: null }
  await expect(new PgDriver().open(config, null, { type: 'agent', cardId: 'card' })).rejects.toThrow('agente')
})
it.skipIf(!process.env.AGENTBOARD_PG_TEST_URL)('executa leitura limitada e recusa múltiplas instruções e escrita', async () => {
  const url = new URL(process.env.AGENTBOARD_PG_TEST_URL!)
  const config: DbConnection = { id: 'x', projectId: 'p', name: 'test', klass: 'test', host: url.hostname, port: Number(url.port || 5432), database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username), sslMode: 'disable', hasSecret: true, allowWrite: false, agentAccess: 'none', origin: 'manual', envId: null }
  const session = await new PgDriver().open(config, decodeURIComponent(url.password), { type: 'user' })
  try {
    expect(await session.read('one', 'SELECT i::text AS n FROM generate_series(1, 3) i', [], 2)).toMatchObject({ columns: ['n'], rows: [['1'], ['2']], truncated: true })
    await expect(session.read('two', 'SELECT 1; SELECT 2')).rejects.toThrow()
    await expect(session.read('three', 'CREATE TEMP TABLE should_not_exist(x int)')).rejects.toThrow()
  } finally { await session.close() }
}, 30_000)
it.skipIf(!process.env.AGENTBOARD_PG_TEST_URL)('SQL de escrita liberada suporta duas instruções e preserva o último resultado', async () => {
  const url = new URL(process.env.AGENTBOARD_PG_TEST_URL!)
  const config: DbConnection = { id: 'x', projectId: 'p', name: 'test', klass: 'test', host: url.hostname, port: Number(url.port || 5432), database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username), sslMode: 'disable', hasSecret: true, allowWrite: true, agentAccess: 'none', origin: 'manual', envId: null }
  const session = await new PgDriver().open(config, decodeURIComponent(url.password), { type: 'user' })
  try {
    const result = await session.write('multi', "SELECT 'primeiro' AS value; SELECT 'segundo' AS value")
    expect(result.commands.map((command) => command.command)).toEqual(['SELECT', 'SELECT'])
    expect(result.rows).toEqual([['segundo']]); expect(result.columns).toEqual(['value'])
  } finally { await session.close() }
}, 30_000)
