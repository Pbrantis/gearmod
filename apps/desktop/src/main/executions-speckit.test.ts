import { describe, expect, it } from 'vitest'
import type { AgentConfig } from '@agentboard/contracts'
import { ExecutionService } from './executions'

function service(ready: boolean, provider: 'claude' | 'codex' = 'claude') {
  const started: Array<{ prompt: string; planning: boolean; notice?: string }> = [], moves: string[] = []
  const card = { id: 'c1', projectId: 'p1', type: 'major', columnId: 'todo', workspace: null, run: { state: 'idle' } }
  const board = { card: () => card, get: () => ({ columns: [{ id: 'doing', semanticState: 'doing' }] }), move: (_id: string, column: string) => { moves.push(column) }, documents: { read: () => '' }, baseBranch: () => null, setBaseBranch: () => undefined }
  const conversations = { listChats: () => [], purposeChat: () => ({ id: 'chat', provider }), approveCurrentPlan: () => null }
  const orchestrator = { start: (input: { prompt: string; planning: boolean; notice?: string }) => { started.push(input); return { id: 'run' } } }
  const speckit = { active: () => true, artifacts: () => ({ featureDir: 'specs/x', spec: null, plan: null, tasks: null, ready }) }
  return { started, moves, run: () => new ExecutionService(board as never, conversations as never, orchestrator as never, { set: () => undefined } as never, undefined, undefined, speckit as never).start('c1', { profileId: 'p' } as AgentConfig) }
}

describe('implementação com Spec Kit', () => {
  it('recusa iniciar sem spec, plan e tasks da feature do card', () => {
    const { run, started, moves } = service(false)
    expect(run).toThrow(/ainda não tem especificação, plano e tasks/)
    expect(started).toEqual([])
    expect(moves).toEqual([])
  })
  it('usa a skill nativa speckit-implement do agente escolhido, fora do planejamento', () => {
    const claude = service(true, 'claude'); claude.run()
    expect(claude.started).toMatchObject([{ prompt: '/speckit-implement', planning: false, notice: '▶ Usando a skill speckit-implement' }])
    const codex = service(true, 'codex'); codex.run()
    expect(codex.started[0]).toMatchObject({ prompt: '$speckit-implement', planning: false })
  })
})
