import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentAdapter, AgentRunOptions } from './adapters'
import { ConversationRepository } from './conversations'
import { AppDatabase } from './database'
import { AgentOrchestrator } from './orchestrator'
import { ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'
import type { WorktreeService } from './worktrees'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }

describe('anexos no chat', () => {
  it('põe os caminhos no pedido, descarta os que não existem e passa a lista ao agente', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-attach-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const profile = profiles.list()[0]!
    const project = await new ProjectRepository(database, git).create({ name: 'P', localPath: root, baseBranch: 'dev', profileIds: [profile.id] })
    const conversations = new ConversationRepository(database)
    const chat = conversations.createChat({ projectId: project.id, cardId: null, purpose: 'free', profileId: profile.id })
    const file = join(root, 'requisitos.md'); await writeFile(file, '# Requisitos')
    const calls: AgentRunOptions[] = []
    const fake: AgentAdapter = { run: async (options) => { calls.push(options); return { sessionId: 's', turnId: null, text: 'li', status: 'completed', error: null } } } as AgentAdapter
    const orchestrator = new AgentOrchestrator(conversations, { codex: fake, claude: fake, gemini: fake }, () => undefined, {} as WorktreeService, 1)

    expect(() => orchestrator.start({ chatId: chat.id, prompt: 'oi', planning: true, attachments: [join(root, 'nao-existe.txt')] })).toThrow('Nenhum dos arquivos')
    orchestrator.start({ chatId: chat.id, prompt: 'Resuma', planning: true, attachments: [file, join(root, 'nao-existe.txt'), file] })
    for (let i = 0; i < 50 && !calls.length; i += 1) await new Promise((resolve) => setTimeout(resolve, 10))

    expect(calls[0]!.attachments).toEqual([file])
    expect(calls[0]!.prompt).toContain(`- ${file}`)
    expect(conversations.listMessages(chat.id).find((message) => message.role === 'user')!.body).toContain('Arquivos anexados')
    // Espera o orquestrador gravar o fim da execução antes de fechar o banco.
    for (let i = 0; i < 50 && !conversations.listMessages(chat.id).some((message) => message.role === 'assistant'); i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    await new Promise((resolve) => setTimeout(resolve, 20))
    database.close()
  })
})
