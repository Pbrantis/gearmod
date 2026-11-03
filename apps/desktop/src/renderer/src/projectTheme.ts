import { themeSchema, type AppTheme } from '@gearmod/contracts'

const key = (projectId: string): string => `gearmod.projectTheme.${projectId}`
export const projectThemeEvent = 'gearmod:project-theme'

/** Tema escolhido só para este projeto (vazio = segue o tema do app). Fica salvo neste computador, igual para todo mundo que usa o app aqui. */
export function projectTheme(projectId: string | undefined): AppTheme | null {
  if (!projectId) return null
  try { return themeSchema.safeParse(localStorage.getItem(key(projectId))).data ?? null } catch { return null }
}

export function setProjectTheme(projectId: string, theme: AppTheme | null): void {
  try { if (theme) localStorage.setItem(key(projectId), theme); else localStorage.removeItem(key(projectId)) } catch { /* só vale nesta sessão */ }
  window.dispatchEvent(new Event(projectThemeEvent))
}
