import type { GitPolicy, GitRepo } from '@gearmod/contracts'

/** Git do projeto já carregado: a aba Git de Configurar projeto abre na hora e atualiza por baixo dos panos. */
export const gitConfigEvent = 'gearmod:git-changed'
interface Cached { policy?: GitPolicy; repos?: GitRepo[] }
const cache = new Map<string, Cached>(), loading = new Map<string, Promise<boolean>>()

export const cachedGit = (projectId: string): Cached => cache.get(projectId) ?? {}
export const rememberGit = (projectId: string, patch: Cached): void => { cache.set(projectId, { ...cachedGit(projectId), ...patch }) }

/**
 * Procura repositórios novos (criados por fora), lê a regra de commit e guarda tudo. Roda ao abrir o projeto e sempre que a aba Git
 * é aberta; chamadas simultâneas dividem a mesma busca. Devolve se o cadastro de repositórios mudou.
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
