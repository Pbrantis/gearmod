import { useSyncExternalStore } from 'react'
import { plainError } from './NoticeDialog'

export interface VoiceInstall { installing: boolean; item: string; percent: number | null; megabytes: number; done: boolean; error: string }

let state: VoiceInstall = { installing: false, item: '', percent: null, megabytes: 0, done: false, error: '' }
const listeners = new Set<() => void>()
let listening = false
const set = (patch: Partial<VoiceInstall>): void => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()) }

/** O download continua no main mesmo se o chat fechar; este estado é do app inteiro e alimenta a barra da barra lateral. */
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

/** Avisa os chats abertos que o modo de ditado ou a chave mudou, para não ficarem com o status antigo. */
export const notifyVoiceChanged = (): void => { window.dispatchEvent(new Event('gearmod:voice-changed')) }

export const dismissVoiceInstall = (): void => set({ done: false, error: '' })

export function useVoiceInstall(): VoiceInstall {
  return useSyncExternalStore((callback) => { listen(); listeners.add(callback); return () => { listeners.delete(callback) } }, () => state)
}
