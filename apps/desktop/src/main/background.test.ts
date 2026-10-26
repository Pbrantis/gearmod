import { describe, expect, it } from 'vitest'
import { quitPrompt, trayTooltip } from './background'

describe('background', () => {
  it('only asks before quitting when an agent is working, and says what happens to it', () => {
    expect(quitPrompt(0)).toBeNull()
    expect(quitPrompt(1)).toMatchObject({ message: 'Um agente está trabalhando em segundo plano', confirm: 'Sair e encerrar' })
    expect(quitPrompt(1)!.detail).toContain('Continuar')
    expect(quitPrompt(3)!.message).toBe('3 agentes estão trabalhando em segundo plano')
    expect(quitPrompt(3)!.detail).toContain('essas execuções são encerradas')
  })

  it('shows how many agents are working in the tray tooltip', () => {
    expect(trayTooltip(0)).toBe('AgentBoard')
    expect(trayTooltip(1)).toBe('AgentBoard · 1 agente trabalhando')
    expect(trayTooltip(2)).toBe('AgentBoard · 2 agentes trabalhando')
  })
})
