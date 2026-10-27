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

export interface ChangeRoot { path: string; name: string; branch: string | null; worktree: boolean; primary: boolean }
export interface ChangeGroup { root: string | null; name: string; branch: string | null; worktree: boolean; added: number; removed: number; files: FileChange[] }
const keyOf = (path: string): string => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
/** Nome do repositório para mostrar: as pastas da worktree levam um prefixo numérico (`1-api`) que só serve para ordenar. */
const repoName = (root: { name: string; worktree: boolean }): string => root.worktree ? root.name.replace(/^\d+-/, '') : root.name

/** Agrupa os alterados por repositório: o principal primeiro, depois por nome. Sem `root` (repositório único) vira um grupo só, sem nome. */
export function groupChanges(changes: FileChange[], roots: ChangeRoot[]): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup & { primary: boolean }>()
  for (const change of changes) {
    const key = change.root ? keyOf(change.root) : '', match = change.root ? roots.find((root) => keyOf(root.path) === key) : undefined
    let group = groups.get(key)
    if (!group) {
      group = { root: change.root ?? null, name: match ? repoName(match) : change.root ? repoName({ name: change.root.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? change.root, worktree: true }) : '', branch: match?.branch ?? null, worktree: match?.worktree ?? false, added: 0, removed: 0, files: [], primary: match?.primary ?? false }
      groups.set(key, group)
    }
    group.added += change.added; group.removed += change.removed; group.files.push(change)
  }
  return [...groups.values()].sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name)).map((group): ChangeGroup => ({ root: group.root, name: group.name, branch: group.branch, worktree: group.worktree, added: group.added, removed: group.removed, files: group.files }))
}

/**
 * Rótulo de cada aba aberta: só o nome do arquivo, ou `repo › nome` quando há dois ou mais repositórios e o arquivo não é do principal,
 * ou quando duas abas têm o mesmo nome. Raízes que contêm outras (a pasta-mãe da worktree) não contam como repositório.
 */
export function tabLabels(paths: string[], roots: ChangeRoot[]): Record<string, { name: string; repo: string | null }> {
  const leaves = roots.filter((root) => !roots.some((other) => other !== root && keyOf(other.path).startsWith(`${keyOf(root.path)}/`))), many = leaves.length > 1
  const nameOf = (path: string): string => path.split(/[\\/]/).at(-1) ?? path
  const repoFor = (path: string): ChangeRoot | undefined => [...roots].sort((a, b) => b.path.length - a.path.length).find((root) => keyOf(path) === keyOf(root.path) || keyOf(path).startsWith(`${keyOf(root.path)}/`))
  const counts = new Map<string, number>()
  for (const path of paths) counts.set(nameOf(path), (counts.get(nameOf(path)) ?? 0) + 1)
  const result: Record<string, { name: string; repo: string | null }> = {}
  for (const path of paths) {
    const name = nameOf(path), root = repoFor(path), duplicated = (counts.get(name) ?? 0) > 1
    const show = root && ((many && !root.primary) || (duplicated && (many || !root.primary || leaves.length > 1)))
    result[path] = { name, repo: show && root ? repoName(root) : null }
  }
  return result
}

/** Alteração do card que corresponde a um caminho aberto (absoluto, com ou sem `root` na alteração). */
export function findChange(changes: FileChange[] | undefined, path: string): FileChange | undefined {
  const normal = path.replace(/\\/g, '/').toLowerCase()
  return changes?.find((item) => item.root ? normal === `${item.root.replace(/\\/g, '/').replace(/\/+$/, '')}/${item.path}`.toLowerCase() : normal.endsWith(`/${item.path.toLowerCase()}`))
}
