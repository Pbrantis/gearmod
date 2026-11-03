import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Approval } from './approvals'
import { SpecKitRuntime, specKitSpecifyRequest, bindSpecKitFeature, specKitArtifacts, specKitAvailability, specKitCommand, specKitFeatureDir, specKitMissingSkill, specKitMode, specKitPermissionText, specKitStageOf, type SpecKitDeps } from './speckit'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'gearmod-speckit-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

const write = (path: string, text = '# x'): void => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text) }
const installSkills = (repo: string, provider: 'claude' | 'codex', stages = ['specify', 'plan', 'tasks', 'implement']): void => {
  mkdirSync(join(repo, '.specify'), { recursive: true })
  for (const stage of stages) write(join(repo, provider === 'claude' ? '.claude' : '.agents', 'skills', `speckit-${stage}`, 'SKILL.md'), `# ${stage}`)
}

function fakes(options: { method?: 'speckit' | 'native'; workflow?: string; configured?: boolean } = {}) {
  const repo = join(root, 'repo'), worktree = join(root, 'wt')
  mkdirSync(repo, { recursive: true }); mkdirSync(worktree, { recursive: true })
  const approvals: Approval[] = []
  const ready: string[] = []
  const deps: SpecKitDeps = {
    history: { sddMethod: () => options.method ?? 'speckit', workflow: () => options.workflow ?? 'sdd' },
    board: { card: () => ({ id: '12345678-aaaa', projectId: 'p1', title: 'Login com SSO' }), get: () => ({ columns: [{ id: 'c-todo', label: 'To do', semanticState: 'todo' }, { id: 'c-doing', label: 'Doing', semanticState: 'doing' }, { id: 'c-done', label: 'Done', semanticState: 'done' }] }), setSpecKitReady: (id, value) => { if (value) ready.push(id); else ready.length = 0 } },
    worktrees: { repositories: () => [{ repoPath: repo, path: worktree, status: 'active' }] },
    approvals: {
      request: (input) => { const item = { id: `a${approvals.length + 1}`, kind: input.kind, payload: input.payload, status: 'requested', note: null, cardId: input.cardId ?? null, projectId: input.projectId ?? null } as unknown as Approval; approvals.unshift(item); return item },
      list: () => approvals,
      decide: (id, approve, note) => { const item = approvals.find((entry) => entry.id === id)!; (item as { status: string }).status = approve ? 'approved' : 'denied'; (item as { note: string | null }).note = note ?? null; return item }
    },
    root: () => options.configured === false ? null : repo
  }
  mkdirSync(join(repo, '.specify'), { recursive: true })
  return { runtime: new SpecKitRuntime(deps), repo, worktree, approvals, ready }
}

describe('disponibilidade do método', () => {
  it('só habilita com a pasta configurada contendo .specify e explica quando não', () => {
    const message = 'Configure o Spec Kit nas configurações do projeto para habilitar este método.'
    expect(specKitAvailability(null)).toEqual({ enabled: false, reason: message })
    expect(specKitAvailability(root)).toEqual({ enabled: false, reason: message })
    mkdirSync(join(root, '.specify'))
    expect(specKitAvailability(root)).toEqual({ enabled: true, reason: null })
  })
})

describe('skills nativas por agente', () => {
  it('monta /speckit-* para o Claude e $speckit-* para o Codex', () => {
    expect(specKitCommand('claude', 'specify', ' login ')).toBe('/speckit-specify login')
    expect(specKitCommand('codex', 'plan', '')).toBe('$speckit-plan')
    expect(specKitStageOf('/speckit-tasks agora')).toBe('tasks')
    expect(specKitStageOf('$speckit-plan')).toBe('plan')
    expect(specKitStageOf('quero continuar')).toBeNull()
  })

  it('mostra a pasta esperada e como corrigir quando falta uma skill', () => {
    expect(specKitMissingSkill('claude', 'plan')).toContain('.claude/skills/speckit-plan/SKILL.md')
    expect(specKitMissingSkill('codex', 'plan')).toContain('.agents/skills/speckit-plan/SKILL.md')
    expect(specKitMissingSkill('codex', 'plan')).toContain('specify init --here')
  })
})

describe('textos e modos de permissão refletem cada agente', () => {
  it('Claude: manual pergunta a cada ação; livre aceita edições', () => {
    expect(specKitMode('claude', 'manual')).toBe('manual')
    expect(specKitMode('claude', 'free')).toBe('accept_edits')
  })
  it('Codex: manual é somente leitura com aprovação; livre é automático no sandbox', () => {
    expect(specKitMode('codex', 'manual')).toBe('read_only')
    expect(specKitMode('codex', 'free')).toBe('auto')
  })
  it('não promete aprovação individual no modo livre nem isolamento de pasta', () => {
    expect(specKitPermissionText('claude', 'free')).toMatch(/sem pedir a cada alteração/)
    expect(specKitPermissionText('claude', 'free')).toMatch(/Não há isolamento/)
    expect(specKitPermissionText('codex', 'free')).toMatch(/sem pedir/)
    expect(specKitPermissionText('codex', 'manual')).toMatch(/negação é respeitada/)
  })
})

