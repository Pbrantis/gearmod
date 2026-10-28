import { useCallback, useState } from 'react'
export type Preferences = { tree: boolean; treeSide: 'left' | 'right'; tabs: boolean; autosave: boolean; indent: boolean; wrap: boolean; guides: boolean; whitespace: boolean; beyond: boolean; tabSize: number; diffLayout: 'unified' | 'split'; previewTabs: boolean }
export const defaults: Preferences = { tree: true, treeSide: 'left', tabs: true, autosave: false, indent: true, wrap: true, guides: false, whitespace: false, beyond: false, tabSize: 2, diffLayout: 'unified', previewTabs: true }
export const readPreferences = (): Preferences => { try { const saved = JSON.parse(localStorage.getItem('agentboard.filePreferences') ?? '{}'); const migrated = localStorage.getItem('agentboard.fileTreeLeftV2') === '1'; localStorage.setItem('agentboard.fileTreeLeftV2', '1'); return { ...defaults, ...saved, treeSide: migrated ? saved.treeSide ?? 'left' : 'left' } } catch { return defaults } }
/** Preferências do editor (as mesmas no modo Arquivos e no painel do chat); `change` grava na hora. */
export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  const [preferences, setPreferences] = useState(readPreferences)
  const change = useCallback((patch: Partial<Preferences>): void => setPreferences((value) => { const next = { ...value, ...patch }; try { localStorage.setItem('agentboard.filePreferences', JSON.stringify(next)) } catch { /* só vale nesta sessão */ } return next }), [])
  return [preferences, change]
}
