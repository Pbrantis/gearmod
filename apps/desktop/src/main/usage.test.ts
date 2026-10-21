import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { ProfileRepository } from './projects'
import { parseCodexRateLimits, UsageService } from './usage'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const line = (primary: number, secondary: number, timestamp = '2026-10-21T10:00:00.000Z') => JSON.stringify({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 10 } }, rate_limits: { primary: { used_percent: primary, window_minutes: 300, resets_at: 1792548600 }, secondary: { used_percent: secondary, window_minutes: 10080, resets_at: 1792800000 } } } })

describe('parseCodexRateLimits', () => {
  it('reads the five-hour and weekly windows from a session line', () => {
    const found = parseCodexRateLimits(line(42.4, 17))!
    expect(found.windows).toEqual([
      { id: 'five_hour', label: 'Sessão de 5 horas', usedPercent: 42, resetsAt: new Date(1792548600 * 1000).toISOString() },
      { id: 'seven_day', label: 'Semana', usedPercent: 17, resetsAt: new Date(1792800000 * 1000).toISOString() }
    ])
    expect(found.at).toBe('2026-10-21T10:00:00.000Z')
  })

  it('ignores lines without limits, broken JSON and out-of-range values are clamped', () => {
    expect(parseCodexRateLimits('{"type":"message"}')).toBeNull()
    expect(parseCodexRateLimits('{"rate_limits": {oops')).toBeNull()
    expect(parseCodexRateLimits(line(150, -3))!.windows.map((window) => window.usedPercent)).toEqual([100, 0])
  })
})

describe('UsageService', () => {
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-usage-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root)
    const codex = profiles.create({ provider: 'codex', label: 'Codex', scope: 'x', useExistingSession: true })
    const claude = profiles.create({ provider: 'claude', label: 'Claude', scope: 'x', useExistingSession: true })
    return { root, database, codex, claude, service: new UsageService(database, profiles) }
  }

  it('reads the latest Codex limits from the newest session files', async () => {
    const { database, codex, service } = await setup()
    const dir = join(codex.configDir, 'sessions', '2026', '10', '21'); await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'old.jsonl'), `${line(90, 90)}\n`); await utimes(join(dir, 'old.jsonl'), new Date('2026-10-20'), new Date('2026-10-20'))
    await writeFile(join(dir, 'new.jsonl'), `{"type":"session_meta"}\n${line(10, 20, '2026-10-21T09:00:00.000Z')}\n${line(55, 21, '2026-10-21T11:00:00.000Z')}\n{"type":"agent_message"}\n`)
    const usage = (await service.list()).find((item) => item.profileId === codex.id)!
    expect(usage.windows.map((window) => window.usedPercent)).toEqual([55, 21]); expect(usage.capturedAt).toBe('2026-10-21T11:00:00.000Z'); expect(usage.source).toBe('Sessões do Codex')
    expect((await service.list()).find((item) => item.provider === 'claude')!.windows).toEqual([])
    database.close()
  })

  it('returns no windows for a Codex profile without sessions', async () => {
    const { database, codex, service } = await setup()
    expect((await service.list()).find((item) => item.profileId === codex.id)).toMatchObject({ windows: [], capturedAt: null })
    database.close()
  })

  it('stores the Claude rate_limit_event of each run and zeroes windows that already reset', async () => {
    const { database, claude, service } = await setup()
    const future = Math.floor(Date.now() / 1000) + 3600, past = Math.floor(Date.now() / 1000) - 3600
    service.recordClaude(claude.id, { rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.73, resetsAt: future }, seven_day: { utilization: 0.79, resetsAt: past } } } })
    const usage = (await service.list()).find((item) => item.profileId === claude.id)!
    expect(usage.windows.map((window) => [window.id, window.usedPercent])).toEqual([['five_hour', 73], ['seven_day', 0]])
    expect(usage.windows[0]!.resetsAt).toBe(new Date(future * 1000).toISOString()); expect(usage.windows[1]!.resetsAt).toBeNull()
    service.recordClaude(claude.id, { rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.8, resetsAt: future } } } })
    expect((await service.list()).find((item) => item.profileId === claude.id)!.windows[0]!.usedPercent).toBe(80)
    service.recordClaude(claude.id, { nada: true })
    database.close()
  })
})
