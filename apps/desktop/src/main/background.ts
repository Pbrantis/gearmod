/**
 * Background: closing the window only hides the app in the tray (the agents keep running). Really quitting is through the tray icon
 * and, with an agent working, asks for confirmation because the agent processes die along with the app.
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