describe('feature e artefatos do card', () => {
  it('amarra a feature por .specify/feature.json, sem depender do nome da branch', () => {
    bindSpecKitFeature(root, 'specs/12345678-login')
    expect(JSON.parse(readFileSync(join(root, '.specify', 'feature.json'), 'utf8'))).toEqual({ feature_directory: 'specs/12345678-login' })
    expect(() => bindSpecKitFeature(root, '../fora')).toThrow(/fora da worktree/)
    expect(specKitFeatureDir('12345678-aaaa', 'Login com SSO')).toBe('specs/12345678-login-com-sso')
  })

  it('pronto só com spec, plan e tasks da feature do card; ignora outras features', () => {
    const own = 'specs/12345678-login', other = 'specs/99999999-outra'
    for (const name of ['spec.md', 'plan.md', 'tasks.md']) write(join(root, other, name))
    expect(specKitArtifacts(root, own).ready).toBe(false)
    write(join(root, own, 'spec.md')); write(join(root, own, 'plan.md'))
    expect(specKitArtifacts(root, own)).toMatchObject({ plan: join(root, own, 'plan.md'), tasks: null, ready: false })
    write(join(root, own, 'tasks.md'), '   ')
    expect(specKitArtifacts(root, own).ready).toBe(false)
    write(join(root, own, 'tasks.md'), '- [ ] T001')
    expect(specKitArtifacts(root, own).ready).toBe(true)
  })
})

describe('pedido visível do specify', () => {
  it('leva entendimento e decisões do card para a skill nativa de cada agente', () => {
    const brief = { objetivo: 'Login com SSO', escopo: ['OIDC'], exclusoes: [], criterios: ['entra com Google'], pendencias: [] }
    const text = specKitSpecifyRequest('claude', { title: 'SSO', description: '' }, brief, [{ number: 3, statement: 'Usar OIDC' }])
    expect(text.startsWith('/speckit-specify Card: SSO')).toBe(true)
    expect(text).toContain('Goal: Login com SSO')
    expect(text).toContain('- D003 Usar OIDC')
    expect(specKitSpecifyRequest('codex', { title: 'SSO', description: 'x' }, null, []).startsWith('$speckit-specify')).toBe(true)
  })
  it('reconhece as etapas opcionais clarify, checklist e analyze', () => {
    expect(specKitStageOf('/speckit-clarify')).toBe('clarify')
    expect(specKitStageOf('$speckit-checklist')).toBe('checklist')
    expect(specKitStageOf('/speckit-analyze')).toBe('analyze')
  })
})

