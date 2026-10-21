import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationRepository } from './conversations'
import { AppDatabase } from './database'
import { ExecutionService } from './executions'
import { BoardRepository, ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-exec-')); roots.push(root)
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
  const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
  const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects), conversations = new ConversationRepository(database)
  const profile = profiles.list()[0]!
  const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev', profileIds: [profile.id] })
  const columns = board.get(project.id).columns
  const card = board.create({ projectId: project.id, columnId: columns[1]!.id, title: 'Executar', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
  const started: Array<{ chatId: string; prompt: string; planning: boolean }> = []
  const orchestrator = { start(input: { chatId: string; prompt: string; planning: boolean }) { started.push(input); const run = conversations.createRun({ cardId: card.id, chatId: input.chatId, profileId: profile.id }); conversations.updateRun(run.id, 'running', null); return { ...run, status: 'running' as const } } }
  return { database, board, conversations, projects, profile, project, columns, card, started, service: new ExecutionService(board, conversations, orchestrator) }
}

describe('ExecutionService', () => {
  it('Iniciar approves the plan, moves the card to Doing and reuses one execution chat per card', async () => {
    const { database, board, conversations, profile, columns, card, started, service } = await setup()
    board.documents.write(card.id, 'plano', '## Plano\nFazer')
    const run = service.start(card.id, { profileId: profile.id, model: null, effort: null, mode: 'auto' })
    expect(run.status).toBe('running')
    expect(board.card(card.id).columnId).toBe(columns[2]!.id)
    expect(conversations.listPlans(card.id)[0]).toMatchObject({ status: 'approved', contentMd: '## Plano\nFazer' })
    expect(started[0]).toMatchObject({ planning: false }); expect(started[0]!.prompt).toContain('Execute este card')
    expect(board.card(card.id).run).toMatchObject({ state: 'running', runId: run.id })
    expect(() => service.start(card.id, { profileId: profile.id, model: null, effort: null, mode: 'auto' })).toThrow('já tem um agente')
    conversations.updateRun(run.id, 'interrupted', 'Interrompido pelo usuário')
    expect(board.card(card.id).run.state).toBe('paused')
    service.resume(card.id)
    expect(conversations.listChats(board.card(card.id).projectId, card.id).filter((chat) => chat.purpose === 'execution')).toHaveLength(1)
    expect(started[1]!.chatId).toBe(started[0]!.chatId); expect(started[1]!.prompt).toContain('Continue de onde parou')
    database.close()
  })

  it('does not resume a card that never ran', async () => {
    const { database, card, service } = await setup()
    expect(() => service.resume(card.id)).toThrow('ainda não tem execução')
    database.close()
  })
})

describe('card run state', () => {
  it('highlights a finished run until the user views it and counts activity per project', async () => {
    const { database, board, conversations, projects, project, profile, card } = await setup()
    const chat = conversations.createChat({ projectId: project.id, cardId: card.id, purpose: 'execution', profileId: profile.id })
    expect(board.card(card.id).run.state).toBe('idle')
    const run = conversations.createRun({ cardId: card.id, chatId: chat.id, profileId: profile.id })
    conversations.updateRun(run.id, 'running', null)
    expect(projects.get(project.id).activity).toEqual({ running: 1, finished: 0 })
    conversations.updateRun(run.id, 'completed', null)
    expect(board.card(card.id).run.state).toBe('finished'); expect(projects.get(project.id).activity).toEqual({ running: 0, finished: 1 })
    expect(board.markViewed(card.id).run.state).toBe('idle'); expect(projects.get(project.id).activity).toEqual({ running: 0, finished: 0 })
    const planning = conversations.createChat({ projectId: project.id, cardId: card.id, purpose: 'planning', profileId: profile.id })
    const planningRun = conversations.createRun({ cardId: card.id, chatId: planning.id, profileId: profile.id })
    conversations.updateRun(planningRun.id, 'running', null)
    expect(board.card(card.id).run.state).toBe('planning')
    database.close()
  })
})
