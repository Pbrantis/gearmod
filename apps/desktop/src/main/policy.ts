import { randomUUID } from 'node:crypto'
import type { AppDatabase } from './database'
import type { PolicyAction, PolicyDecision, PolicyRule } from '@gearmod/contracts'

/** Decisão pura e determinística: a primeira regra para a ação decide; sem regra para a ação, fica `ask` (nunca libera por omissão). */
export function decide(rules: readonly PolicyRule[], action: PolicyAction): PolicyDecision {
  return rules.find((rule) => rule.action === action)?.decision ?? 'ask'
}

/**
 * `PolicyEngine` mínimo (S11): embrulha `decide()` com o registro de toda decisão em `card_events` (auditoria), sem guardar estado
 * próprio. As regras vêm do `workflowConfig.policy` do projeto; vazio = tudo `ask` (comportamento de hoje, nada muda sozinho).
 */
export class PolicyEngine {
  constructor(private readonly database: AppDatabase) {}

  decide(rules: readonly PolicyRule[], action: PolicyAction, context: { cardId: string; projectId: string; actor: 'agent' | 'user' }): PolicyDecision {
    const decision = decide(rules, action)
    try {
      this.database.db.prepare(`INSERT INTO card_events(id,card_id,project_id,type,schema_version,actor,created_at,json) VALUES (?,?,?,?,1,?,?,?)`)
        .run(randomUUID(), context.cardId, context.projectId, 'policy.decided', context.actor, new Date().toISOString(), JSON.stringify({ action, decision }))
    } catch { /* auditoria não bloqueia a decisão */ }
    return decision
  }
}
