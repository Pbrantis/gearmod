import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppDatabase } from './database'
import { UsageLedgerService, costKindOf, effectiveCostKind } from './usage-ledger'
import { ApprovalService } from './approvals'

const roots: string[] = []
const databases: AppDatabase[] = []
async function setup(): Promise<{ database: AppDatabase; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-ledger-')); roots.push(root)
  const database = new AppDatabase(join(root, 'db.sqlite'), 'test'); databases.push(database); await database.open()
  database.db.prepare("INSERT INTO projects(id,name,local_path,base_branch,created_at,updated_at) VALUES ('p','P','C:/p','main','now','now')").run()
  database.db.prepare("INSERT INTO board_columns(id,project_id,label,sort_order,semantic_state) VALUES ('c','p','Todo',0,'todo')").run()
  database.db.prepare("INSERT INTO cards(id,project_id,column_id,type,title,priority,order_key,created_at,updated_at) VALUES ('k','p','c','task','K','normal',1,'now','now')").run()
  database.db.prepare("INSERT INTO agent_profiles(id,provider,label,scope,color,config_dir,enabled,created_at,updated_at) VALUES ('a','codex','A','x','#000','C:/a',1,'now','now')").run()
  database.db.prepare("INSERT INTO chats(id,project_id,card_id,purpose,provider,profile_id,created_at,updated_at) VALUES ('h','p','k','execution','codex','a','now','now')").run()
  database.db.prepare("INSERT INTO runs(id,card_id,chat_id,profile_id,status,started_at,purpose,provider,model) VALUES ('r','k','h','a','completed','2026-01-01T00:00:00.000Z','execution','codex','gpt')").run()
  return { database, root }
}
afterEach(async () => { while (databases.length) databases.pop()!.close(); while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })

