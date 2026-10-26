/**
 * Segundo plano: fechar a janela só esconde o app na bandeja (os agentes continuam). Sair de verdade é pelo ícone da bandeja
 * e, com agente trabalhando, pede confirmação porque os processos dos agentes morrem junto com o app.
 */
export interface QuitPrompt { message: string; detail: string; confirm: string; cancel: string }

export function quitPrompt(running: number): QuitPrompt | null {
  if (running <= 0) return null
  const many = running > 1
  return {
    message: many ? `${running} agentes estão trabalhando em segundo plano` : 'Um agente está trabalhando em segundo plano',
    detail: `Se sair agora, ${many ? 'essas execuções são encerradas' : 'essa execução é encerrada'} e o card fica Pausado. Depois é só abrir o AgentBoard e clicar em Continuar: o agente retoma de onde parou.`,
    confirm: 'Sair e encerrar',
    cancel: 'Continuar em segundo plano'
  }
}

export const hiddenNotice = { title: 'O AgentBoard continua em segundo plano', body: 'Os agentes seguem trabalhando. Para sair, use o ícone perto do relógio.' }

export function trayTooltip(running: number): string {
  return running > 0 ? `AgentBoard · ${running === 1 ? '1 agente trabalhando' : `${running} agentes trabalhando`}` : 'AgentBoard'
}
