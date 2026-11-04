import { useSyncExternalStore } from 'react'
import { plainError } from './NoticeDialog'

export interface VoiceInstall { installing: boolean; item: string; percent: number | null; megabytes: number; done: boolean; error: string }

let state: VoiceInstall = { installing: false, item: '', percent: null, megabytes: 0, done: false, error: '' }
const listeners = new Set<() => void>()
let listening = false
const set = (patch: Partial<VoiceInstall>): void => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()) }

/** The download continues in main even if the chat closes; this state is app-wide and feeds the sidebar bar. */
function listen(): void {
  if (listening) return
  listening = true
  window.gearmod.onRunEvent((event) => {
    if (event.eventType !== 'voice/progress') return
    const { item, received, total } = event.payload as { item: string | null; received?: number; total?: number | null }
    if (item) set({ installing: true, item, percent: total ? Math.round(((received ?? 0) / total) * 100) : null, megabytes: Math.round((received ?? 0) / 1048576) })
  })
}

export async function startVoiceInstall(): Promise<void> {
  listen()
  if (state.installing) return
  set({ installing: true, done: false, error: '', item: '', percent: null })
  try { await window.gearmod.invoke('voice:install', undefined); set({ installing: false, done: true, percent: 100 }) }
  catch (reason) { set({ installing: false, error: plainError(reason) }) }
}

/** Notifies open chats that the dictation mode or the key changed, so they do not keep the old status. */
export const notifyVoiceChanged = (): void => { window.dispatchEvent(new Event('gearmod:voice-changed')) }

export const dismissVoiceInstall = (): void => set({ done: false, error: '' })

export function useVoiceInstall(): VoiceInstall {
  return useSyncExternalStore((callback) => { listen(); listeners.add(callback); return () => { listeners.delete(callback) } }, () => state)
}
