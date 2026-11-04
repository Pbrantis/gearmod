import { useEffect, useState } from 'react'
import { isOutdated, type ToolVersions } from '@gearmod/contracts'
import { tr } from './i18n'

let pending: Promise<ToolVersions> | null = null
const listeners = new Set<(value: ToolVersions) => void>()
let last: ToolVersions | undefined

/** Latest published versions (24 h cache in the main process); never blocks the screen and fails silently when there is no internet. */
export function loadLatest(force = false): Promise<ToolVersions> {
  if (!force && pending) return pending
  const request = force ? window.gearmod.invoke('tools:latest', { force: true }) : window.gearmod.invoke('tools:cached', undefined)
  pending = request.then((result) => { last = result; listeners.forEach((listener) => listener(result)); return result })
  void pending.catch(() => { pending = null })
  return pending
}
export function useLatestVersions(): ToolVersions | undefined {
  const [value, setValue] = useState(last)
  useEffect(() => { listeners.add(setValue); void loadLatest().then(setValue).catch(() => undefined); return () => { listeners.delete(setValue) } }, [])
  return value
}
/** Text like "3 h ago" for the last check (ISO), or empty. */
export function checkedAgo(iso: string | null): string {
  if (!iso) return ''
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  const u = tr().settings.updates
  return minutes < 1 ? u.justNow : minutes < 60 ? u.minutesAgo(minutes) : minutes < 48 * 60 ? u.hoursAgo(Math.round(minutes / 60)) : u.daysAgo(Math.round(minutes / 1440))
}
export { isOutdated }
