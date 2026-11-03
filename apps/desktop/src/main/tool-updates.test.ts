import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isOutdated } from '@gearmod/contracts'
import { ToolUpdateService } from './tool-updates'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
const temp = async (): Promise<string> => { const dir = await mkdtemp(join(tmpdir(), 'gearmod-updates-')); dirs.push(dir); return join(dir, 'tool-versions.json') }
const answer = (url: string): unknown => url.includes('spec-kit') ? { tag_name: 'v0.7.2' } : { version: url.includes('claude-code') ? '2.0.20' : url.includes('codex') ? '0.51.0' : url.includes('gemini-cli') ? '0.66.0' : url.includes('openspec') ? '1.5.0' : '1.55.0' }

describe('isOutdated', () => {
  it('compara versões em formatos diferentes', () => {
    expect(isOutdated('2.0.14 (Claude Code)', '2.0.20')).toBe(true); expect(isOutdated('codex-cli 0.50.0', '0.51.0')).toBe(true); expect(isOutdated('v1.2.3', '1.2.3')).toBe(false)
    expect(isOutdated('1.10.0', '1.9.9')).toBe(false); expect(isOutdated('1.2.9', '1.10.0')).toBe(true); expect(isOutdated('2.0.0', '1.9.9')).toBe(false)
  })
  it('pré-lançamento', () => {
    expect(isOutdated('1.3.0-beta.1', '1.2.0')).toBe(false); expect(isOutdated('1.2.0-rc.1', '1.2.0')).toBe(true); expect(isOutdated('1.2.0', '1.3.0-beta.1')).toBe(true)
  })
  it('sem versão legível não avisa', () => { expect(isOutdated(null, '1.0.0')).toBe(false); expect(isOutdated('1.0.0', null)).toBe(false); expect(isOutdated('desconhecido', '1.0.0')).toBe(false) })
})

describe('ToolUpdateService', () => {
  it('busca no npm e no GitHub, guarda o cache e não busca de novo em 24 h', async () => {
    const file = await temp(), calls: string[] = []; let clock = Date.parse('2026-10-27T10:00:00Z')
    const service = new ToolUpdateService(file, async (url) => { calls.push(url); return answer(url) }, () => clock)
    const first = await service.latest()
    expect(first).toMatchObject({ checkedAt: '2026-10-27T10:00:00.000Z', error: null, versions: { claude: '2.0.20', codex: '0.51.0', gemini: '0.66.0', specify: '0.7.2', openspec: '1.5.0', playwright: '1.55.0' } })
    expect(calls).toHaveLength(6); expect(calls.some((url) => url.includes('%2F'))).toBe(true)
    clock += 3 * 3600_000; await service.latest(); expect(calls).toHaveLength(6)
    expect(JSON.parse(await readFile(file, 'utf8')).versions.specify).toBe('0.7.2')
    // Outra instância (app reaberto) lê o arquivo sem pedir de novo.
    await new ToolUpdateService(file, async (url) => { calls.push(url); return answer(url) }, () => clock).latest(); expect(calls).toHaveLength(6)
    clock += 25 * 3600_000; await service.latest(); expect(calls).toHaveLength(12)
    await service.latest(true); expect(calls).toHaveLength(18)
  })
  it('devolve o cache salvo sem consultar a rede', async () => {
    const file = await temp(), calls: string[] = []
    const first = new ToolUpdateService(file, async (url) => { calls.push(url); return answer(url) })
    await first.latest()
    const reopened = new ToolUpdateService(file, async (url) => { calls.push(url); return answer(url) })
    expect(reopened.cached().versions.specify).toBe('0.7.2')
    expect(calls).toHaveLength(6)
  })
  it('sem internet devolve o que tinha, com aviso, e tenta de novo na próxima', async () => {
    const file = await temp(); let online = true, clock = Date.parse('2026-10-27T10:00:00Z')
    const service = new ToolUpdateService(file, async (url) => { if (!online) throw new Error('offline'); return answer(url) }, () => clock)
    await service.latest(); online = false; clock += 30 * 3600_000
    const offline = await service.latest()
    expect(offline.error).toBe('Não foi possível verificar atualizações'); expect(offline.versions.claude).toBe('2.0.20'); expect(offline.checkedAt).toBe('2026-10-27T10:00:00.000Z')
    online = true; expect((await service.latest()).error).toBeNull()
  })
  it('primeira vez sem internet: versões nulas, sem exceção', async () => {
    const result = await new ToolUpdateService(await temp(), async () => { throw new Error('offline') }).latest()
    expect(result).toMatchObject({ checkedAt: null, error: 'Não foi possível verificar atualizações', versions: { claude: null, specify: null } })
  })
})
