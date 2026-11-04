import { useEffect, useState } from 'react'
import type { AgentProfile } from '@gearmod/contracts'
import { isOutdated, useLatestVersions } from './toolUpdates'

/** There is a new version of some CLI (Claude or Codex) of the registered agents: lights up the dot on the Settings gear. */
export function useAgentUpdatesPending(profiles: AgentProfile[]): boolean {
  const latest = useLatestVersions(), [versions, setVersions] = useState<Record<string, { installed: boolean; version: string | null }>>({})
  useEffect(() => {
    const load = (): void => { void window.gearmod.invoke('profiles:probe-all', undefined).then((all) => setVersions(Object.fromEntries(all.map((probe) => [probe.profileId, { installed: probe.installed, version: probe.version ?? null }])))).catch(() => undefined) }
    load(); window.addEventListener('focus', load); return () => window.removeEventListener('focus', load)
  }, [profiles])
  return profiles.some((profile) => { const probe = versions[profile.id], last = latest?.versions[profile.provider as 'claude' | 'codex' | 'gemini']; return Boolean(probe?.installed && last && isOutdated(probe.version, last)) })
}
