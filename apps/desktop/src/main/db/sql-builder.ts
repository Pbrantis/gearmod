/** SQL de navegação de tabelas. Os metadados devem vir do catálogo consultado no servidor para o OID solicitado. */
import { tm } from '../i18n'
export type FilterOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'startsWith' | 'endsWith' | 'isNull' | 'notNull'
export type ColumnKind = 'text' | 'number' | 'date' | 'boolean' | 'json' | 'array' | 'enum' | 'uuid' | 'bytea' | 'other'
export interface CatalogColumn { attnum: number; name: string; typeSql: string; kind: ColumnKind; primaryKey: boolean; nullable?: boolean; comment?: string | null; foreignKeys?: string[]; indexes?: string[] }
export interface CatalogTable { oid: number; schema: string; name: string; columns: CatalogColumn[]; ctidAvailable: boolean; estimatedTotal?: number | null }
export interface TableQuery { oid: number; conditions: Array<{ column: number; operator: FilterOperator; value?: string }>; order: Array<{ column: number; dir: 'asc' | 'desc' }>; limit: number; offset: number; where?: string; orderBy?: string }
export interface BuiltQuery { text: string; values: Array<string | number>; orderedBy: 'pk' | 'user' | 'ctid' | 'none' }

const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`
const operators: Record<FilterOperator, string> = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=', contains: 'ILIKE', startsWith: 'ILIKE', endsWith: 'ILIKE', isNull: 'IS NULL', notNull: 'IS NOT NULL' }
const comparisons = new Set<FilterOperator>(['eq', 'neq', 'lt', 'lte', 'gt', 'gte'])
const patterns = new Set<FilterOperator>(['contains', 'startsWith', 'endsWith'])
const accepted: Record<ColumnKind, readonly FilterOperator[]> = {
  text: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith', 'isNull', 'notNull'],
  number: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'isNull', 'notNull'], date: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'isNull', 'notNull'],
  boolean: ['eq', 'neq', 'isNull', 'notNull'], json: ['contains', 'isNull', 'notNull'],
  array: ['eq', 'neq', 'contains', 'isNull', 'notNull'], enum: ['eq', 'neq', 'contains', 'isNull', 'notNull'], uuid: ['eq', 'neq', 'contains', 'isNull', 'notNull'],
  bytea: [], other: ['eq', 'neq', 'isNull', 'notNull']
}
/**
 * Trecho livre de WHERE ou ORDER BY digitado pelo usuário. Fica dentro de um único SELECT: sem `;`, sem comentários,
 * sem `$` fora de texto (parâmetros e dollar-quote) e com aspas e parênteses fechados. A transação segue as regras da conexão.
 */
export function freeClause(text: string | undefined, label: 'WHERE' | 'ORDER BY'): string {
  const clause = (text ?? '').trim()
  if (!clause) return ''
  if (clause.length > 2000) throw new Error(tm().db.tooLong(label))
  let depth = 0, quoteChar = ''
  for (let i = 0; i < clause.length; i++) {
    const char = clause[i]!
    if (quoteChar) { if (char === quoteChar) { if (clause[i + 1] === quoteChar) i++; else quoteChar = '' } continue }
    if (char === "'" || char === '"') { quoteChar = char; continue }
    if (char === ';') throw new Error(tm().db.singleExpression(label))
    if (char === '$') throw new Error(tm().db.dollarNotAllowed(label))
    if ((char === '-' && clause[i + 1] === '-') || (char === '/' && clause[i + 1] === '*')) throw new Error(tm().db.commentsNotAllowed(label))
    if (char === '(') depth++
    if (char === ')' && --depth < 0) throw new Error(tm().db.unopenedParenthesis(label))
  }
  if (quoteChar) throw new Error(tm().db.unclosedQuote(label))
  if (depth !== 0) throw new Error(tm().db.unclosedParenthesis(label))
  return clause
}
const escapePattern =(value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`)

