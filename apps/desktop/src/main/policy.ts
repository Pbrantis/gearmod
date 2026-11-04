import { randomUUID } from 'node:crypto'
import type { AppDatabase } from './database'
import type { PolicyAction, PolicyDecision, PolicyRule } from '@gearmod/contracts'

/** Pure, deterministic decision: the first rule for the action decides; with no rule for the action, it stays `ask` (never allows by omission). */
export function decide(rules: readonly PolicyRule[], action: PolicyAction): PolicyDecision {
  return rules.find((rule) => rule.action === action)?.decision ?? 'ask'
}

/**
 * Minimal `PolicyEngine` (S11): wraps `decide()` with the recording of every decision in `card_events` (audit), keeping no state
 * of its own. The rules come from the project's `workflowConfig.policy`; empty = everything `ask` (today's behavior, nothing changes on its own).
 */
export class PolicyEngine {
  constructor(private readonly database: AppDatabase) {}

  decide(rules: readonly PolicyRule[], action: PolicyAction, context: { cardId: string; projectId: string; actor: 'agent' | 'user' }): PolicyDecision {
    const decision = decide(rules, action)
    try {
      this.database.db.prepare(`INSERT INTO card_events(id,card_id,project_id,type,schema_version,actor,created_at,json) VALUES (?,?,?,?,1,?,?,?)`)
        .run(randomUUID(), context.cardId, context.projectId, 'policy.decided', context.actor, new Date().toISOString(), JSON.stringify({ action, decision }))
    } catch { /* audit does not block the decision */ }
    return decision
  }
}
