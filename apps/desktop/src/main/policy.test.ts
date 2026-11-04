import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PolicyAction, PolicyRule } from '@gearmod/contracts'
import { AppDatabase } from './database'
import { decide, PolicyEngine } from './policy'

describe('decide (pure and deterministic)', () => {
  const actions: PolicyAction[] = ['commit', 'move', 'choose-workflow']
  it('truth table: the first rule for the action decides; with no rule, it stays ask', () => {
    const rules: PolicyRule[] = [{ action: 'commit', decision: 'allow' }, { action: 'move', decision: 'deny' }]
    const table: Array<[PolicyAction, string]> = [['commit', 'allow'], ['move', 'deny'], ['choose-workflow', 'ask']]
    for (const [action, expected] of table) expect(decide(rules, action)).toBe(expected)
  })
  it('is pure: same input, same output, does not change the rules', () => {
    const rules: PolicyRule[] = [{ action: 'commit', decision: 'deny' }]
    for (const action of actions) { const first = decide(rules, action); expect(decide(rules, action)).toBe(first) }
    expect(rules).toEqual([{ action: 'commit', decision: 'deny' }])
  })
  it('empty rules: everything is ask (current behavior, nothing changes on its own)', () => {
    for (const action of actions) expect(decide([], action)).toBe('ask')
  })
})

describe('PolicyEngine', () => {
  const roots: string[] = [], databases: AppDatabase[] = []
  afterEach(async () => { while (databases.length) databases.pop()!.close(); while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })
  async function setup(): Promise<AppDatabase> {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-policy-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), 'test'); databases.push(database); await database.open()
    database.db.prepare("INSERT INTO projects(id,name,local_path,base_branch,created_at,updated_at) VALUES ('p','P','C:/p','main','now','now')").run()
    database.db.prepare("INSERT INTO board_columns(id,project_id,label,sort_order,semantic_state) VALUES ('c','p','Todo',0,'todo')").run()
    database.db.prepare("INSERT INTO cards(id,project_id,column_id,type,title,priority,order_key,created_at,updated_at) VALUES ('k','p','c','task','K','normal',1,'now','now')").run()
    return database
  }
  it('records every decision in card_events, even when it allows', () => {
    return setup().then((database) => {
      const engine = new PolicyEngine(database)
      expect(engine.decide([{ action: 'commit', decision: 'allow' }], 'commit', { cardId: 'k', projectId: 'p', actor: 'agent' })).toBe('allow')
      expect(engine.decide([], 'move', { cardId: 'k', projectId: 'p', actor: 'agent' })).toBe('ask')
      const events = database.db.prepare("SELECT type, json FROM card_events WHERE card_id = 'k' ORDER BY created_at").all() as Array<{ type: string; json: string }>
      expect(events.map((event) => event.type)).toEqual(['policy.decided', 'policy.decided'])
      expect(events.map((event) => JSON.parse(event.json))).toEqual([{ action: 'commit', decision: 'allow' }, { action: 'move', decision: 'ask' }])
    })
  })
})
