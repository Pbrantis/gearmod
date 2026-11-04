import type { GitPolicy, GitRepo } from '@gearmod/contracts'

/** Project Git already loaded: the Git tab of Configure project opens instantly and refreshes behind the scenes. */
export const gitConfigEvent = 'gearmod:git-changed'
interface Cached { policy?: GitPolicy; repos?: GitRepo[] }
const cache = new Map<string, Cached>(), loading = new Map<string, Promise<boolean>>()

export const cachedGit = (projectId: string): Cached => cache.get(projectId) ?? {}
export const rememberGit = (projectId: string, patch: Cached): void => { cache.set(projectId, { ...cachedGit(projectId), ...patch }) }

/**
 * Looks for new repositories (created externally), reads the commit rule and stores everything. Runs when the project opens and whenever the Git tab
 * is opened; simultaneous calls share the same search. Returns whether the repository registry changed.
 */
export function refreshGit(projectId: string): Promise<boolean> {
  const running = loading.get(projectId)
  if (running) return running
  const job = Promise.all([window.gearmod.invoke('git:detect', { projectId }), window.gearmod.invoke('git:policy-get', { projectId })])
    .then(([found, policy]) => { rememberGit(projectId, { repos: found.repos, policy }); return found.changed })
    .finally(() => { loading.delete(projectId) })
  loading.set(projectId, job)
  return job
}