describe('SpecKitRuntime', () => {
  it('só é ativo no fluxo SDD com o método speckit', () => {
    expect(fakes().runtime.active('c')).toBe(true)
    expect(fakes({ method: 'native' }).runtime.active('c')).toBe(false)
    expect(fakes({ workflow: 'spec' }).runtime.active('c')).toBe(false)
    expect(fakes({ method: 'native' }).runtime.prepare({ cardId: 'c', provider: 'claude', prompt: 'x' })).toBeNull()
  })

  it('espera a escolha de permissão antes da primeira skill e oferece o cartão de escolha', () => {
    const { runtime, repo } = fakes(); installSkills(repo, 'claude')
    expect(runtime.permission('c')).toBeNull()
    expect(() => runtime.assertCanStart('c')).toThrow(/Escolha como as skills do Spec Kit/)
    expect(() => runtime.prepare({ cardId: 'c', provider: 'claude', prompt: 'quero login' })).toThrow(/Escolha como/)
    const request = runtime.permissionRequest('c')
    expect(request?.kind).toBe('speckit-permission')
    expect(runtime.permissionRequest('c')?.id).toBe(request?.id)
    runtime.choose('c', 'manual')
    expect(runtime.permission('c')).toBe('manual')
    expect(runtime.permissionRequest('c')).toBeNull()
    expect(() => runtime.assertCanStart('c')).not.toThrow()
  })

  it('não inicia sem o método configurado', () => {
    const { runtime } = fakes({ configured: false })
    expect(() => runtime.assertCanStart('c')).toThrow(/Configure o Spec Kit/)
  })

  it('troca de modo depois: vale a escolha mais recente', () => {
    const { runtime, repo, worktree } = fakes(); installSkills(worktree, 'codex'); void repo
    runtime.choose('c', 'manual'); expect(runtime.prepare({ cardId: 'c', provider: 'codex', prompt: 'x' })?.mode).toBe('read_only')
    runtime.choose('c', 'free'); expect(runtime.prepare({ cardId: 'c', provider: 'codex', prompt: 'x' })?.mode).toBe('auto')
  })

  it('prepara o run na worktree do card com a feature amarrada, sem reescrever o pedido do usuário', () => {
    const { runtime, worktree } = fakes(); installSkills(worktree, 'claude'); runtime.choose('c', 'free')
    const prepared = runtime.prepare({ cardId: 'c', provider: 'claude', prompt: '/speckit-specify quero login com SSO' })!
    expect(prepared.cwd).toBe(worktree)
    expect(prepared.prompt.startsWith('/speckit-specify quero login com SSO')).toBe(true)
    expect(prepared.env).toEqual({ SPECIFY_FEATURE_DIRECTORY: 'specs/12345678-login-com-sso' })
    expect(JSON.parse(readFileSync(join(worktree, '.specify', 'feature.json'), 'utf8')).feature_directory).toBe('specs/12345678-login-com-sso')
    const codex = fakes(); installSkills(codex.worktree, 'codex'); codex.runtime.choose('c', 'free')
    expect(codex.runtime.prepare({ cardId: 'c', provider: 'codex', prompt: 'conversa livre' })!.prompt).toBe('conversa livre')
  })

  it('skill ausente é erro claro, sem trocar de método nem fingir a execução', () => {
    const { runtime, worktree } = fakes(); installSkills(worktree, 'claude', ['plan']); runtime.choose('c', 'free')
    expect(() => runtime.prepare({ cardId: 'c', provider: 'claude', prompt: '/speckit-specify x' })).toThrow(/speckit-specify.*\.claude\/skills/s)
    expect(() => runtime.prepare({ cardId: 'c', provider: 'codex', prompt: '$speckit-plan' })).toThrow(/\.agents\/skills\/speckit-plan/)
    expect(runtime.active('c')).toBe(true)
  })

  it('não avança sozinho: depois de uma etapa só informa a próxima; o plan só roda quando pedido', () => {
    const { runtime, worktree, ready } = fakes(); installSkills(worktree, 'claude'); runtime.choose('c', 'free')
    const feature = join(worktree, 'specs/12345678-login-com-sso')
    write(join(feature, 'spec.md'))
    expect(runtime.afterRun({ cardId: 'c', prompt: '/speckit-specify x' })).toBeNull()
    expect(runtime.prepare({ cardId: 'c', provider: 'claude', prompt: 'continuar' })!.prompt).toBe('continuar')
    expect(ready).toEqual([])
    write(join(feature, 'plan.md')); write(join(feature, 'tasks.md'), '- [ ] T001')
    expect(runtime.afterRun({ cardId: 'c', prompt: '/speckit-tasks' })).toBeNull()
    expect(ready).toEqual(['c'])
    expect(runtime.artifacts('c').ready).toBe(true)
  })

  it('não cria cópias paralelas: só a pasta da feature e o feature.json existem', () => {
    const { runtime, worktree } = fakes(); installSkills(worktree, 'claude'); runtime.choose('c', 'free')
    runtime.prepare({ cardId: 'c', provider: 'claude', prompt: 'x' })
    expect(readdirSync(join(worktree, 'specs'))).toEqual(['12345678-login-com-sso'])
    expect(readdirSync(join(worktree, 'specs/12345678-login-com-sso'))).toEqual([])
    expect(existsSync(join(worktree, '.gearmod-card'))).toBe(false)
  })

  it('bloqueia speckit-implement no planejamento e nega qualquer permissão dela', () => {
    const { runtime, worktree } = fakes(); installSkills(worktree, 'claude'); runtime.choose('c', 'free')
    expect(() => runtime.prepare({ cardId: 'c', provider: 'claude', prompt: '/speckit-implement' })).toThrow(/chat de implementação/)
    expect(runtime.denies({ command: 'run skill speckit-implement' })).toBe(true)
    expect(runtime.denies({ command: 'git status' })).toBe(false)
  })

  it('cartão de movimentação: nada se move até a aprovação; vai para a coluna doing; a confirmação de início fica pendente até o botão de iniciar', () => {
    const { runtime, approvals } = fakes()
    const move = runtime.requestMove('c')
    expect(move.payload).toMatchObject({ columnId: 'c-doing', columnLabel: 'Doing' })
    expect(runtime.requestMove('c').id).toBe(move.id)
    expect(runtime.startRequest('c')).toBeNull()
    const start = runtime.requestStart('c')
    expect(start.kind).toBe('speckit-implement-start')
    expect(runtime.startRequest('c')?.id).toBe(start.id)
    runtime.settleStart('c')
    expect(runtime.startRequest('c')).toBeNull()
    expect(approvals.find((item) => item.id === start.id)?.status).toBe('approved')
  })
})
