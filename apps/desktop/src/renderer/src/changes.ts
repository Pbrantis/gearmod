import type { GitSnapshot } from '@agentboard/contracts'

export interface FileChange { path: string; root?: string; added: number; removed: number; diff: string; untracked?: boolean }

function sections(text: string): Array<{ root?: string; body: string }> {
  const matches = [...text.matchAll(/^### AgentBoard root: (.+)\r?$/gm)]
  if (!matches.length) return [{ body: text }]
  return matches.map((match, index) => ({ root: match[1]!.trim(), body: text.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? text.length) }))
}

/** Separa o diff do snapshot por arquivo e conta linhas; arquivos novos ainda não rastreados vêm do status (`??`). */
export function parseChanges(snapshot: GitSnapshot): FileChange[] {
  const files: FileChange[] = []
  for (const section of sections(snapshot.diff)) {
    for (const chunk of section.body.split(/^(?=diff --git )/m)) {
      const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(chunk)
      if (!header) continue
      let added = 0, removed = 0
      for (const line of chunk.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) added++
        else if (line.startsWith('-') && !line.startsWith('---')) removed++
      }
      files.push({ path: header[2]!.trim(), root: section.root, added, removed, diff: chunk.trimEnd() })
    }
  }
  for (const section of sections(snapshot.status)) {
    for (const line of section.body.split('\n')) {
      const untracked = /^\?\? (.+)$/.exec(line.trim())
      if (untracked) files.push({ path: untracked[1]!, root: section.root, added: 0, removed: 0, diff: '', untracked: true })
    }
  }
  return files
}