/** O tipo format_type é metadado confiável do catálogo, nunca um valor informado pelo renderer. */
export function buildTableQuery(table: CatalogTable, request: TableQuery, mode: 'page' | 'count' = 'page'): BuiltQuery {
  if (!Number.isSafeInteger(request.oid) || request.oid !== table.oid) throw new Error(tm().db.tableCatalogMismatch)
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 1000 || !Number.isSafeInteger(request.offset) || request.offset < 0) throw new Error(tm().db.invalidPagination)
  if (!table.columns.length || table.columns.length > 1600 || request.conditions.length > 100 || request.order.length > 100) throw new Error(tm().db.invalidColumnsOrFilters)
  const column = (attnum: number): CatalogColumn => { const result = table.columns.find((item) => item.attnum === attnum); if (!result) throw new Error(tm().db.columnNotInCatalog); return result }
  const values: Array<string | number> = []
  const conditions = request.conditions.map((condition) => {
    const col = column(condition.column), op = condition.operator
    if (!Object.hasOwn(operators, op) || !accepted[col.kind]?.includes(op)) throw new Error(tm().db.operatorNotAllowedForType)
    const name = quote(col.name)
    if (op === 'isNull' || op === 'notNull') { if (condition.value !== undefined) throw new Error(tm().db.nullOperatorNoValue); return `${name} ${operators[op]}` }
    if (typeof condition.value !== 'string') throw new Error('Informe um valor para o filtro')
    if (col.kind === 'number' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(condition.value)) throw new Error(tm().db.invalidNumber)
    if (col.kind === 'boolean' && !/^(true|false)$/i.test(condition.value)) throw new Error(tm().db.invalidBoolean)
    if (col.kind === 'date' && (!condition.value.trim() || Number.isNaN(Date.parse(condition.value)))) throw new Error(tm().db.invalidDate)
    if (patterns.has(op)) {
      const value = escapePattern(condition.value)
      values.push(op === 'contains' ? `%${value}%` : op === 'startsWith' ? `${value}%` : `%${value}`)
      return `${name}::text ILIKE $${values.length} ESCAPE E'\\\\'`
    }
    if (!comparisons.has(op)) throw new Error(tm().db.invalidOperator)
    values.push(condition.value)
    return `${name} ${operators[op]} $${values.length}::${col.typeSql}`
  })
  const userWhere = freeClause(request.where, 'WHERE')
  if (userWhere) conditions.push(`(${userWhere})`)
  if (mode === 'count') return { text: `SELECT count(*)::text FROM ${quote(table.schema)}.${quote(table.name)}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}`, values, orderedBy: 'none' }
  const seen = new Set<number>()
  const order = request.order.map((item) => { const col = column(item.column); if (item.dir !== 'asc' && item.dir !== 'desc') throw new Error(tm().db.invalidOrder); if (seen.has(col.attnum)) throw new Error(tm().db.repeatedOrdering); seen.add(col.attnum); return `${quote(col.name)} ${item.dir.toUpperCase()}` })
  const userOrder = freeClause(request.orderBy, 'ORDER BY')
  if (userOrder) order.push(userOrder)
  const primary = table.columns.filter((item) => item.primaryKey)
  for (const col of primary) if (!seen.has(col.attnum)) order.push(`${quote(col.name)} ASC`)
  if (!primary.length && table.ctidAvailable) order.push('ctid ASC')
  const projections = table.columns.map((col) => {
    const name = quote(col.name)
    // Apelido diferente do nome: senão o ORDER BY "id" ordena o texto da saída (1, 10, 100…) e não o valor. As linhas voltam por posição.
    const alias = quote(`__gearmod_${col.attnum}`)
    if (col.kind === 'bytea') return `CASE WHEN ${name} IS NULL THEN NULL ELSE 'bytea(' || octet_length(${name}) || '):' || encode(substring(${name} from 1 for 32), 'hex') END AS ${alias}`
    if (col.kind === 'text' || col.kind === 'json') return `left(${name}::text, 8201) AS ${alias}`
    return `${name}::text AS ${alias}`
  })
  values.push(request.limit + 1, request.offset)
  const text = `SELECT ${projections.join(', ')} FROM ${quote(table.schema)}.${quote(table.name)}${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}${order.length ? ` ORDER BY ${order.join(', ')}` : ''} LIMIT $${values.length - 1} OFFSET $${values.length}`
  return { text, values, orderedBy: request.order.length || userOrder ? 'user' : primary.length ? 'pk' : table.ctidAvailable ? 'ctid' : 'none' }
}

