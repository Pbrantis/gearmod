import { describe, expect, it } from 'vitest'
import { destructiveStatements } from './sql-danger'

const kinds = (sql: string): string[] => destructiveStatements(sql).map((item) => item.kind)

describe('destructiveStatements', () => {
  it('detects DROP, TRUNCATE and ALTER ... DROP', () => {
    expect(kinds('DROP TABLE users')).toEqual(['drop'])
    expect(kinds('drop schema app cascade;')).toEqual(['drop'])
    expect(kinds('TRUNCATE users RESTART IDENTITY')).toEqual(['truncate'])
    expect(kinds('ALTER TABLE users DROP COLUMN email')).toEqual(['alter-drop'])
    expect(kinds('alter table users alter column name drop not null')).toEqual(['alter-drop'])
  })

  it('detects DELETE and UPDATE without WHERE, including WHERE only in a subquery', () => {
    expect(kinds('DELETE FROM users')).toEqual(['delete-all'])
    expect(kinds('UPDATE users SET active = false')).toEqual(['update-all'])
    expect(kinds('UPDATE users SET plan = (SELECT id FROM plans WHERE name = \'free\')')).toEqual(['update-all'])
    expect(kinds('DELETE FROM users WHERE id = 1')).toEqual([])
    expect(kinds('UPDATE users SET active = false WHERE id = 1')).toEqual([])
    expect(kinds('DELETE FROM a USING b WHERE a.id = b.id')).toEqual([])
  })

  it('detects DELETE/UPDATE without WHERE inside a CTE or as the main command after a CTE', () => {
    expect(kinds('WITH gone AS (DELETE FROM users RETURNING id) SELECT count(*) FROM gone')).toEqual(['delete-all'])
    expect(kinds('WITH x AS (SELECT id FROM t WHERE id > 1) DELETE FROM users')).toEqual(['delete-all'])
    expect(kinds('WITH x AS (SELECT 1) DELETE FROM users WHERE id IN (SELECT * FROM x)')).toEqual([])
  })

  it('ignores words in comments, strings and quoted identifiers', () => {
    expect(kinds('-- DROP TABLE users\nSELECT 1')).toEqual([])
    expect(kinds('/* TRUNCATE users; /* aninhado */ DELETE FROM x; */ SELECT 1')).toEqual([])
    expect(kinds("SELECT 'DROP TABLE users; DELETE FROM x'")).toEqual([])
    expect(kinds("SELECT E'it\\'s; DROP TABLE x'")).toEqual([])
    expect(kinds('SELECT $body$ DELETE FROM users; $body$')).toEqual([])
    expect(kinds('SELECT "drop" FROM t')).toEqual([])
    expect(kinds("DELETE FROM users -- WHERE id = 1")).toEqual(['delete-all'])
    expect(kinds("DELETE FROM users WHERE note = 'a;b'")).toEqual([])
  })

  it('does not confuse clauses that use the same words', () => {
    expect(kinds('SELECT * FROM t FOR UPDATE')).toEqual([])
    expect(kinds('INSERT INTO t (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET n = 2')).toEqual([])
    expect(kinds('CREATE TABLE t (id int REFERENCES u(id) ON DELETE CASCADE ON UPDATE CASCADE)')).toEqual([])
    expect(kinds('GRANT DELETE, UPDATE ON t TO app')).toEqual([])
    expect(kinds('SELECT 1; SELECT 2;')).toEqual([])
  })

  it('splits several statements and returns the text of each destructive one', () => {
    const found = destructiveStatements('SELECT 1;\n  DROP TABLE a ;\nDELETE FROM b WHERE id = 2; TRUNCATE c')
    expect(found).toEqual([{ kind: 'drop', sql: 'DROP TABLE a' }, { kind: 'truncate', sql: 'TRUNCATE c' }])
  })
})
