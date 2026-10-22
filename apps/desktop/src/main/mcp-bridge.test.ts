import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentContextService } from './agent-context'
import { AgentWriteback, titleFromPrompt } from './agent-writeback'
import { AppDatabase } from './database'
import { extractDocuments, McpBridge, type CardChange } from './mcp-bridge'
import { BoardRepository, ProjectRepository } from './projects'
import { SettingsRepository } from './settings'
import { AgentConfigRepository } from './agent-config'
import { CollaborationService, type FollowUp } from './collaboration'
import { ConversationRepository } from './conversations'
import { ProfileRepository } from './projects'
import { seedProfiles } from './test-helpers'

const roots: string[] = []
const closers: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
const git = { validate: async () => undefined, branches: async () => ['dev'], inspect: async (localPath: string) => ({ localPath, name: 'p', repositories: [] }) }
const serverScript = join(__dirname, '..', '..', 'resources', 'agentboard-mcp', 'server.mjs')

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-mcp-')); roots.push(root)
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
  const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects)
  const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev' })
  const columns = board.get(project.id).columns
  const card = board.create({ projectId: project.id, columnId: columns[1]!.id, title: 'MCP', description: 'Resumo', type: 'task', priority: 'medium', acceptanceCriteria: [] })
  const context = new AgentContextService(board, new SettingsRepository(database), null)
  const bridge = new McpBridge({ board, context, serverScript, runtime: process.execPath }); await bridge.listen()
  closers.push(async () => { await bridge.close(); database.close() })
  return { board, bridge, card, columns, project }
}

