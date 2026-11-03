/**
 * Segundo plano: fechar a janela só esconde o app na bandeja (os agentes continuam). Sair de verdade é pelo ícone da bandeja
 * e, com agente trabalhando, pede confirmação porque os processos dos agentes morrem junto com o app.
 */
import { tm } from './i18n'

export interface QuitPrompt { message: string; detail: string; confirm: string; cancel: string }

export function quitPrompt(running: number): QuitPrompt | null {
  if (running <= 0) return null
  const many = running > 1
  return {
    message: many ? tm().background.manyWorking(running) : tm().background.oneWorking,
    detail: many ? tm().background.quitDetailMany : tm().background.quitDetailOne,
    confirm: tm().background.quitAndStop,
    cancel: tm().background.keepRunning
  }
}

export const hiddenNotice = { get title() { return tm().background.hiddenTitle }, get body() { return tm().background.hiddenBody } }

export function trayTooltip(running: number): string {
  return running > 0 ? `GearMod · ${tm().background.agentsWorking(running)}` : 'GearMod'
}