describe('UsageLedgerService', () => {
  it('writes one immutable, idempotent row per run', async () => {
    const { database } = await setup(), ledger = new UsageLedgerService(database)
    ledger.recordRun('r', { input: 3, cached: 2, output: 1 }); ledger.recordRun('r', { input: 3, cached: 2, output: 1 })
    expect(database.db.prepare('SELECT input_tokens input, cached_read_tokens cached, output_tokens output, source FROM usage_ledger').all()).toEqual([{ input: 3, cached: 2, output: 1, source: 'run' }])
    expect(() => database.db.prepare('UPDATE usage_ledger SET input_tokens = 0').run()).toThrow(/append-only/)
    expect(() => database.db.prepare('DELETE FROM usage_ledger').run()).toThrow(/append-only/)
  })

  it('records incremental deltas and leaves a partial marker when interrupted', async () => {
    const { database } = await setup(), ledger = new UsageLedgerService(database)
    ledger.recordDelta('r', { input: 2, cached: 3, output: 4 }); ledger.recordRun('r', { input: 2, cached: 3, output: 4 }, true)
    expect(database.db.prepare('SELECT seq,input_tokens AS input,cached_read_tokens AS cached,output_tokens AS output,partial FROM usage_ledger ORDER BY seq').all()).toEqual([{ seq: 0, input: 2, cached: 3, output: 4, partial: 0 }, { seq: 2147483647, input: 0, cached: 0, output: 0, partial: 1 }])
  })

  it('preserva custo e modelo efetivo após deltas, sem duplicar tokens nem custo ao repetir fechamento', async () => {
    const { database } = await setup(), ledger = new UsageLedgerService(database)
    database.db.prepare("UPDATE agent_profiles SET billing_mode='api' WHERE id='a'").run()
    database.db.prepare("UPDATE runs SET model_effective='gpt-real' WHERE id='r'").run()
    ledger.recordDelta('r', { input: 10, cached: 3, output: 4 })
    ledger.recordDelta('r', { input: 5, cached: 1, output: 2 })
    ledger.recordRun('r', { input: 15, cached: 4, output: 6, costUsd: 0.25 })
    ledger.recordRun('r', { input: 15, cached: 4, output: 6, costUsd: 0.25 })
    ledger.recordDelta('r', { input: 99, cached: 0, output: 0 })
    const total = database.db.prepare('SELECT SUM(input_tokens) AS input,SUM(cached_read_tokens) AS cached,SUM(output_tokens) AS output,SUM(cost_usd) AS cost FROM usage_ledger WHERE run_id=?').get('r')
    expect(total).toEqual({ input: 15, cached: 4, output: 6, cost: 0.25 })
    expect(database.db.prepare('SELECT cost_kind AS kind,model_effective AS model FROM usage_ledger WHERE run_id=? AND seq=2147483647').get('r')).toEqual({ kind: 'billed', model: 'gpt-real' })
  })

  it('não duplica custo de fechamento legado já existente', async () => {
    const { database } = await setup(), ledger = new UsageLedgerService(database)
    database.db.prepare("INSERT INTO usage_ledger(id,at,run_id,seq,source,provider,profile_id,card_id,input_tokens,cost_kind,cost_usd) VALUES ('old','2026-01-01T00:00:00.000Z','r',0,'run','codex','a','k',10,'billed',0.25)").run()
    ledger.recordRun('r', { input: 10, cached: 0, output: 0, costUsd: 0.25 })
    expect(database.db.prepare("SELECT SUM(input_tokens) AS tokens,SUM(cost_usd) AS cost FROM usage_ledger WHERE run_id='r'").get()).toEqual({ tokens: 10, cost: 0.25 })
  })

  it('imports a deleted run from history.jsonl only once and marks it partial', async () => {
    const { database, root } = await setup(), ledger = new UsageLedgerService(database), dir = join(root, 'artifacts')
    await mkdir(dir); await writeFile(join(dir, 'history.jsonl'), `${JSON.stringify({ id: '123e4567-e89b-42d3-a456-426614174009', v: 1, type: 'execution.completed', at: '2026-01-02T00:00:00.000Z', cardId: '123e4567-e89b-42d3-a456-426614174010', projectId: '123e4567-e89b-42d3-a456-426614174011', source: { actor: 'agent', runId: 'gone-run' }, refs: [], payload: { profileId: 'a', provider: 'codex', model: 'gpt', purpose: 'execution', input: 9, cached: 8, output: 7 } })}\n`)
    expect(ledger.importHistory('k', dir)).toBe(1); expect(ledger.importHistory('k', dir)).toBe(0)
    expect(database.db.prepare("SELECT source, partial, input_tokens AS input FROM usage_ledger WHERE run_id='gone-run'").get()).toEqual({ source: 'backfill', partial: 1, input: 9 })
  })

  it('não importa uma run já encerrada no ledger ao reconciliar history.jsonl', async () => {
    const { database, root } = await setup(), ledger = new UsageLedgerService(database), dir = join(root, 'artifacts')
    ledger.recordRun('r', { input: 9, cached: 2, output: 3, costUsd: 0.1 })
    await mkdir(dir)
    await writeFile(join(dir, 'history.jsonl'), `${JSON.stringify({ id: '123e4567-e89b-42d3-a456-426614174009', v: 1, type: 'execution.completed', at: '2026-01-02T00:00:00.000Z', cardId: '123e4567-e89b-42d3-a456-426614174010', projectId: '123e4567-e89b-42d3-a456-426614174011', source: { actor: 'agent', runId: 'r' }, refs: [], payload: { profileId: 'a', provider: 'codex', input: 9, cached: 2, output: 3 } })}\n`)
    expect(ledger.importHistory('k', dir)).toBe(0)
    expect(database.db.prepare("SELECT COUNT(*) AS count,SUM(input_tokens) AS tokens FROM usage_ledger WHERE run_id='r'").get()).toEqual({ count: 1, tokens: 9 })
  })

  it('aggregates ledger rows by requested group and period, respeitando o fuso do usuário', async () => {
    const { database } = await setup(), ledger = new UsageLedgerService(database)
    ledger.recordRun('r', { input: 3, cached: 2, output: 1 })
    // 2026-01-01T00:00:00Z: in UTC it is the 1st; in America/Manaus (UTC-4, no daylight saving time) it is still the evening of Dec 31.
    expect(ledger.history({ granularity: 'day', tz: 'UTC', groupBy: 'provider' })).toEqual([{ period: '2026-01-01', group: 'codex', input: 3, cached: 2, output: 1, billedUsd: 0, equivalentUsd: 0, unknownUsd: 0 }])
    expect(ledger.history({ granularity: 'day', tz: 'America/Manaus', groupBy: 'provider' })).toEqual([{ period: '2025-12-31', group: 'codex', input: 3, cached: 2, output: 1, billedUsd: 0, equivalentUsd: 0, unknownUsd: 0 }])
    expect(ledger.history({ granularity: 'month', tz: 'America/Manaus', groupBy: 'provider' })[0]).toMatchObject({ period: '2025-12' })
    expect(ledger.history({ granularity: 'week', tz: 'UTC', groupBy: 'provider' })[0]).toMatchObject({ period: '2026-W01' })
  })

  it('o mesmo instante cai em dias diferentes em dois fusos, e a troca de horário de verão não quebra o agrupamento', async () => {
    const { database } = await setup(), ledger = new UsageLedgerService(database)
    database.db.prepare("INSERT INTO runs(id,card_id,chat_id,profile_id,status,started_at,purpose,provider,model) VALUES ('r2','k','h','a','completed','2026-07-01T02:00:00.000Z','execution','codex','gpt')").run()
    ledger.recordRun('r', { input: 1, cached: 0, output: 0 }); ledger.recordRun('r2', { input: 1, cached: 0, output: 0 })
    // Northern hemisphere daylight saving time (e.g. Europe/Lisbon, UTC+1 in winter and UTC+0... here the opposite: South America no longer has DST,
    // but Europe/London does: 2026-07-01T02:00Z falls in BST (UTC+1) → 03:00 local, same day; and 2026-01-01T00:00Z falls in GMT (UTC+0) → same day.
    const london = ledger.history({ granularity: 'day', tz: 'Europe/London', groupBy: 'provider' })
    expect(london.map((row) => row.period).sort()).toEqual(['2026-01-01', '2026-07-01'])
    const manaus = ledger.history({ granularity: 'day', tz: 'America/Manaus', groupBy: 'provider' })
    expect(manaus.map((row) => row.period).sort()).toEqual(['2025-12-31', '2026-06-30'])
  })

  it('consulta por período usa o índice de at, não varre a tabela toda (plano de consulta em volume)', async () => {
    const { database } = await setup(), ledger = new UsageLedgerService(database)
    const insert = database.db.prepare(`INSERT INTO usage_ledger(id,at,run_id,seq,source,provider,profile_id,input_tokens,cached_read_tokens,output_tokens,cost_kind,cost_usd,partial) VALUES (?,?,NULL,0,'probe','codex','a',1,0,1,'unknown',NULL,0)`)
    const base = Date.UTC(2026, 0, 1)
    for (let index = 0; index < 5000; index += 1) insert.run(`u${index}`, new Date(base + index * 60_000).toISOString())
    const plan = database.db.prepare('EXPLAIN QUERY PLAN SELECT at, provider AS "group", input_tokens AS input, cached_read_tokens AS cached, output_tokens AS output, cost_kind AS costKind, cost_usd AS costUsd FROM usage_ledger WHERE at >= ? AND at <= ?').all('2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z') as Array<{ detail: string }>
    expect(plan.some((step) => /SCAN TABLE usage_ledger/i.test(step.detail))).toBe(false)
    expect(plan.some((step) => /usage_ledger_at/i.test(step.detail))).toBe(true)
    const result = ledger.history({ granularity: 'day', tz: 'UTC', groupBy: 'provider', from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T01:00:00.000Z' })
    expect(result[0]).toMatchObject({ period: '2026-01-01', group: 'codex' })
  })

  it('exports before an approved partial purge and restores append-only guards', async () => {
    const { database } = await setup(), ledger = new UsageLedgerService(database), approvals = new ApprovalService(database)
    ledger.recordRun('r', { input: 3, cached: 2, output: 1 })
    const range = { from: '2026-01-01T00:00:00.000Z', to: '2026-01-01T23:59:59.999Z' }
    const request = ledger.requestPurge(approvals, range)
    expect(() => ledger.purge(range, request.id, approvals)).toThrow(/Aprovação não é válida/)
    approvals.decide(request.id, true)
    const result = ledger.purge(range, request.id, approvals)
    expect(result).toMatchObject({ deleted: 1 }); expect(result.csv).toContain('inputTokens'); expect(result.csv).toContain('2026-01-01T00:00:00.000Z')
    ledger.recordRun('r', { input: 1, cached: 0, output: 0 })
    expect(() => database.db.prepare('DELETE FROM usage_ledger').run()).toThrow(/append-only/)
  })
})

describe('tipo do custo pelo modo de cobrança do agente', () => {
  it('chave de API e créditos são cobrados; assinatura é equivalente; sem modo é desconhecido', () => {
    expect(costKindOf('api')).toBe('billed'); expect(costKindOf('credits')).toBe('billed')
    expect(costKindOf('subscription')).toBe('api_equivalent')
    expect(costKindOf('unknown')).toBe('unknown'); expect(costKindOf(null)).toBe('unknown')
  })
  it('linhas antigas de assinatura gravadas como desconhecidas são lidas como equivalente', () => {
    expect(effectiveCostKind('unknown', 'subscription')).toBe('api_equivalent')
    expect(effectiveCostKind('unknown', 'unknown')).toBe('unknown')
    expect(effectiveCostKind('billed', 'subscription')).toBe('billed')
  })
})

describe('custo de linhas antigas sem modo de cobrança', () => {
  it('usa o modo atual do agente: assinatura vira equivalente API', async () => {
    const { database } = await setup(), ledger = new UsageLedgerService(database)
    database.db.prepare("UPDATE agent_profiles SET billing_mode='subscription' WHERE id='a'").run()
    database.db.prepare("INSERT INTO usage_ledger(id,at,run_id,seq,source,provider,profile_id,input_tokens,cached_read_tokens,output_tokens,billing_mode,cost_kind,cost_usd,partial) VALUES ('x','2026-02-01T12:00:00.000Z',NULL,0,'probe','codex','a',1,0,1,'unknown','unknown',2.5,0)").run()
    const [row] = ledger.history({ granularity: 'month', tz: 'UTC', groupBy: 'provider' })
    expect(row).toMatchObject({ equivalentUsd: 2.5, unknownUsd: 0, billedUsd: 0 })
  })
})
