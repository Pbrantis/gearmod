import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { AppDatabase } from '../database'
import { DbAudit, historySql, redactSql, retainHistory, type QueryAudit } from './audit'
it('redige literais, comentários, dollar quotes e SQL malformado', () => {
  const sql = `SELECT 'senha''privada', $$token123$$, 918273, "ident-secreto" /* segredo */ -- credencial\n FROM users WHERE x='incompleto`
  const result = redactSql(sql)
  for (const value of ['senha', 'privada', 'token123', '918273', 'ident-secreto', 'segredo', 'credencial', 'incompleto']) expect(result).not.toContain(value)
  expect(result).toContain('SELECT'); expect(result).toContain('FROM users')
  expect(redactSql('ALTER ROLE a PASSWORD sk-unquoted-secret')).not.toContain('sk-unquoted-secret')
  expect(redactSql("SELECT E'abc\\'private-value', $tag$other-secret$tag$ /* nested /* hidden */ still-hidden */")).not.toMatch(/private-value|other-secret|hidden/)
})
it('mantém apenas hash e resumo sem valores e não apaga a auditoria ao limpar histórico', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-dbaudit-')), id = randomUUID(), db = new AppDatabase(join(root, 'db.sqlite'), '0.1')
  await db.open()
  try {
    const audit = new DbAudit(db, join(root, 'history'))
    audit.record(id, 'sql', "ALTER USER x PASSWORD 'my-secret-password'", Date.now(), 0, 'ok')
    const list = await audit.list(id)
    expect(list).toMatchObject([{ summary: 'ALTER', status: 'ok' }])
    expect(await readFile(join(root, 'history', `${id}.jsonl`), 'utf8')).not.toContain('my-secret-password')
    expect(JSON.stringify(db.db.prepare('SELECT * FROM db_query_audit').all())).not.toContain('my-secret-password')
    await audit.clear(id)
    expect(await audit.list(id)).toEqual([])
    expect(db.db.prepare('SELECT count(*) FROM db_query_audit').pluck().get()).toBe(1)
  } finally { db.close(); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

it('guarda o SQL completo no histórico, ocultando só o valor de PASSWORD/SECRET/TOKEN', () => {
  expect(historySql("SELECT * FROM users WHERE email = 'a@b.com' AND id = 42 -- nota")).toBe("SELECT * FROM users WHERE email = 'a@b.com' AND id = 42 -- nota")
  const hidden = historySql("ALTER USER x PASSWORD 'my-secret-password'; ALTER ROLE y PASSWORD sk-unquoted")
  expect(hidden).not.toMatch(/my-secret-password|sk-unquoted/)
  expect(hidden).toContain('ALTER USER x PASSWORD')
  // Aspas dobradas (texto dentro de outro texto, como num DO): nada do segredo pode sobrar.
  expect(historySql("EXECUTE 'ALTER USER x PASSWORD ''segredo1'''")).not.toContain('segredo1')
})
it('comandos de escrita não guardam os valores no histórico (S7)', () => {
  const insert = historySql("INSERT INTO clientes(nome, email) VALUES ('Maria Silva', 'maria@x.com')")
  expect(insert).not.toMatch(/Maria|maria@x/); expect(insert).toContain('INSERT INTO clientes')
  expect(historySql("UPDATE clientes SET cpf = '123.456.789-00' WHERE id = 7")).not.toMatch(/123\.456|7/)
  expect(historySql("WITH x AS (DELETE FROM t WHERE a = 'segredo' RETURNING *) SELECT * FROM x")).not.toContain('segredo')
})
it('o histórico guarda só SQL, as últimas 200 e as dos últimos 30 dias', () => {
  const now = Date.parse('2026-10-30T12:00:00Z'), at = (days: number): string => new Date(now - days * 86_400_000).toISOString()
  const entry = (n: number, days: number, kind: QueryAudit['kind'] = 'sql'): QueryAudit => ({ id: String(n), at: at(days), kind, sqlHash: '', durationMs: 1, rows: 0, status: 'ok', summary: 'SELECT', sql: 'SELECT 1' })
  expect(retainHistory([entry(1, 31), entry(2, 29), entry(3, 1, 'table-page'), entry(4, 0)], now).map((item) => item.id)).toEqual(['2', '4'])
  expect(retainHistory(Array.from({ length: 250 }, (_, i) => entry(i, 1)), now)).toHaveLength(200)
})
