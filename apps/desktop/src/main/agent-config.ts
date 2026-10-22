import { agentConfigSchema, defaultPermissionMode, permissionModes, type AgentConfig, type AgentOptions, type AgentPurpose, type CardAgents, type Effort, type ModelOption } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import type { BoardRepository, ProfileRepository } from './projects'

const claudeEfforts: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
/** Claude aceita aliases de modelo; Opus para planejar e Sonnet para executar são as recomendações de partida. */
export const claudeModels: ModelOption[] = [
  { id: 'opus', label: 'Opus', description: 'Mais capaz; bom para planejar.', efforts: claudeEfforts, recommendedFor: ['planning'], defaultEffort: 'high' },
  { id: 'sonnet', label: 'Sonnet', description: 'Equilibrado; bom para executar e testar.', efforts: claudeEfforts, recommendedFor: ['execution', 'test'], defaultEffort: 'medium' },
  { id: 'haiku', label: 'Haiku', description: 'Rápido e barato para tarefas simples.', efforts: ['low', 'medium', 'high'], recommendedFor: [], defaultEffort: 'low' }
]

export type CodexModelLister = (profileId: string) => Promise<ModelOption[]>

/** Modelo, esforço e modo por card e por finalidade (planejar/executar), com o "mais usado" de cada agente. */
export class AgentConfigRepository {
  private readonly codexCache = new Map<string, ModelOption[]>()
  constructor(private readonly database: AppDatabase, private readonly board: BoardRepository, private readonly profiles: ProfileRepository, private readonly listCodexModels?: CodexModelLister) {}

  get(cardId: string): CardAgents {
    this.board.card(cardId)
    const rows = this.database.db.prepare('SELECT purpose, profile_id AS profileId, model, effort, mode FROM card_agent_settings WHERE card_id = ?').all(cardId) as Array<AgentConfig & { purpose: AgentPurpose }>
    const pick = (purpose: AgentPurpose): AgentConfig | null => { const row = rows.find((item) => item.purpose === purpose); return row ? agentConfigSchema.parse({ profileId: row.profileId, model: row.model, effort: row.effort, mode: row.mode }) : null }
    return { planning: pick('planning'), execution: pick('execution'), test: pick('test') }
  }

  set(cardId: string, purpose: AgentPurpose, config: AgentConfig): CardAgents {
    this.board.card(cardId)
    const profile = this.profiles.get(config.profileId)
    const info = permissionModes[profile.provider].find((mode) => mode.id === config.mode)
    if (!info || !info.purposes.includes(purpose)) throw new Error(`O modo "${config.mode}" não existe para ${purpose === 'planning' ? 'planejar' : purpose === 'test' ? 'testar' : 'executar'} com ${profile.provider === 'codex' ? 'Codex' : 'Claude'}`)
    if (info.needsApprovalUi) throw new Error(`O modo "${info.label}" precisa da tela de aprovação, que ainda não existe.`)
    this.database.db.prepare(`INSERT INTO card_agent_settings(card_id, purpose, profile_id, model, effort, mode, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(card_id, purpose) DO UPDATE SET profile_id = excluded.profile_id, model = excluded.model, effort = excluded.effort, mode = excluded.mode, updated_at = excluded.updated_at`)
      .run(cardId, purpose, config.profileId, config.model, config.effort, config.mode, new Date().toISOString())
    return this.get(cardId)
  }

  /** Configuração usada num turno: a salva no card (se for do mesmo agente) ou o padrão (mais usado, senão recomendado). */
  resolve(cardId: string, profileId: string, purpose: AgentPurpose): AgentConfig {
    const saved = this.get(cardId)[purpose]
    if (saved && saved.profileId === profileId) return saved
    const provider = this.profiles.get(profileId).provider
    const used = this.mostUsed(profileId, purpose)
    const recommended = provider === 'claude' ? claudeModels.find((model) => model.recommendedFor.includes(purpose)) : undefined
    return { profileId, model: used?.model ?? recommended?.id ?? null, effort: used?.effort ?? recommended?.defaultEffort ?? null, mode: defaultPermissionMode(provider, purpose) }
  }

  recordUse(config: AgentConfig, purpose: AgentPurpose): void {
    this.database.db.prepare(`INSERT INTO agent_usage_stats(profile_id, purpose, model, effort, count, last_used_at) VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(profile_id, purpose, model, effort) DO UPDATE SET count = count + 1, last_used_at = excluded.last_used_at`).run(config.profileId, purpose, config.model ?? '', config.effort ?? '', new Date().toISOString())
  }

  mostUsed(profileId: string, purpose: AgentPurpose): { model: string | null; effort: Effort | null } | null {
    const row = this.database.db.prepare('SELECT model, effort FROM agent_usage_stats WHERE profile_id = ? AND purpose = ? ORDER BY count DESC, last_used_at DESC LIMIT 1').get(profileId, purpose) as { model: string; effort: string } | undefined
    return row ? { model: row.model || null, effort: (row.effort || null) as Effort | null } : null
  }

  async options(profileId: string): Promise<AgentOptions> {
    const profile = this.profiles.get(profileId)
    let models = claudeModels
    let error: string | undefined
    if (profile.provider === 'codex') {
      if (!this.codexCache.has(profileId) && this.listCodexModels) {
        try { const listed = await this.listCodexModels(profileId); if (listed.length) this.codexCache.set(profileId, listed); else error = 'O Codex não devolveu nenhum modelo.' }
        catch (reason) { error = (reason instanceof Error ? reason.message : String(reason)).slice(0, 300) }
      }
      models = this.codexCache.get(profileId) ?? []
    }
    return { models, ...(error ? { error } : {}), mostUsed: { planning: this.mostUsed(profileId, 'planning'), execution: this.mostUsed(profileId, 'execution'), test: this.mostUsed(profileId, 'test') } }
  }
}
