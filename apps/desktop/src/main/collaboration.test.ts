import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentConfigRepository } from './agent-config'
import { CollaborationService, type FollowUp } from './collaboration'
import { ConversationRepository } from './conversations'
import { AppDatabase } from './database'
import { BoardRepository, ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-collab-')); roots.push(root)
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
  const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
  const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects), conversations = new ConversationRepository(database)
  const [codex, claude] = profiles.list()
  const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev', profileIds: [claude!.id, codex!.id] })
  const card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[2]!.id, title: 'Card', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
  const planning = conversations.createChat({ projectId: project.id, cardId: card.id, purpose: 'planning', profileId: claude!.id })
  const dev = conversations.createChat({ projectId: project.id, cardId: card.id, purpose: 'execution', profileId: codex!.id })
  const tester = conversations.createChat({ projectId: project.id, cardId: card.id, purpose: 'test', profileId: codex!.id })
  const started: FollowUp[] = []
  const collab = new CollaborationService(database, board, conversations, new AgentConfigRepository(database, board, profiles))
  collab.setStarter((action) => { started.push(action) })
  return { database, board, collab, card, planning, dev, tester, started, conversations }
}

describe('dúvidas entre as etapas', () => {
  it('sends a developer question to the planner after the dev run ends and resumes the dev with the answer', async () => {
    const { database, board, collab, card, planning, dev, started } = await setup()
    const question = collab.askQuestion({ cardId: card.id, chatId: dev.id, purpose: 'execution', question: 'Qual formato de data usar?' })
    expect(question).toMatchObject({ number: 1, status: 'open' })
    expect(board.documents.read(card.id, 'duvidas')).toContain('D001 · aberta'); expect(started).toHaveLength(0)
    collab.afterRun({ cardId: card.id, chatId: dev.id, purpose: 'execution', status: 'completed' })
    expect(started).toHaveLength(1); expect(started[0]).toMatchObject({ chatId: planning.id, planning: true }); expect(started[0]!.prompt).toContain('D001 (developer): Qual formato de data usar?')
    expect(collab.list(card.id).questions[0]!.status).toBe('planner')
    collab.answerFromPlanner(card.id, 1, 'Use ISO 8601.')
    collab.afterRun({ cardId: card.id, chatId: planning.id, purpose: 'planning', status: 'completed' })
    expect(started).toHaveLength(2); expect(started[1]).toMatchObject({ chatId: dev.id, planning: false }); expect(started[1]!.prompt).toContain('Answer (planner): Use ISO 8601.')
    expect(board.documents.read(card.id, 'duvidas')).toContain('respondida')
    collab.afterRun({ cardId: card.id, chatId: planning.id, purpose: 'planning', status: 'completed' })
    expect(started).toHaveLength(2)
    database.close()
  })

  it('escalates to the user when the planner asks, and resumes the tester after the user answers', async () => {
    const { database, collab, card, planning, tester, started } = await setup()
    collab.askQuestion({ cardId: card.id, chatId: tester.id, purpose: 'test', question: 'Posso apagar os dados de teste?' })
    collab.afterRun({ cardId: card.id, chatId: tester.id, purpose: 'test', status: 'completed' })
    collab.escalateToUser(card.id, 1, 'O usuário autoriza apagar os dados de teste?')
    collab.afterRun({ cardId: card.id, chatId: planning.id, purpose: 'planning', status: 'completed' })
    expect(started).toHaveLength(1)
    expect(collab.counts(card.id)).toEqual({ changes: 0, questions: 1, toSend: 0 })
    const [item] = collab.list(card.id).questions
    collab.answerByUser(item!.id, 'Pode, só no banco de teste.')
    expect(started).toHaveLength(2); expect(started[1]).toMatchObject({ chatId: tester.id, planning: false }); expect(started[1]!.prompt).toContain('Answer (user): Pode, só no banco de teste.')
    expect(collab.counts(card.id).questions).toBe(0)
    expect(() => collab.answerByUser(item!.id, 'de novo')).toThrow('não está esperando')
    database.close()
  })

  it('retries an unanswered question once and then sends it to the user', async () => {
    const { database, collab, card, planning, dev, started } = await setup()
    collab.askQuestion({ cardId: card.id, chatId: dev.id, purpose: 'execution', question: 'Dúvida?' })
    collab.afterRun({ cardId: card.id, chatId: dev.id, purpose: 'execution', status: 'completed' })
    collab.afterRun({ cardId: card.id, chatId: planning.id, purpose: 'planning', status: 'completed' })
    expect(started).toHaveLength(2); expect(started[1]!.prompt).toContain('not answered the questions')
    collab.afterRun({ cardId: card.id, chatId: planning.id, purpose: 'planning', status: 'completed' })
    expect(started).toHaveLength(2)
    expect(collab.list(card.id).questions[0]).toMatchObject({ status: 'user', userQuestion: 'Dúvida?' })
    database.close()
  })

  it('does not chain anything when the run did not complete and refuses planner self-questions', async () => {
    const { database, collab, card, planning, dev, started } = await setup()
    collab.askQuestion({ cardId: card.id, chatId: dev.id, purpose: 'execution', question: 'x?' })
    collab.afterRun({ cardId: card.id, chatId: dev.id, purpose: 'execution', status: 'interrupted' })
    expect(started).toHaveLength(0)
    expect(() => collab.askQuestion({ cardId: card.id, chatId: planning.id, purpose: 'planning', question: 'eu?' })).toThrow('does not ask itself')
    expect(() => collab.answerFromPlanner(card.id, 9, 'x')).toThrow('não encontrada')
    database.close()
  })
})

