import { existsSync } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentProfile, UsageWindow } from '@agentboard/contracts'
import type { AppDatabase } from './database'
import type { ProfileRepository } from './projects'

const windowLabels: Record<string, string> = { five_hour: 'Sessão de 5 horas', seven_day: 'Semana' }
const labelFor = (id: string, minutes?: number): string => windowLabels[id] ?? (minutes ? (minutes >= 10_080 ? 'Semana' : minutes >= 1440 ? `${Math.round(minutes / 1440)} dias` : `${Math.round(minutes / 60)} horas`) : id)
const iso = (seconds: number): string => new Date(seconds * 1000).toISOString()
const periods: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86_400_000 }

/** Janela que já reiniciou: volta a 0% e o próximo reset é projetado somando o período da janela (5 h ou semana). */
export function rollWindow(window: UsageWindow, now = Date.now()): UsageWindow {
  if (!window.resetsAt || Date.parse(window.resetsAt) > now) return window
  const period = periods[window.id]
  const next = period ? new Date(Date.parse(window.resetsAt) + Math.ceil((now - Date.parse(window.resetsAt) + 1) / period) * period).toISOString() : null
  return { ...window, usedPercent: 0, resetsAt: next }
}

/** Janelas de uso numa linha das sessões do Codex (`rate_limits` com `primary` e `secondary`); aceita variações de nome dos campos. */
export function parseCodexRateLimits(line: string): { windows: UsageWindow[]; at: string | null } | null {
  if (!line.includes('rate_limits')) return null
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { return null }
  const find = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (record.rate_limits && typeof record.rate_limits === 'object') return record.rate_limits as Record<string, unknown>
    for (const nested of Object.values(record)) { const found = find(nested); if (found) return found }
    return null
  }
  const limits = find(parsed)
  if (!limits) return null
  const windows: UsageWindow[] = []
  for (const key of ['primary', 'secondary']) {
    const item = limits[key] as Record<string, unknown> | null | undefined
    if (!item || typeof item !== 'object') continue
    const percent = typeof item.used_percent === 'number' ? item.used_percent : typeof item.utilization === 'number' ? item.utilization * 100 : null
    if (percent === null) continue
    const minutes = typeof item.window_minutes === 'number' ? item.window_minutes : undefined
    const resets = typeof item.resets_at === 'number' ? iso(item.resets_at) : typeof item.resets_in_seconds === 'number' ? new Date(Date.now() + item.resets_in_seconds * 1000).toISOString() : null
    windows.push({ id: key === 'primary' ? 'five_hour' : 'seven_day', label: labelFor(key === 'primary' ? 'five_hour' : 'seven_day', minutes), usedPercent: Math.max(0, Math.min(100, Math.round(percent))), resetsAt: resets })
  }
  const at = typeof (parsed as { timestamp?: unknown }).timestamp === 'string' ? (parsed as { timestamp: string }).timestamp : null
  return windows.length ? { windows, at } : null
}

async function newestFiles(dir: string, limit: number): Promise<Array<{ path: string; mtime: number }>> {
  const files: Array<{ path: string; mtime: number }> = []
  const walk = async (current: string, depth: number): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = join(current, entry.name)
      if (entry.isDirectory() && depth < 5) await walk(full, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push({ path: full, mtime: (await stat(full)).mtimeMs })
    }
  }
  await walk(dir, 0)
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, limit)
}

async function tail(path: string, bytes: number): Promise<string> {
  const handle = await open(path, 'r')
  try { const { size } = await handle.stat(); const length = Math.min(size, bytes); const buffer = Buffer.alloc(length); await handle.read(buffer, 0, length, size - length); return buffer.toString('utf8') } finally { await handle.close() }
}

