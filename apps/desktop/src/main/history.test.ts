import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { complexityLevel, defaultComplexityLimits, defaultComplexityWeights, defaultWorkflowConfig, recommendedWorkflow, weightedTotal, type DimensionScores } from '@agentboard/contracts'
import { AgentContextService } from './agent-context'
import { AppDatabase } from './database'
import { CardHistoryService, readArtifactHistory, readHead, redact } from './history'
import { McpBridge } from './mcp-bridge'
import { BoardRepository, ProjectRepository } from './projects'
import { SettingsRepository } from './settings'
import { exportPlanArtifacts } from './workflows'

const roots: string[] = []
const closers: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const close of closers.splice(0)) await close(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

const low: DimensionScores = { escopo: 1, acoplamento: 0, incerteza: 1, risco: 0, novidade: 0, validacao: 1 }
const high: DimensionScores = { escopo: 3, acoplamento: 2, incerteza: 2, risco: 2, novidade: 1, validacao: 2 }

/** Repositório Git falso só com os arquivos que `readHead` lê (HEAD e a ref da branch). */
function fakeRepo(path: string, hash: string): void {
  mkdirSync(join(path, '.git', 'refs', 'heads'), { recursive: true })
  writeFileSync(join(path, '.git', 'HEAD'), 'ref: refs/heads/main\n'); writeFileSync(join(path, '.git', 'refs', 'heads', 'main'), `${hash}\n`)
}

async function setup(repos: string[] = ['frontend']) {
  const root = await mkdtemp(join(tmpdir(), 'agentboard-history-')); roots.push(root)
  for (const [index, name] of repos.entries()) fakeRepo(join(root, name), String(index + 1).repeat(40))
  const git = { validate: async () => undefined, branches: async () => ['main'], inspect: async (localPath: string) => ({ localPath, name: 'workspace', repositories: repos.map((name) => ({ localPath: join(root, name), name, currentBranch: 'main', branches: ['main'] })) }) }
  const database = new AppDatabase(join(root, 'db.sqlite'), '0.1.0'); await database.open(); closers.push(() => database.close())
  const projects = new ProjectRepository(database, git), board = new BoardRepository(database, projects)
  const project = await projects.create({ name: 'Workspace', localPath: root, baseBranch: 'main' })
  const card = board.create({ projectId: project.id, columnId: board.get(project.id).columns[1]!.id, title: 'Notificações push', description: '', type: 'feature', priority: 'medium', acceptanceCriteria: [] })
  const history = new CardHistoryService(database, join(root, 'data'))
  return { root, database, projects, board, project, card, history }
}

const assess = (history: CardHistoryService, cardId: string, scores: DimensionScores, extra: Partial<Parameters<CardHistoryService['assess']>[0]> = {}) =>
  history.assess({ cardId, scores, justifications: { escopo: 'Só o app' }, confidence: 'medium', preliminary: false, criticalRisks: [], evidence: [{ kind: 'file', ref: 'src/push.ts', detail: '', line: 3, commit: null }], trigger: 'initial', reason: 'Discovery', source: { actor: 'agent' }, ...extra })

describe('Complexity Engine', () => {
  it('soma notas × pesos, classifica pelos limites e nunca deixa risco máximo no fluxo curto', () => {
    expect(weightedTotal({ escopo: 3, acoplamento: 3, incerteza: 3, risco: 3, novidade: 3, validacao: 3 }, defaultComplexityWeights)).toBe(33)
    expect(complexityLevel(7, defaultComplexityLimits)).toBe('simple')
    expect(complexityLevel(8, defaultComplexityLimits)).toBe('medium')
    expect(complexityLevel(16, defaultComplexityLimits)).toBe('medium')
    expect(complexityLevel(17, defaultComplexityLimits)).toBe('complex')
    expect(recommendedWorkflow('simple', low)).toBe('light')
    expect(recommendedWorkflow('simple', { ...low, risco: 3 })).toBe('spec')
    expect(recommendedWorkflow('complex', high)).toBe('sdd')
  })

  it('versiona avaliações sem sobrescrever, recusa repetição e guarda correção do usuário como versão nova', async () => {
    const { history, card, board } = await setup()
    const first = assess(history, card.id, low, { preliminary: true, confidence: 'low' }).assessment
    expect(first).toMatchObject({ version: 1, total: 5, level: 'simple', workflow: 'light', preliminary: true, trigger: 'initial' })
    expect(first.codeVersion).toContain('frontend@111111111111')
    expect(first.evidence[0]!.commit).toContain('frontend@')
    expect(() => assess(history, card.id, low, { preliminary: true, confidence: 'low' })).toThrow(/já tem essas notas/)
    const second = assess(history, card.id, high, { trigger: 'new-dependency', reason: 'Backend precisa de fila' })
    expect(second.assessment).toMatchObject({ version: 2, total: 23, level: 'complex', trigger: 'new-dependency', supersedesId: first.id })
    expect(second.previous?.id).toBe(first.id)
    const contested = history.contest(card.id, { ...high, escopo: 1 }, 'O backend já tem o endpoint')
    expect(contested).toMatchObject({ version: 3, actor: 'user', trigger: 'user-correction', confidence: 'high' })
    expect(contested.justifications.escopo).toContain('Corrigido pelo usuário')
    expect(history.assessments(card.id).map((item) => item.total)).toEqual([5, 23, 19])
    expect(board.card(card.id).complexity).toMatchObject({ total: 19, level: 'complex', delta: -4, version: 3 })
    expect(history.events(card.id).map((event) => event.type)).toEqual(['assessment.created', 'assessment.revised', 'assessment.contested'])
  })

  it('registra o fluxo escolhido mesmo diferente do recomendado e substitui a escolha anterior', async () => {
    const { history, card } = await setup()
    assess(history, card.id, high)
    history.selectWorkflow(card.id, 'spec', { actor: 'user' }, 'Prefiro spec leve')
    history.selectWorkflow(card.id, 'sdd', { actor: 'user' })
    const decisions = history.decisions(card.id)
    expect(decisions.map((item) => [item.number, item.status, item.actor])).toEqual([[1, 'superseded', 'user'], [2, 'approved', 'user']])
    expect(history.workflow(card.id)).toBe('sdd')
    const selected = history.events(card.id).filter((event) => event.type === 'workflow.selected')
    expect(selected.map((event) => event.payload.followsRecommendation)).toEqual([false, true])
    const proposal = history.decide(card.id, { kind: 'technical', statement: 'Usar FCM', actor: 'agent' })
    expect(proposal.status).toBe('proposed')
    history.setDecision(proposal.id, 'approved')
    expect(history.decisions(card.id).find((item) => item.id === proposal.id)?.status).toBe('approved')
  })
})

describe('Artefatos versionáveis', () => {
  it('espelha eventos em history.jsonl sem duplicar e reconstrói o histórico só pelos arquivos', async () => {
    const { history, card, database } = await setup()
    assess(history, card.id, low)
    history.decide(card.id, { kind: 'scope', statement: 'Só Android', actor: 'user' })
    history.recordDiscovery(card.id, { objetivo: 'Avisar o usuário de pedidos novos', motivacao: '', escopo: ['App Android'], exclusoes: ['iOS'], criterios: ['Notificação chega em 5 s'], pendencias: [], contextoTecnico: '', prontidao: 'pronto' }, { actor: 'agent' })
    const dir = history.artifactsDir(card.id), file = join(dir, 'history.jsonl')
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(3)
    expect(readFileSync(join(dir, 'discovery.md'), 'utf8')).toContain('Avisar o usuário de pedidos novos')
    // App caiu depois de gravar e antes de marcar: a próxima reconciliação não duplica.
    database.db.prepare('UPDATE card_events SET synced_at = NULL').run()
    expect(history.reconcile()).toBe(1)
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(3)
    // Linha cortada no fim do arquivo é ignorada.
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"id":"cortad`)
    const fromFiles = readArtifactHistory(dir)
    expect(fromFiles.assessments.map((item) => item.total)).toEqual([5])
    expect(fromFiles.decisions.map((item) => item.statement)).toEqual(['Só Android'])
    // Banco perdeu o histórico (ex.: backup antigo restaurado): rebuild recria tudo a partir do arquivo.
    database.db.exec('DELETE FROM card_assessments; DELETE FROM card_decisions; DELETE FROM card_events;')
    expect(history.rebuild(card.id)).toEqual({ events: 3, assessments: 1, decisions: 1 })
    expect(history.rebuild(card.id)).toEqual({ events: 0, assessments: 0, decisions: 0 })
    expect(history.latest(card.id)?.total).toBe(5)
    expect(history.discovery(card.id)?.exclusoes).toEqual(['iOS'])
  })

  it('regrava na pasta nova quando a pasta de artefatos muda e não aceita caminho relativo', async () => {
    const { history, card, project, root } = await setup()
    assess(history, card.id, low)
    expect(() => history.setConfig(project.id, { ...defaultWorkflowConfig, artifactsDir: 'docs/cards' })).toThrow(/caminho absoluto/)
    const target = join(root, 'docs-repo', 'agentboard')
    history.setConfig(project.id, { ...defaultWorkflowConfig, artifactsDir: target })
    expect(history.artifactsDir(card.id).startsWith(target)).toBe(true)
    expect(readFileSync(join(history.artifactsDir(card.id), 'history.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
  })

  it('marca a exploração como desatualizada quando o HEAD de um repositório muda', async () => {
    const { history, card, root } = await setup(['frontend', 'backend'])
    history.recordExploration(card.id, { summary: 'Push fica em src/push', modules: ['push'], repositories: ['frontend'], evidence: [] }, { actor: 'agent' })
    expect(history.exploration(card.id)).toMatchObject({ stale: false, codeVersions: { frontend: '1'.repeat(40), backend: '2'.repeat(40) } })
    writeFileSync(join(root, 'backend', '.git', 'refs', 'heads', 'main'), `${'9'.repeat(40)}\n`)
    expect(history.exploration(card.id)?.stale).toBe(true)
    expect(readHead(join(root, 'nada'))).toBeNull()
  })

  it('tira segredos do que vai para os arquivos', async () => {
    expect(redact('chave sk-abcdefghijklmnop e ghp_abcdefghijklmnopqrstuvwxyz')).toBe('chave [redacted] e [redacted]')
    const { history, card } = await setup()
    history.decide(card.id, { kind: 'other', statement: 'Usar o token sk-1234567890abcdef', actor: 'user' })
    expect(readFileSync(join(history.artifactsDir(card.id), 'history.jsonl'), 'utf8')).not.toContain('sk-1234567890abcdef')
  })
})

describe('SDD central (cenários E, F e G)', () => {
  it('detecta o Spec Kit no repositório de documentação e grava o plano só lá, no formato nativo', async () => {
    const { history, board, card, project, root } = await setup(['docs', 'frontend', 'backend'])
    mkdirSync(join(root, 'docs', '.specify', 'templates'), { recursive: true }); mkdirSync(join(root, 'docs', '.claude', 'commands'), { recursive: true })
    writeFileSync(join(root, 'docs', '.claude', 'commands', 'speckit.specify.md'), '# specify')
    const detected = history.detect(project.id)
    expect(detected).toEqual([{ method: 'speckit', path: join(root, 'docs'), repository: 'docs', commands: ['.claude/commands/speckit.specify.md'] }])
    history.setConfig(project.id, { ...defaultWorkflowConfig, complexMethod: 'speckit' })
    for (const [kind, text] of [['especificacao', '# Spec'], ['plano', '# Plano'], ['tasks', '- [ ] T001 Fazer']] as const) board.documents.write(card.id, kind, text, 'agent')
    history.selectWorkflow(card.id, 'sdd', { actor: 'user' })
    const result = exportPlanArtifacts(history, board, card.id)
    const specDir = join(root, 'docs', 'specs', `${card.id.slice(0, 8)}-notificacoes-push`)
    expect(result.notices).toEqual([])
    expect(readFileSync(join(specDir, 'spec.md'), 'utf8')).toBe('# Spec\n')
    expect(existsSync(join(specDir, 'tasks.md'))).toBe(true)
    expect(existsSync(join(root, 'frontend', 'specs'))).toBe(false)
    expect(existsSync(join(root, 'frontend', '.specify'))).toBe(false)
    expect(existsSync(join(history.artifactsDir(card.id), 'plan.md'))).toBe(true)
    // Pasta de outro dono não é sobrescrita.
    writeFileSync(join(specDir, '.agentboard-card'), 'outro-card')
    expect(exportPlanArtifacts(history, board, card.id).notices[0]).toMatch(/não foi criada pelo AgentBoard/)
  })

  it('sem SDD, o fluxo curto produz só os artefatos mínimos na pasta gerenciada', async () => {
    const { history, board, card } = await setup()
    assess(history, card.id, low)
    history.selectWorkflow(card.id, 'light', { actor: 'user' })
    const result = exportPlanArtifacts(history, board, card.id)
    expect(result.written.filter((path) => path.includes(join('specs')))).toEqual([])
    expect(existsSync(join(history.artifactsDir(card.id), 'discovery.md'))).toBe(true)
  })
})

describe('Ferramentas MCP e contexto', () => {
  it('o agente avalia, escolhe o fluxo confirmado e o contexto do próximo turno traz o resumo', async () => {
    const { history, board, card, database } = await setup()
    const context = new AgentContextService(board, new SettingsRepository(database), null, undefined, undefined, history)
    const bridge = new McpBridge({ board, context, serverScript: 'unused', history })
    const changes: string[] = []
    const token = bridge.register('00000000-0000-4000-8000-000000000001', card.id, (change) => changes.push(change.type), { id: '00000000-0000-4000-8000-000000000002', purpose: 'planning' }).env.AGENTBOARD_TOKEN!
    const call = (tool: string, args: Record<string, unknown>) => (bridge as unknown as { handle(token: string, tool: string, args: Record<string, unknown>): { ok: boolean; text?: string; error?: string } }).handle(token, tool, args)
    expect(call('agentboard_avaliar_complexidade', { notas: { escopo: 4 }, confianca: 'alta', motivo: 'x' })).toMatchObject({ ok: false })
    const first = call('agentboard_avaliar_complexidade', { notas: { escopo: 1, acoplamento: 0, incerteza: 1, risco: 0, novidade: 0, validacao: 1 }, justificativas: { escopo: 'Um componente' }, confianca: 'media', motivo: 'Discovery inicial', evidencias: [{ tipo: 'file', referencia: 'src/App.tsx', linha: 10 }] })
    expect(first).toMatchObject({ ok: true }); expect(first.text).toContain('5 pontos')
    expect(call('agentboard_escolher_fluxo', { fluxo: 'light', confirmado_pelo_usuario: false })).toMatchObject({ ok: false })
    expect(call('agentboard_escolher_fluxo', { fluxo: 'light', confirmado_pelo_usuario: true })).toMatchObject({ ok: true })
    expect(board.card(card.id).type).toBe('minor')
    expect(call('agentboard_avaliar_complexidade', { notas: { escopo: 2, acoplamento: 2, incerteza: 1, risco: 1, novidade: 0, validacao: 1 }, confianca: 'alta', gatilho: 'user-correction', motivo: 'x' })).toMatchObject({ ok: false })
    expect(call('agentboard_avaliar_complexidade', { notas: { escopo: 2, acoplamento: 2, incerteza: 1, risco: 1, novidade: 0, validacao: 1 }, confianca: 'alta', gatilho: 'new-dependency', motivo: 'Descobri que o backend também muda' }).text).toContain('antes 5; +9')
    expect(call('agentboard_registrar_decisao', { decisao: 'Usar FCM', origem: 'agente', tipo: 'technical' })).toMatchObject({ ok: true })
    expect(changes.filter((type) => type === 'card').length).toBeGreaterThanOrEqual(4)
    const block = context.block(card.id)
    expect(block).toContain('Complexidade v2: 14 pontos, média')
    expect(block).toContain('fluxo escolhido: light')
    expect(block).toContain('[recomendação do agente, não aprovada] Usar FCM')
  })
})
