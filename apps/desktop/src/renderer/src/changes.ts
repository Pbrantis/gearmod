import type { GitSnapshot } from '@agentboard/contracts'

export interface FileChange { path: string; added: number; removed: number; diff: string; untracked?: boolean }

/** Separa o diff do snapshot por arquivo e conta linhas; arquivos novos ainda não rastreados vêm do status (`??`). */
export function parseChanges(snapshot: GitSnapshot): FileChange[] {
  const files: FileChange[] = []
  for (const chunk of snapshot.diff.split(/^(?=diff --git )/m)) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk)
    if (!header) continue
    let added = 0, removed = 0
    for (const line of chunk.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++
      else if (line.startsWith('-') && !line.startsWith('---')) removed++
    }
    files.push({ path: header[2]!.trim(), added, removed, diff: chunk.replace(/\n## [^\n]*\n?$/, '').trimEnd() })
  }
  for (const line of snapshot.status.split('\n')) {
    const untracked = /^\?\? (.+)$/.exec(line.trim())
    if (untracked) files.push({ path: untracked[1]!, added: 0, removed: 0, diff: '', untracked: true })
  }
  return files
}
