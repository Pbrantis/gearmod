import type { AppTheme } from '@agentboard/contracts'

const key = (projectId: string): string => `agentboard.projectTheme.${projectId}`
export const projectThemeEvent = 'agentboard:project-theme'

/** Tema escolhido só para este projeto (vazio = segue o tema do app). Fica salvo neste computador, igual para todo mundo que usa o app aqui. */
export function projectTheme(projectId: string | undefined): AppTheme | null {
  if (!projectId) return null
  try { const value = localStorage.getItem(key(projectId)); return value === 'green' || value === 'purple' || value === 'blue' || value === 'orange' ? value : null } catch { return null }
}

export function setProjectTheme(projectId: string, theme: AppTheme | null): void {
  try { if (theme) localStorage.setItem(key(projectId), theme); else localStorage.removeItem(key(projectId)) } catch { /* só vale nesta sessão */ }
  window.dispatchEvent(new Event(projectThemeEvent))
}
