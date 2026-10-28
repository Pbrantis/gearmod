import { useEffect, useState } from 'react'
import type { AgentProfile } from '@agentboard/contracts'
import { isOutdated, useLatestVersions } from './toolUpdates'

/** Há versão nova de algum CLI (Claude ou Codex) dos agentes cadastrados: acende a bolinha na engrenagem de Configurações. */
export function useAgentUpdatesPending(profiles: AgentProfile[]): boolean {
  const latest = useLatestVersions(), [versions, setVersions] = useState<Record<string, { installed: boolean; version: string | null }>>({})
  useEffect(() => {
    const load = (): void => { void window.agentboard.invoke('profiles:probe-all', undefined).then((all) => setVersions(Object.fromEntries(all.map((probe) => [probe.profileId, { installed: probe.installed, version: probe.version ?? null }])))).catch(() => undefined) }
    load(); window.addEventListener('focus', load); return () => window.removeEventListener('focus', load)
  }, [profiles])
  return profiles.some((profile) => { const probe = versions[profile.id], last = latest?.versions[profile.provider as 'claude' | 'codex']; return Boolean(probe?.installed && last && isOutdated(probe.version, last)) })
}
