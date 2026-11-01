import type { GitRunner } from '../worktrees'

/**
 * G15 (`07` §9) — alteração local não commitada, no checkout aberto do repositório (não na worktree do card: essa é
 * outro caso, resolvido pelo próprio fluxo de commit do card). Estado `local-dirty`, separado de `in-sync|ahead|behind|
 * diverged` (G04): o app nunca mistura essa versão local com a da branch — só sinaliza, pelo banner "o agente está lendo
 * a versão da branch `<baseRef>`", com ações ver diff / commitar (Git Manager) / ignorar.
 */
export async function localDirty(git: GitRunner, repoDir: string, path: string): Promise<boolean> {
  const result = await git.run(['-C', repoDir, 'status', '--porcelain', '--', path]).catch(() => ({ stdout: '' }))
  return result.stdout.trim().length > 0
}
