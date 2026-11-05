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
  pending = request.then((result) => { publish(result); if (!force) refreshIfStale(result); return result })
  void pending.catch(() => { pending = null })
  return pending
}
const publish = (result: ToolVersions): void => { last = result; listeners.forEach((listener) => listener(result)) }
const dayMs = 24 * 60 * 60 * 1000
let refreshing = false
/**
 * The saved result is read first (instant). If it is more than 24 h old (or never existed), asks the main process to query the network in the
 * background (without `force`, it keeps its own 24 h limit and, offline, returns what it had). This is how the new-version warnings
 * (Claude, Codex, Spec Kit, Playwright CLI) show up without the user having to click "Check for updates".
 */
function refreshIfStale(current: ToolVersions): void {
  if (refreshing || (current.checkedAt && Date.now() - Date.parse(current.checkedAt) < dayMs)) return
  refreshing = true
  void window.gearmod.invoke('tools:latest', { force: false }).then((result) => { pending = Promise.resolve(result); publish(result) }).catch(() => undefined).finally(() => { refreshing = false })
}
// An app left open for days also checks again when the window comes back into focus.
if (typeof window !== 'undefined') window.addEventListener('focus', () => { if (last) refreshIfStale(last) })
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
