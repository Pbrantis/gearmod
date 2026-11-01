import { describe, expect, it } from 'vitest'
import { destructiveStatements } from './sql-danger'

const kinds = (sql: string): string[] => destructiveStatements(sql).map((item) => item.kind)

describe('destructiveStatements', () => {
  it('detecta DROP, TRUNCATE e ALTER ... DROP', () => {
    expect(kinds('DROP TABLE users')).toEqual(['drop'])
    expect(kinds('drop schema app cascade;')).toEqual(['drop'])
    expect(kinds('TRUNCATE users RESTART IDENTITY')).toEqual(['truncate'])
    expect(kinds('ALTER TABLE users DROP COLUMN email')).toEqual(['alter-drop'])
    expect(kinds('alter table users alter column name drop not null')).toEqual(['alter-drop'])
  })

  it('detecta DELETE e UPDATE sem WHERE, inclusive com WHERE só em subconsulta', () => {
    expect(kinds('DELETE FROM users')).toEqual(['delete-all'])
    expect(kinds('UPDATE users SET active = false')).toEqual(['update-all'])
    expect(kinds('UPDATE users SET plan = (SELECT id FROM plans WHERE name = \'free\')')).toEqual(['update-all'])
    expect(kinds('DELETE FROM users WHERE id = 1')).toEqual([])
    expect(kinds('UPDATE users SET active = false WHERE id = 1')).toEqual([])
    expect(kinds('DELETE FROM a USING b WHERE a.id = b.id')).toEqual([])
  })

  it('detecta DELETE/UPDATE sem WHERE dentro de CTE ou como comando principal depois de CTE', () => {
    expect(kinds('WITH gone AS (DELETE FROM users RETURNING id) SELECT count(*) FROM gone')).toEqual(['delete-all'])
    expect(kinds('WITH x AS (SELECT id FROM t WHERE id > 1) DELETE FROM users')).toEqual(['delete-all'])
    expect(kinds('WITH x AS (SELECT 1) DELETE FROM users WHERE id IN (SELECT * FROM x)')).toEqual([])
  })

  it('ignora palavras em comentários, strings e identificadores entre aspas', () => {
    expect(kinds('-- DROP TABLE users\nSELECT 1')).toEqual([])
    expect(kinds('/* TRUNCATE users; /* aninhado */ DELETE FROM x; */ SELECT 1')).toEqual([])
    expect(kinds("SELECT 'DROP TABLE users; DELETE FROM x'")).toEqual([])
    expect(kinds("SELECT E'it\\'s; DROP TABLE x'")).toEqual([])
    expect(kinds('SELECT $body$ DELETE FROM users; $body$')).toEqual([])
    expect(kinds('SELECT "drop" FROM t')).toEqual([])
    expect(kinds("DELETE FROM users -- WHERE id = 1")).toEqual(['delete-all'])
    expect(kinds("DELETE FROM users WHERE note = 'a;b'")).toEqual([])
  })

  it('não confunde cláusulas que usam as mesmas palavras', () => {
    expect(kinds('SELECT * FROM t FOR UPDATE')).toEqual([])
    expect(kinds('INSERT INTO t (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET n = 2')).toEqual([])
    expect(kinds('CREATE TABLE t (id int REFERENCES u(id) ON DELETE CASCADE ON UPDATE CASCADE)')).toEqual([])
    expect(kinds('GRANT DELETE, UPDATE ON t TO app')).toEqual([])
    expect(kinds('SELECT 1; SELECT 2;')).toEqual([])
  })

  it('separa vários comandos e devolve o texto de cada destrutivo', () => {
    const found = destructiveStatements('SELECT 1;\n  DROP TABLE a ;\nDELETE FROM b WHERE id = 2; TRUNCATE c')
    expect(found).toEqual([{ kind: 'drop', sql: 'DROP TABLE a' }, { kind: 'truncate', sql: 'TRUNCATE c' }])
  })
})
