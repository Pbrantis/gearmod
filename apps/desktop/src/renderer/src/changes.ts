import type { GitSnapshot } from '@gearmod/contracts'

export interface FileChange { path: string; root?: string; added: number; removed: number; diff: string; untracked?: boolean }

function sections(text: string): Array<{ root?: string; body: string }> {
  const matches = [...text.matchAll(/^### GearMod root: (.+)\r?$/gm)]
  if (!matches.length) return [{ body: text }]
  return matches.map((match, index) => ({ root: match[1]!.trim(), body: text.slice((match.index ?? 0) + match[0].length, matches[index + 1]?.index ?? text.length) }))
}

/** Splits the snapshot diff by file and counts lines; new untracked files come from the status (`??`). */
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
/** Repository name to display: worktree folders carry a numeric prefix (`1-api`) that only serves for ordering. */
const repoName = (root: { name: string; worktree: boolean }): string => root.worktree ? root.name.replace(/^\d+-/, '') : root.name

/** Groups the changed files by repository: the main one first, then by name. Without `root` (single repository) it becomes one unnamed group. */
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
 * Label for each open tab: just the file name, or `repo › name` when there are two or more repositories and the file is not from the main one,
 * or when two tabs have the same name. Roots that contain others (the worktree's parent folder) do not count as a repository.
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

/** Card change that matches an open path (absolute, with or without `root` on the change). */
export function findChange(changes: FileChange[] | undefined, path: string): FileChange | undefined {
  const normal = path.replace(/\\/g, '/').toLowerCase()
  return changes?.find((item) => item.root ? normal === `${item.root.replace(/\\/g, '/').replace(/\/+$/, '')}/${item.path}`.toLowerCase() : normal.endsWith(`/${item.path.toLowerCase()}`))
}
