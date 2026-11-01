import { describe, expect, it } from 'vitest'
import { buildChanges, buildTableQuery, type CatalogTable, type TableQuery } from './sql-builder'
const table: CatalogTable = { oid: 42, schema: 'schema "um"', name: 'select;--', ctidAvailable: true, columns: [
  { attnum: 1, name: 'id', kind: 'number', typeSql: 'integer', primaryKey: true },
  { attnum: 2, name: 'nome "ou"', kind: 'text', typeSql: 'text', primaryKey: false },
  { attnum: 3, name: 'doc', kind: 'json', typeSql: 'jsonb', primaryKey: false },
  { attnum: 4, name: 'bin', kind: 'bytea', typeSql: 'bytea', primaryKey: false }
] }
const request: TableQuery = { oid: 42, conditions: [], order: [], limit: 200, offset: 0 }
describe('gerador SQL de tabela', () => {
  it('ordena pelo valor da coluna, não pelo texto da saída (id 2 antes de 10)', () => {
    const result = buildTableQuery(table, { ...request, order: [{ column: 1, dir: 'desc' }] })
    // O apelido da projeção não pode ser o nome da coluna: o ORDER BY usaria o texto convertido.
    expect(result.text).toContain('"id"::text AS "__agentboard_1"')
    expect(result.text).not.toMatch(/AS "id"/)
    expect(result.text).toContain('ORDER BY "id" DESC')
  })
  it.each([`' OR true --`, 'a; DROP TABLE x', '/* comment */', '100%_\\', '日本語', 'NULL'])('parametriza valor hostil %s', (value) => {
    const result = buildTableQuery(table, { ...request, conditions: [{ column: 2, operator: 'eq', value }] })
    expect(result.text).toContain('"schema ""um"""."select;--"')
    expect(result.text).toContain('"nome ""ou""" = $1::text')
    if (value !== 'NULL') expect(result.text).not.toContain(value)
    expect(result.values[0]).toBe(value)
  })
  it('escapa caracteres curingas, ordena por PK e limita a página', () => {
    const result = buildTableQuery(table, { ...request, conditions: [{ column: 2, operator: 'contains', value: 'a%_\\b' }], order: [{ column: 2, dir: 'desc' }] })
    expect(result.values).toEqual(['%a\\%\\_\\\\b%', 201, 0])
    expect(result.text).toContain('ILIKE $1 ESCAPE')
    expect(result.text).toContain('ORDER BY "nome ""ou""" DESC, "id" ASC LIMIT $2 OFFSET $3')
  })
  it('recusa identidade, operadores, valores e limites inválidos', () => {
    expect(() => buildTableQuery(table, { ...request, oid: 43 })).toThrow()
    expect(() => buildTableQuery(table, { ...request, conditions: [{ column: 99, operator: 'eq', value: 'a' }] })).toThrow()
    expect(() => buildTableQuery(table, { ...request, conditions: [{ column: 4, operator: 'eq', value: 'a' }] })).toThrow()
    expect(() => buildTableQuery(table, { ...request, conditions: [{ column: 3, operator: 'eq', value: '{}' }] })).toThrow()
    expect(() => buildTableQuery(table, { ...request, conditions: [{ column: 1, operator: 'eq', value: '1;drop' }] })).toThrow()
    expect(() => buildTableQuery(table, { ...request, limit: 1001 })).toThrow()
    expect(() => buildTableQuery(table, { ...request, conditions: [{ column: 2, operator: 'isNull', value: 'NULL' }] })).toThrow()
  })
  it('usa ctid sem PK e limita células grandes', () => {
    const result = buildTableQuery({ ...table, columns: table.columns.map((col) => ({ ...col, primaryKey: false })) }, request)
    expect(result.orderedBy).toBe('ctid')
    expect(result.text).toContain('ORDER BY ctid ASC')
    expect(result.text).toContain('left("nome ""ou"""::text, 8201)')
    expect(result.text).toContain('octet_length("bin")')
  })
  it('não usa ctid em views', () => {
    const result = buildTableQuery({ ...table, ctidAvailable: false, columns: table.columns.map((col) => ({ ...col, primaryKey: false })) }, request)
    expect(result.orderedBy).toBe('none'); expect(result.text).not.toContain('ORDER BY')
  })
})
describe('WHERE e ORDER BY livres', () => {
  it('entram entre parênteses e antes do desempate pela chave primária', () => {
    const result = buildTableQuery(table, { ...request, conditions: [{ column: 2, operator: 'eq', value: 'a' }], where: "id > 10 AND \"nome \"\"ou\"\"\" ILIKE '%;--%'", orderBy: 'nome DESC' })
    expect(result.text).toContain(`WHERE "nome ""ou""" = $1::text AND (id > 10 AND "nome ""ou""" ILIKE '%;--%')`)
    expect(result.text).toContain('ORDER BY nome DESC, "id" ASC')
    expect(result.orderedBy).toBe('user')
    expect(buildTableQuery(table, { ...request, where: 'id = 1' }, 'count').text).toContain('WHERE (id = 1)')
  })
  it.each(['id = 1; DROP TABLE x', 'id = 1 -- resto', 'id = 1 /* x */', 'id = $1', '(id = 1', 'id = 1)', "nome = 'aberto"])('recusa %s', (where) => {
    expect(() => buildTableQuery(table, { ...request, where })).toThrow()
  })
})

describe('alterações de linhas', () => {
  it('monta insert, update e delete com literais convertidos e chave primária', () => {
    const sql = buildChanges(table, { inserts: [{ '2': "o'brien" }, {}], updates: [{ key: { '1': '7' }, set: { '2': null } }], deletes: [{ key: { '1': '9' } }] })
    expect(sql).toEqual([
      `INSERT INTO "schema ""um"""."select;--" ("nome ""ou""") VALUES (CAST('o''brien' AS text))`,
      'INSERT INTO "schema ""um"""."select;--" DEFAULT VALUES',
      `UPDATE "schema ""um"""."select;--" SET "nome ""ou""" = NULL WHERE "id" = CAST('7' AS integer)`,
      `DELETE FROM "schema ""um"""."select;--" WHERE "id" = CAST('9' AS integer)`
    ])
  })
  it('recusa coluna desconhecida, binário, chave incompleta e tabela sem chave', () => {
    expect(() => buildChanges(table, { inserts: [{ '99': 'x' }], updates: [], deletes: [] })).toThrow('Coluna não encontrada')
    expect(() => buildChanges(table, { inserts: [{ '4': 'x' }], updates: [], deletes: [] })).toThrow('binária')
    expect(() => buildChanges(table, { inserts: [], updates: [], deletes: [{ key: {} }] })).toThrow('chave primária')
    expect(() => buildChanges({ ...table, columns: table.columns.map((col) => ({ ...col, primaryKey: false })) }, { inserts: [], updates: [], deletes: [{ key: { '1': '1' } }] })).toThrow('não tem chave primária')
    expect(() => buildChanges(table, { inserts: [], updates: [], deletes: [] })).toThrow('Não há alterações')
  })
})