describe('mudanças que esperam autorização', () => {
  it('accept: the planner updates the documents, then the author resumes', async () => {
    const { database, board, collab, card, planning, dev, started } = await setup()
    const change = collab.proposeChange({ cardId: card.id, chatId: dev.id, purpose: 'execution', title: 'Cache de consultas', details: 'Adicionar cache em memória', reason: 'A tela fica lenta' })
    expect(change).toMatchObject({ number: 1, status: 'pending' }); expect(collab.counts(card.id).changes).toBe(1)
    expect(board.documents.read(card.id, 'mudancas')).toContain('M001 · Cache de consultas · aguardando sua autorização')
    collab.decideChange(change.id, 'accept')
    expect(started).toHaveLength(1); expect(started[0]).toMatchObject({ chatId: planning.id, planning: true }); expect(started[0]!.prompt).toContain('AUTHORIZED')
    expect(collab.counts(card.id).changes).toBe(0)
    collab.afterRun({ cardId: card.id, chatId: planning.id, purpose: 'planning', status: 'completed' })
    expect(started).toHaveLength(2); expect(started[1]).toMatchObject({ chatId: dev.id, planning: false }); expect(started[1]!.prompt).toContain('AUTHORIZED')
    expect(collab.list(card.id).changes[0]!.status).toBe('applied')
    expect(() => collab.decideChange(change.id, 'accept')).toThrow('já foi decidida')
    database.close()
  })

  it('reject goes straight back to the author; suggest needs a note and goes through the planner', async () => {
    const { database, collab, card, planning, tester, started } = await setup()
    const first = collab.proposeChange({ cardId: card.id, chatId: tester.id, purpose: 'test', title: 'Teste extra', details: 'Cobrir X', reason: 'Risco' })
    collab.decideChange(first.id, 'reject', 'Fora do escopo')
    expect(started).toHaveLength(1); expect(started[0]).toMatchObject({ chatId: tester.id, planning: false }); expect(started[0]!.prompt).toContain('REJECTED'); expect(started[0]!.prompt).toContain('Fora do escopo')
    const second = collab.proposeChange({ cardId: card.id, chatId: tester.id, purpose: 'test', title: 'Outro', details: 'Y', reason: 'Z' })
    expect(() => collab.decideChange(second.id, 'suggest')).toThrow('sua visão')
    collab.decideChange(second.id, 'suggest', 'Prefiro cobrir só o caso principal')
    expect(started[1]).toMatchObject({ chatId: planning.id, planning: true }); expect(started[1]!.prompt).toContain('Prefiro cobrir só o caso principal')
    collab.afterRun({ cardId: card.id, chatId: planning.id, purpose: 'planning', status: 'completed' })
    expect(started[2]!.prompt).toContain('different view')
    expect(() => collab.proposeChange({ cardId: card.id, chatId: planning.id, purpose: 'planning', title: 'a', details: 'b', reason: 'c' })).toThrow('developer and the tester')
    database.close()
  })
})
