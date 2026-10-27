import { useEffect, useState } from 'react'
import { isOutdated, type ToolVersions } from '@agentboard/contracts'

let pending: Promise<ToolVersions> | null = null
const listeners = new Set<(value: ToolVersions) => void>()
let last: ToolVersions | undefined

/** Últimas versões publicadas (cache de 24 h no processo principal); nunca trava a tela e falha em silêncio quando não há internet. */
export function loadLatest(force = false): Promise<ToolVersions> {
  if (!force && pending) return pending
  pending = window.agentboard.invoke('tools:latest', { force }).then((result) => { last = result; listeners.forEach((listener) => listener(result)); return result })
  void pending.catch(() => { pending = null })
  return pending
}
export function useLatestVersions(): ToolVersions | undefined {
  const [value, setValue] = useState(last)
  useEffect(() => { listeners.add(setValue); void loadLatest().then(setValue).catch(() => undefined); return () => { listeners.delete(setValue) } }, [])
  return value
}
/** Texto "há 3 h" do último checagem (ISO), ou vazio. */
export function checkedAgo(iso: string | null): string {
  if (!iso) return ''
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  return minutes < 1 ? 'agora há pouco' : minutes < 60 ? `há ${minutes} min` : minutes < 48 * 60 ? `há ${Math.round(minutes / 60)} h` : `há ${Math.round(minutes / 1440)} dias`
}
export { isOutdated }
