import { themeSchema, type AppTheme } from '@gearmod/contracts'

const key = (projectId: string): string => `gearmod.projectTheme.${projectId}`
export const projectThemeEvent = 'gearmod:project-theme'

/** Theme chosen only for this project (empty = follows the app theme). Saved on this computer, the same for everyone who uses the app here. */
export function projectTheme(projectId: string | undefined): AppTheme | null {
  if (!projectId) return null
  try { return themeSchema.safeParse(localStorage.getItem(key(projectId))).data ?? null } catch { return null }
}

export function setProjectTheme(projectId: string, theme: AppTheme | null): void {
  try { if (theme) localStorage.setItem(key(projectId), theme); else localStorage.removeItem(key(projectId)) } catch { /* only valid for this session */ }
  window.dispatchEvent(new Event(projectThemeEvent))
}
