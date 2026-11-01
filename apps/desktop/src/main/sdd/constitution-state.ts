import type { GitRunner } from '../worktrees'

export type ThreeWayState = 'in-sync' | 'ahead' | 'behind' | 'diverged' | 'missing'

/**
 * G04 (`02` §4.1, ADR-001 ponto 7) — estado do arquivo em 3 vias, por blob sha (não por histórico de commits):
 * `mergeBase` = blob no ancestral comum de card e base; `baseTip` = blob na ponta atual da base; `head` = blob na
 * worktree do card (ou na ref lida, sem worktree). `null` = arquivo não existe naquele ponto.
 *
 * - `missing`: não existe na worktree/ref do card agora.
 * - `in-sync`: igual à ponta da base — nada para trazer, nada para levar.
 * - `ahead`: o card mudou desde o ancestral comum, a base não mudou — o MR do card leva essa mudança.
 * - `behind`: a base mudou desde o ancestral comum, o card não mudou — "trazer da base" (merge/rebase) resolve.
 * - `diverged`: os dois mudaram desde o ancestral comum — precisa de decisão humana (merge/rebase), nunca automático.
 */
export function constitutionState(mergeBase: string | null, baseTip: string | null, head: string | null): ThreeWayState {
  if (head === null) return 'missing'
  if (head === baseTip) return 'in-sync'
  const headChanged = head !== mergeBase
  const baseChanged = baseTip !== mergeBase
  if (headChanged && !baseChanged) return 'ahead'
  if (!headChanged && baseChanged) return 'behind'
  return 'diverged'
}

/** Commit ancestral comum entre a branch do card (ou ref lida) e a base; `null` se as duas refs não tiverem histórico em comum. */
export async function mergeBaseCommit(git: GitRunner, repoDir: string, baseRef: string, headRef: string): Promise<string | null> {
  try { return (await git.run(['-C', repoDir, 'merge-base', baseRef, headRef])).stdout.trim() || null } catch { return null }
}