/** Cliente MCP mínimo que fala com o servidor stdio real, como o Claude e o Codex fazem. */
function mcpClient(endpoint: { command: string; args: string[]; env: Record<string, string> }) {
  const child = spawn(endpoint.command, endpoint.args, { env: { ...process.env, ...endpoint.env, ELECTRON_RUN_AS_NODE: '' }, stdio: ['pipe', 'pipe', 'pipe'] })
  closers.push(async () => { child.kill() })
  const pending = new Map<number, (message: Record<string, unknown>) => void>()
  createInterface({ input: child.stdout }).on('line', (line) => { const message = JSON.parse(line) as { id: number }; pending.get(message.id)?.(message as unknown as Record<string, unknown>) })
  let id = 0
  const request = (method: string, params?: unknown) => new Promise<Record<string, unknown>>((resolve) => { id += 1; pending.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`) })
  const call = async (name: string, args: unknown) => { const reply = await request('tools/call', { name, arguments: args }); return (reply.result as { content: Array<{ text: string }>; isError: boolean }) }
  return { request, call }
}

describe('AgentBoard MCP server', () => {
  it('lists the four tools and lets the agent read, write, check tasks and move the card with the run token', async () => {
    const { board, bridge, card, columns } = await setup()
    const changes: CardChange[] = []
    const client = mcpClient(bridge.register('run-1', card.id, (change) => changes.push(change)))
    const init = await client.request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe('agentboard')
    const listed = await client.request('tools/list')
    expect((listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual(['agentboard_contexto_do_card', 'agentboard_escrever_documento', 'agentboard_criar_card', 'agentboard_concluir_planejamento', 'agentboard_marcar_task', 'agentboard_atualizar_card', 'agentboard_propor_mudanca', 'agentboard_perguntar_ao_planejador', 'agentboard_responder_duvida', 'agentboard_pedir_ao_usuario', 'agentboard_mover_card'])

    expect((await client.call('agentboard_contexto_do_card', {})).content[0]!.text).toContain('"titulo": "MCP"')
    const bad = await client.call('agentboard_escrever_documento', { tipo: 'tasks', markdown: 'sem itens' })
    expect(bad.isError).toBe(true); expect(bad.content[0]!.text).toContain('T001')
    expect((await client.call('agentboard_escrever_documento', { tipo: 'tasks', markdown: '## Tasks\n- [ ] T001 Primeira\n  - [ ] Critério' })).isError).toBe(false)
    expect(board.documents.get(card.id).tasks.updatedBy).toBe('agent')
    expect((await client.call('agentboard_marcar_task', { linha: 2, feito: true })).isError).toBe(false)
    expect(board.card(card.id).tasks).toEqual({ done: 1, total: 1 })
    expect((await client.call('agentboard_atualizar_card', { titulo: 'Novo título', prioridade: 'urgent' })).isError).toBe(false)
    expect(board.card(card.id)).toMatchObject({ title: 'Novo título', priority: 'urgent', type: 'task', description: 'Resumo' })
    expect((await client.call('agentboard_atualizar_card', { tipo: 'invalido' })).isError).toBe(true)
    const moved = await client.call('agentboard_mover_card', { coluna: 'Doing', quando: 'agora' })
    expect(moved.content[0]!.text).toContain('Doing'); expect(board.card(card.id).columnId).toBe(columns[2]!.id)
    const refused = await client.call('agentboard_mover_card', { coluna: 'Done', quando: 'agora' })
    expect(refused.isError).toBe(true); expect(refused.content[0]!.text).toContain('teste aprovado')
    expect(changes.map((change) => change.type)).toEqual(['document', 'task', 'card', 'moved'])
    await client.call('agentboard_mover_card', { coluna: 'test', quando: 'ao_terminar' })
    expect(bridge.finish('run-1')).toEqual({ written: ['tasks'], pendingMove: columns[3]!.id })
  })

  it('rejects calls with an unknown token or after the run finished', async () => {
    const { bridge, card } = await setup()
    const endpoint = bridge.register('run-2', card.id, () => undefined)
    bridge.finish('run-2')
    const client = mcpClient(endpoint)
    const answer = await client.call('agentboard_contexto_do_card', {})
    expect(answer.isError).toBe(true); expect(answer.content[0]!.text).toContain('encerrada')
  })
})

describe('card title', () => {
  it('derives a short title from the first request', () => {
    expect(titleFromPrompt('quero criar um guia de instalação do agente. Mostrar passo a passo')).toBe('Quero criar um guia de instalação do agente')
    expect(titleFromPrompt('## Planeje **isto**\n\n```js\ncodigo\n```')).toBe('Planeje isto')
    expect(titleFromPrompt('a'.repeat(30) + ' ' + 'b'.repeat(30) + ' ' + 'c'.repeat(30)).endsWith('…')).toBe(true)
    expect(titleFromPrompt('   ')).toBe('')
  })

  it('names an untitled card after the first planning turn when the agent did not, and leaves named cards alone', async () => {
    const { board, bridge, card, project, columns } = await setup()
    const writeback = new AgentWriteback(board, bridge)
    const blank = board.create({ projectId: project.id, columnId: columns[1]!.id, title: '', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    writeback.begin('run-t', blank.id, () => undefined)
    const events: string[] = []
    writeback.finish({ runId: 'run-t', cardId: blank.id, planning: true, completed: true, text: 'ok', prompt: 'Quero planejar o painel de uso. Com Codex e Claude', publish: (type) => events.push(type) })
    expect(board.card(blank.id).title).toBe('Quero planejar o painel de uso'); expect(events).toContain('agentboard/card-updated')
    writeback.begin('run-n', card.id, () => undefined)
    writeback.finish({ runId: 'run-n', cardId: card.id, planning: true, completed: true, text: 'ok', prompt: 'Outro pedido qualquer', publish: () => undefined })
    expect(board.card(card.id).title).toBe('MCP')
  })
})

describe('Plano B and writeback', () => {
  it('extracts documents between markers', () => {
    const text = 'Pronto.\n<!-- agentboard:documento tipo=especificacao -->\n## Especificação\nTexto\n<!-- /agentboard:documento -->\n<!-- agentboard:documento tipo=invalido -->x<!-- /agentboard:documento -->'
    expect(extractDocuments(text)).toEqual([{ kind: 'especificacao', markdown: '## Especificação\nTexto' }])
  })

  it('applies marker documents, reports invalid Tasks and applies the deferred move after the run', async () => {
    const { board, bridge, card, columns } = await setup()
    const writeback = new AgentWriteback(board, bridge), events: string[] = []
    const endpoint = writeback.begin('run-3', card.id, (type) => events.push(type))
    const client = mcpClient(endpoint)
    await client.call('agentboard_mover_card', { coluna: 'To do', quando: 'ao_terminar' })
    const outcome = writeback.finish({ runId: 'run-3', cardId: card.id, planning: true, completed: true, publish: (type) => events.push(type), text: '<!-- agentboard:documento tipo=plano -->\n## Plano\nFazer\n<!-- /agentboard:documento -->\n<!-- agentboard:documento tipo=tasks -->\nsem itens\n<!-- /agentboard:documento -->' })
    expect(board.documents.read(card.id, 'plano')).toBe('## Plano\nFazer')
    expect(outcome.wroteDocuments).toBe(true); expect(outcome.notices[0]).toContain('tasks não foi gravado')
    expect(board.card(card.id).columnId).toBe(columns[1]!.id)
    expect(events).toContain('agentboard/card-updated')
    const another = writeback.begin('run-4', card.id, () => undefined)
    expect(another.env.AGENTBOARD_TOKEN).not.toBe(endpoint.env.AGENTBOARD_TOKEN)
    expect(board.card(card.id).hasPlan).toBe(false)
    expect((await mcpClient(another).call('agentboard_concluir_planejamento', {})).isError).toBe(true)
  })
})

describe('collaboration tools', () => {
  it('lets the developer ask and propose, the planner answer and escalate, and refuses the wrong role', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentboard-mcp-collab-')); roots.push(root)
    const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects), conversations = new ConversationRepository(database)
    const profile = profiles.list()[0]!
    const project = await projects.create({ name: 'P', localPath: root, baseBranch: 'dev', profileIds: [profile.id] })
    const card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[2]!.id, title: 'C', description: '', type: 'task', priority: 'low', acceptanceCriteria: [] })
    const dev = conversations.createChat({ projectId: project.id, cardId: card.id, purpose: 'execution', profileId: profile.id })
    const planning = conversations.createChat({ projectId: project.id, cardId: card.id, purpose: 'planning', profileId: profile.id })
    const started: FollowUp[] = []
    const collab = new CollaborationService(database, board, conversations, new AgentConfigRepository(database, board, profiles)); collab.setStarter((action) => { started.push(action) })
    const bridge = new McpBridge({ board, context: new AgentContextService(board, new SettingsRepository(database), null), serverScript, runtime: process.execPath, collab }); await bridge.listen()
    closers.push(async () => { await bridge.close(); database.close() })
    const developer = mcpClient(bridge.register('r-dev', card.id, () => undefined, { id: dev.id, purpose: 'execution' }))
    expect((await developer.call('agentboard_perguntar_ao_planejador', { pergunta: 'Qual lib de datas?' })).content[0]!.text).toContain('D001')
    expect((await developer.call('agentboard_propor_mudanca', { titulo: 'Cache', o_que_muda: 'Adicionar cache', motivo: 'Lento' })).content[0]!.text).toContain('M001')
    expect((await developer.call('agentboard_propor_mudanca', { titulo: 'só título' })).isError).toBe(true)
    expect((await developer.call('agentboard_responder_duvida', { numero: 1, resposta: 'x' })).isError).toBe(true)
    expect((await developer.call('agentboard_escrever_documento', { tipo: 'duvidas', markdown: 'x' })).isError).toBe(true)
    expect(board.card(card.id).pending).toEqual({ changes: 1, questions: 0 })
    collab.afterRun({ cardId: card.id, chatId: dev.id, purpose: 'execution', status: 'completed' })
    const planner = mcpClient(bridge.register('r-plan', card.id, () => undefined, { id: planning.id, purpose: 'planning' }))
    expect((await planner.call('agentboard_perguntar_ao_planejador', { pergunta: 'eu?' })).isError).toBe(true)
    expect((await planner.call('agentboard_propor_mudanca', { titulo: 'a', o_que_muda: 'b', motivo: 'c' })).isError).toBe(true)
    expect((await planner.call('agentboard_responder_duvida', { numero: 1, resposta: 'Use date-fns.' })).isError).toBe(false)
    expect((await planner.call('agentboard_pedir_ao_usuario', { numero: 1, pergunta: 'x' })).isError).toBe(true)
    collab.afterRun({ cardId: card.id, chatId: planning.id, purpose: 'planning', status: 'completed' })
    expect(started.map((action) => action.chatId)).toEqual([planning.id, dev.id]); expect(started[1]!.prompt).toContain('Use date-fns.')
  })
})
