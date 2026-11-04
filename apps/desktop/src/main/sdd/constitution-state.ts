import type { GitRunner } from '../worktrees'

export type ThreeWayState = 'in-sync' | 'ahead' | 'behind' | 'diverged' | 'missing'

/**
 * G04 (`02` §4.1, ADR-001 point 7) — three-way file state, by blob sha (not by commit history):
 * `mergeBase` = blob at the common ancestor of card and base; `baseTip` = blob at the current tip of the base; `head` = blob in the
 * card's worktree (or at the ref read, with no worktree). `null` = the file does not exist at that point.
 *
 * - `missing`: does not exist in the card's worktree/ref now.
 * - `in-sync`: same as the base tip — nothing to bring in, nothing to take out.
 * - `ahead`: the card changed since the common ancestor, the base did not — the card's MR carries that change.
 * - `behind`: the base changed since the common ancestor, the card did not — "bring from base" (merge/rebase) fixes it.
 * - `diverged`: both changed since the common ancestor — needs a human decision (merge/rebase), never automatic.
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

/** Common ancestor commit between the card's branch (or the ref read) and the base; `null` if the two refs have no history in common. */
export async function mergeBaseCommit(git: GitRunner, repoDir: string, baseRef: string, headRef: string): Promise<string | null> {
  try { return (await git.run(['-C', repoDir, 'merge-base', baseRef, headRef])).stdout.trim() || null } catch { return null }
}
