import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentContextService } from './agent-context'
import { ChecklistRepository } from './checklists'
import { ConstitutionRepository, constitutionIndex } from './constitution'
import { ConversationRepository } from './conversations'
import { AppDatabase } from './database'
import { McpBridge } from './mcp-bridge'
import { BoardRepository, ProfileRepository, ProjectRepository } from './projects'
import { SettingsRepository } from './settings'
import { seedProfiles } from './test-helpers'
import { ApprovalService } from './approvals'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }
type Reply = { ok: boolean; text?: string; error?: string }

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-law-')); roots.push(root)
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
  const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
  const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects)
  const profile = profiles.list()[0]!
  const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev', profileIds: [profile.id] })
  const card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[0]!.id, title: 'Card', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
  const conversations = new ConversationRepository(database), constitution = new ConstitutionRepository(database), checklists = new ChecklistRepository(database)
  const context = new AgentContextService(board, new SettingsRepository(database), null, constitution)
  // G09: without a real SddResolver/SddWriter (this test does not set up Git/worktree), the read falls back to legacy SQLite and the
  // write is faked — what matters here is the ROUTE decision (needs a card, not a purpose) and the right warning.
  const writes: Array<{ cardId: string; sourceId: string; relPath: string; content: string }> = []
  const sddResolver = { constitution: async () => ({ path: 'constitution.md', content: null, blobSha: null, baseBlobSha: null, headBlobSha: null, state: 'missing' as const, method: 'native' as const, via: 'ref' as const }), locate: async () => ({ repo: root, rootAbs: root, ref: 'dev', via: 'ref' as const, sourceId: 'source-1', method: 'native' as const, worktreeBranch: null }) }
  const sddWriter = { write: async (cardId: string, sourceId: string, relPath: string, content: string) => { writes.push({ cardId, sourceId, relPath, content }); return { blobSha: 'fakehash', path: relPath } } }
  const approvals = new ApprovalService(database)
  const bridge = new McpBridge({ board, context, serverScript: 'x', conversations, constitution, checklists, sddResolver, sddWriter, approvals })
  const call = (token: string, tool: string, args: Record<string, unknown> = {}): Promise<Reply> => Promise.resolve((bridge as unknown as { handle(token: string, tool: string, args: Record<string, unknown>): Reply | Promise<Reply> }).handle(token, tool, args))
  const open = (purpose: 'constitution' | 'execution' | 'test') => {
    const chat = conversations.createChat({ projectId: project.id, cardId: purpose === 'constitution' ? null : card.id, purpose, profileId: profile.id })
    const run = conversations.createRun({ cardId: chat.cardId, chatId: chat.id, profileId: profile.id })
    const changes: unknown[] = []
    return { chat, changes, token: bridge.register(run.id, chat.cardId, (change) => changes.push(change), { id: chat.id, purpose }).env.GEARMOD_TOKEN! }
  }
  return { root, database, project, card, constitution, checklists, context, call, open, writes, approvals }
}

describe('project Constitution', () => {
  it('G09: writing requires a card (not a purpose); the Constitution chat without a card creates one before saving', async () => {
    const { project, card, constitution, context, call, open, database, writes, approvals } = await setup()
    expect(await context.block(card.id)).toContain('has no Constitution yet')

    const law = open('constitution')
    // No card yet: the tool refuses and guides to create one, instead of writing straight to SQLite as before.
    expect(await call(law.token, 'gearmod_write_constitution', { markdown: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('Create a card') })
    const created = await call(law.token, 'gearmod_create_card', { titulo: 'Atualizar a Constituição' })
    expect(created).toMatchObject({ ok: true })
    expect(await call(law.token, 'gearmod_write_constitution', { markdown: '# Constituição\n\n### I. Testes primeiro\n- **DEVE** ter teste.' })).toMatchObject({ ok: true, text: expect.stringContaining('has not been changed yet') })
    expect(writes).toHaveLength(0); expect(approvals.list().find((item) => item.kind === 'constitution-apply')?.payload.content).toContain('Testes primeiro')
    expect(law.changes.map((item) => (item as { type: string }).type)).toContain('constitution')

    // Execution chat of an already existing card: also requires a card (it has one) — the fake SddResolver returns content:null, so it falls back to legacy.
    const dev = open('execution')
    expect(await call(dev.token, 'gearmod_read_constitution')).toMatchObject({ ok: true })
    expect(await call(dev.token, 'gearmod_propose_constitution', { titulo: 'Sem any', o_que_muda: 'Proibir any no TypeScript', motivo: 'Apareceu duas vezes' })).toMatchObject({ ok: true, text: expect.stringContaining('C001') })
    expect(constitution.proposals(project.id)).toMatchObject([{ number: 1, title: 'Sem any', status: 'pending', cardId: card.id }])
    database.close()
  })

  it('versions only when the text changes, imports from Spec Kit and sends only the index when it is long', async () => {
    const { root, project, card, constitution, context, database } = await setup()
    expect(constitution.state(project.id).importable).toBeNull()
    constitution.write(project.id, 'A', 'user'); constitution.write(project.id, 'A', 'user')
    expect(constitution.get(project.id).version).toBe(1)

    await mkdir(join(root, '.specify', 'memory'), { recursive: true })
    const long = `# Constituição\n\n### I. Primeiro\n${'texto '.repeat(1500)}\n\n### II. Segundo\nmais`
    await writeFile(join(root, '.specify', 'memory', 'constitution.md'), long)
    expect(constitution.state(project.id).importable).toContain('constitution.md')
    expect(constitution.importSpecKit(project.id).constitution).toMatchObject({ version: 2, updatedBy: 'user' })
    expect(constitutionIndex(long)).toBe('# Constituição\n### I. Primeiro\n### II. Segundo')
    // The agent's context reads the file (through the resolver), not SQLite.
    const fromFile = { constitution: async () => ({ path: 'constitution.md', content: long, blobSha: 'sha', baseBlobSha: 'sha', headBlobSha: 'sha', state: 'in-sync' as const, method: 'native' as const, via: 'ref' as const }) }
    const fileContext = new AgentContextService(context['board'], new SettingsRepository(database), null, constitution, undefined, undefined, undefined, fromFile)
    const block = await fileContext.block(card.id)
    expect(block).toContain('### II. Segundo')
    expect(block).toContain('gearmod_read_constitution')
    expect(block).not.toContain('texto texto')
    database.close()
  })

  it('the tester saves its checklist; the others do not', async () => {
    const { card, checklists, call, open, database } = await setup()
    const tester = open('test'), dev = open('execution')
    expect(await call(dev.token, 'gearmod_test_checklist', { markdown: '- [ ] a' })).toMatchObject({ ok: false })
    expect(await call(tester.token, 'gearmod_test_checklist', { markdown: 'sem itens' })).toMatchObject({ ok: false, error: expect.stringContaining('- [ ]') })
    expect(await call(tester.token, 'gearmod_test_checklist', { markdown: '- [x] Testes passam\n- [ ] Lint' })).toMatchObject({ ok: true })
    expect(tester.changes).toEqual([{ type: 'checklist' }])
    expect(checklists.get(card.id).contentMd).toBe('- [x] Testes passam\n- [ ] Lint')
    database.close()
  })
})
