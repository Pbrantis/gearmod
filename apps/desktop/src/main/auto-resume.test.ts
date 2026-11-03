import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UsageWindow } from '@gearmod/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { AutoResumeRepository, AutoResumeService, isUsageLimit, resumeTime, type PendingResume } from './auto-resume'
import { ConversationRepository } from './conversations'
import { AppDatabase } from './database'
import { BoardRepository, ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }
const now = Date.parse('2026-10-21T12:00:00Z')
const window = (usedPercent: number, resetsAt: string | null): UsageWindow => ({ id: 'five_hour', label: '5 h', usedPercent, resetsAt })

describe('retomar quando o limite de uso volta', () => {
  it('reconhece o erro de limite do Codex e do Claude, e não outros erros', () => {
    expect(isUsageLimit('{"codexErrorInfo":"usageLimitExceeded","message":"You\'ve hit your usage limit"}')).toBe(true)
    expect(isUsageLimit('Claude AI usage limit reached|1760000000')).toBe(true)
    expect(isUsageLimit("You've hit your session limit · resets 3pm")).toBe(true)
    expect(isUsageLimit('Claude exited (1): ENOENT')).toBe(false)
    expect(isUsageLimit(null)).toBe(false)
  })

  it('usa o horário do erro, senão o reset da janela cheia, sempre com um minuto de folga', () => {
    const epoch = Math.floor(now / 1000) + 3600
    expect(resumeTime(`Claude AI usage limit reached|${epoch}`, [], now)).toBe(epoch * 1000 + 60_000)
    expect(resumeTime('{"resets_in_seconds": 120}', [], now)).toBe(now + 120_000 + 60_000)
    const soon = '2026-10-21T13:00:00.000Z', week = '2026-10-25T00:00:00.000Z'
    expect(resumeTime('usage limit', [window(40, soon), { ...window(100, week), id: 'seven_day' }], now)).toBe(Date.parse(week) + 60_000)
    expect(resumeTime('usage limit', [window(40, soon)], now)).toBe(Date.parse(soon) + 60_000)
    expect(resumeTime('usage limit', [], now)).toBe(now + 15 * 60_000)
  })

  it('agenda, avisa, confere se voltou e retoma; desiste se o usuário já retomou', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-resume-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects)
    const profile = profiles.list()[0]!
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev', profileIds: [profile.id] })
    const card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[0]!.id, title: 'Card', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const conversations = new ConversationRepository(database)
    const chat = conversations.createChat({ projectId: project.id, cardId: card.id, purpose: 'execution', profileId: profile.id })
    const repository = new AutoResumeRepository(database)
    let windows: UsageWindow[] = [window(100, new Date(Date.now() + 3_600_000).toISOString())]
    const resumed: PendingResume[] = [], notes: string[] = []
    const service = new AutoResumeService({ repository, enabled: () => true, usage: async () => windows, resume: (item) => resumed.push(item), notify: (_chatId, body) => notes.push(body) })

    expect(await service.onFinished({ chatId: chat.id, cardId: card.id, purpose: 'execution', profileId: profile.id, status: 'failed', error: 'boom' })).toBeNull()
    const at = await service.onFinished({ chatId: chat.id, cardId: card.id, purpose: 'execution', profileId: profile.id, status: 'failed', error: 'usageLimitExceeded' })
    expect(at).toBe(Date.parse(windows[0]!.resetsAt!) + 60_000)
    expect(notes.at(-1)).toContain('retoma sozinho')
    expect(repository.pending()).toHaveLength(1)

    // Na hora, o limite ainda está cheio: reagenda em vez de retomar.
    const later = Date.now() + 3_700_000
    windows = [window(100, new Date(later + 600_000).toISOString())]
    await service.tick(later)
    expect(resumed).toHaveLength(0)
    expect(notes.at(-1)).toContain('ainda não voltou')
    expect(repository.pending()).toHaveLength(1)

    // Voltou: retoma uma vez só.
    windows = [window(0, null)]
    await service.tick(later + 700_000)
    expect(resumed).toMatchObject([{ chatId: chat.id, cardId: card.id, purpose: 'execution' }])
    await service.tick(later + 800_000)
    expect(resumed).toHaveLength(1)

    // O usuário retomou à mão antes da hora: a retomada automática é descartada.
    await service.onFinished({ chatId: chat.id, cardId: card.id, purpose: 'execution', profileId: profile.id, status: 'failed', error: 'usage limit' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    conversations.createRun({ cardId: card.id, chatId: chat.id, profileId: profile.id })
    await service.tick(Date.now() + 10 * 86_400_000)
    expect(resumed).toHaveLength(1)
    expect(repository.pending()).toHaveLength(0)
    database.close()
  })
})

describe('projetos na barra lateral', () => {
  it('reordena, põe o novo no topo e exclui (recusando com agente trabalhando)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gearmod-order-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const profile = profiles.list()[0]!
    const projects = new ProjectRepository(database, git)
    const a = await projects.create({ name: 'A', localPath: join(root, 'a'), profileIds: [profile.id] })
    const b = await projects.create({ name: 'B', localPath: join(root, 'b') })
    expect(projects.list().map((item) => item.name)).toEqual(['B', 'A'])
    expect(projects.reorder([a.id, b.id]).map((item) => item.name)).toEqual(['A', 'B'])
    await projects.update({ projectId: b.id, name: 'B2' })
    expect(projects.list().map((item) => item.name)).toEqual(['A', 'B2'])

    const conversations = new ConversationRepository(database)
    const chat = conversations.createChat({ projectId: a.id, cardId: null, purpose: 'free', profileId: profile.id })
    const run = conversations.createRun({ cardId: null, chatId: chat.id, profileId: profile.id })
    conversations.updateRun(run.id, 'running', null)
    expect(projects.list()[0]!.activity.running).toBe(1)
    expect(() => projects.delete(a.id)).toThrow('agente trabalhando')
    conversations.updateRun(run.id, 'completed', null)
    expect(projects.delete(a.id)).toBe(true)
    expect(projects.list().map((item) => item.name)).toEqual(['B2'])
    database.close()
  })
})