/** Alterações pendentes de uma tabela; as chaves dos objetos são os `attnum` das colunas, e `null` é NULL do SQL. */
export interface TableChanges {
  inserts: Array<Record<string, string | null>>
  updates: Array<{ key: Record<string, string | null>; set: Record<string, string | null> }>
  deletes: Array<{ key: Record<string, string | null> }>
}
const maxChanges = 500
/** Valor como literal convertido para o tipo da coluna (tipo vindo do catálogo); aspas simples dobradas, sem parâmetros porque o envio é em texto. */
function literal(col: CatalogColumn, value: string | null): string {
  if (value === null) return 'NULL'
  if (value.includes('\0')) throw new Error(tm().db.invalidValueFor(col.name))
  if (col.kind === 'bytea') throw new Error(tm().db.binaryColumnNotEditable(col.name))
  return `CAST('${value.replaceAll("'", "''")}' AS ${col.typeSql})`
}
/** Monta os comandos INSERT/UPDATE/DELETE; atualizar e apagar exigem a chave primária completa da linha. */
export function buildChanges(table: CatalogTable, changes: TableChanges): string[] {
  const total = changes.inserts.length + changes.updates.length + changes.deletes.length
  if (!total) throw new Error(tm().db.noChangesToApply)
  if (total > maxChanges) throw new Error(tm().db.tooManyChanges(maxChanges))
  const byNumber = new Map(table.columns.map((col) => [String(col.attnum), col])), target = `${quote(table.schema)}.${quote(table.name)}`
  const known = (key: string): CatalogColumn => { const col = byNumber.get(key); if (!col) throw new Error(tm().db.columnNotInTable); return col }
  const primary = table.columns.filter((col) => col.primaryKey)
  const where = (key: Record<string, string | null>): string => {
    if (!primary.length) throw new Error(tm().db.noPrimaryKey)
    const keys = Object.keys(key)
    if (keys.length !== primary.length || primary.some((col) => !(String(col.attnum) in key))) throw new Error(tm().db.rowKeyMismatch)
    return primary.map((col) => { const value = key[String(col.attnum)]; if (value === null || value === undefined) throw new Error(tm().db.primaryKeyNoValue); return `${quote(col.name)} = ${literal(col, value)}` }).join(' AND ')
  }
  const sql: string[] = []
  for (const row of changes.inserts) {
    const keys = Object.keys(row)
    sql.push(keys.length ? `INSERT INTO ${target} (${keys.map((key) => quote(known(key).name)).join(', ')}) VALUES (${keys.map((key) => literal(known(key), row[key]!)).join(', ')})` : `INSERT INTO ${target} DEFAULT VALUES`)
  }
  for (const item of changes.updates) {
    const keys = Object.keys(item.set)
    if (!keys.length) continue
    sql.push(`UPDATE ${target} SET ${keys.map((key) => `${quote(known(key).name)} = ${literal(known(key), item.set[key]!)}`).join(', ')} WHERE ${where(item.key)}`)
  }
  for (const item of changes.deletes) sql.push(`DELETE FROM ${target} WHERE ${where(item.key)}`)
  if (!sql.length) throw new Error(tm().db.noChangesToApply)
  return sql
}
