import type { GitRunner } from '../worktrees'

/**
 * G15 (`07` §9) — uncommitted local change, in the repository's open checkout (not in the card's worktree: that is
 * another case, handled by the card's own commit flow). `local-dirty` state, separate from `in-sync|ahead|behind|
 * diverged` (G04): the app never mixes this local version with the branch's — it only signals it, through the banner "the agent is reading
 * the version of branch `<baseRef>`", with the actions view diff / commit (Git Manager) / ignore.
 */
export async function localDirty(git: GitRunner, repoDir: string, path: string): Promise<boolean> {
  const result = await git.run(['-C', repoDir, 'status', '--porcelain', '--', path]).catch(() => ({ stdout: '' }))
  return result.stdout.trim().length > 0
}