/** Uso das sessões: Codex lido de `<CODEX_HOME>/sessions/**\/*.jsonl`; Claude a partir do `rate_limit_event` que o Claude Code emite em cada execução. */
export class UsageService {
  private readonly probing = new Set<string>()
  constructor(private readonly database: AppDatabase, private readonly profiles: ProfileRepository, private readonly probeClaude?: (profile: AgentProfile) => Promise<Record<string, unknown> | null>, private readonly staleMs = 10 * 60_000) {}

  recordClaude(profileId: string, payload: Record<string, unknown>): void {
    const info = (payload.rate_limit_info ?? {}) as { unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }> }
    const upsert = this.database.db.prepare(`INSERT INTO agent_usage_snapshots(profile_id, window, utilization, resets_at, captured_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(profile_id, window) DO UPDATE SET utilization = excluded.utilization, resets_at = excluded.resets_at, captured_at = excluded.captured_at`)
    const now = new Date().toISOString()
    for (const [id, window] of Object.entries(info.unifiedWindows ?? {})) if (typeof window.utilization === 'number') upsert.run(profileId, id, window.utilization, typeof window.resetsAt === 'number' ? iso(window.resetsAt) : null, now)
  }

  private claude(profile: AgentProfile): { windows: UsageWindow[]; capturedAt: string | null } {
    const rows = this.database.db.prepare('SELECT window AS id, utilization, resets_at AS resetsAt, captured_at AS capturedAt FROM agent_usage_snapshots WHERE profile_id = ? ORDER BY window').all(profile.id) as Array<{ id: string; utilization: number; resetsAt: string | null; capturedAt: string }>
    const windows = rows.map((row) => rollWindow({ id: row.id, label: labelFor(row.id), usedPercent: Math.round(row.utilization * 100), resetsAt: row.resetsAt }))
    return { windows, capturedAt: rows.map((row) => row.capturedAt).sort().at(-1) ?? null }
  }

  private async codex(profile: AgentProfile): Promise<{ windows: UsageWindow[]; capturedAt: string | null }> {
    const dir = join(profile.configDir, 'sessions')
    if (!existsSync(dir)) return { windows: [], capturedAt: null }
    for (const file of await newestFiles(dir, 5)) {
      const lines = (await tail(file.path, 512 * 1024)).split('\n')
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const found = parseCodexRateLimits(lines[i]!)
        if (found) return { windows: found.windows.map((window) => rollWindow(window)), capturedAt: found.at ?? new Date(file.mtime).toISOString() }
      }
    }
    return { windows: [], capturedAt: null }
  }

  /**
   * O Claude só informa o limite quando roda. Para o painel não ficar vazio ou velho, faz uma chamada mínima (modelo barato)
   * por baixo dos panos e guarda o `rate_limit_event`. Só repete quando o dado tem mais de 10 minutos.
   */
  async refresh(): Promise<Array<{ profileId: string; provider: 'claude' | 'codex'; windows: UsageWindow[]; capturedAt: string | null; source: string }>> {
    if (this.probeClaude) {
      await Promise.all(this.profiles.list().filter((profile) => profile.provider === 'claude' && !this.probing.has(profile.id)).map(async (profile) => {
        const last = this.claude(profile).capturedAt
        if (last && Date.now() - Date.parse(last) < this.staleMs) return
        this.probing.add(profile.id)
        try { const payload = await this.probeClaude!(profile); if (payload) this.recordClaude(profile.id, payload) } catch { /* sem rede ou sem login: mantém o último dado */ } finally { this.probing.delete(profile.id) }
      }))
    }
    return this.list()
  }

  async list(): Promise<Array<{ profileId: string; provider: 'claude' | 'codex'; windows: UsageWindow[]; capturedAt: string | null; source: string }>> {
    return Promise.all(this.profiles.list().map(async (profile) => {
      const data = profile.provider === 'claude' ? this.claude(profile) : await this.codex(profile)
      return { profileId: profile.id, provider: profile.provider, ...data, source: profile.provider === 'claude' ? 'Última execução do Claude' : 'Sessões do Codex' }
    }))
  }
}
