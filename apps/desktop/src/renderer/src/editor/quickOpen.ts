/** Letters of the file name that matched (indexes in `name`), to highlight in the list. */
export interface RankedPath { path: string; name: string; score: number; matched: number[] }

const isBoundary = (text: string, index: number): boolean => index === 0 || /[/\\\-_. ]/.test(text[index - 1]!) || (text[index]! !== text[index]!.toLowerCase() && text[index - 1]! === text[index - 1]!.toLowerCase())

/** Matches `query` as a subsequence of `text` (case-insensitive), preferring word starts; `null` if some letter does not appear. */
function match(text: string, query: string): { score: number; indices: number[] } | null {
  const lower = text.toLowerCase(), indices: number[] = []
  let at = 0, score = 0
  for (const letter of query) {
    let found = lower.indexOf(letter, at)
    if (found < 0) return null
    // If there is a word start just ahead, it is worth more than the first loose occurrence.
    for (let look = found; look >= 0 && look < Math.min(lower.length, found + 8); look = lower.indexOf(letter, look + 1)) if (isBoundary(text, look)) { found = look; break }
    const previous = indices.at(-1)
    score += 10 + (isBoundary(text, found) ? 15 : 0) + (previous !== undefined && found === previous + 1 ? 20 : 0) - Math.min(5, previous === undefined ? found : found - previous - 1)
    indices.push(found); at = found + 1
  }
  return { score, indices }
}

/**
 * Sorts paths for Ctrl+P: matching the file name is worth much more than matching only the folder; word starts and consecutive letters score,
 * recents get a bonus (the most recent, more). Paths that do not contain the letters in order are left out.
 */
export function rankPaths(query: string, paths: string[], recents: string[] = []): RankedPath[] {
  const needle = query.replace(/\s+/g, '').toLowerCase()
  const nameOf = (path: string): string => path.split(/[\\/]/).at(-1) ?? path
  if (!needle) return paths.map((path) => ({ path, name: nameOf(path), score: 0, matched: [] }))
  const ranked: RankedPath[] = []
  for (const path of paths) {
    const name = nameOf(path), inName = match(name, needle), inPath = inName ? null : match(path.replace(/\\/g, '/'), needle)
    if (!inName && !inPath) continue
    const recent = recents.indexOf(path), bonus = recent < 0 ? 0 : 30 - Math.min(recent, 29)
    const exact = name.toLowerCase().startsWith(needle) ? 40 : 0
    ranked.push({ path, name, score: (inName ? 1000 + inName.score + exact : inPath!.score) + bonus - path.length / 100, matched: inName?.indices ?? [] })
  }
  return ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
}

const key = (projectId: string): string => `gearmod.recentFiles.${projectId}`
/** Files opened recently in this project (most recent first, up to 30), stored in the browser. */
export function readRecents(projectId: string): string[] { try { const saved = JSON.parse(localStorage.getItem(key(projectId)) ?? '[]') as unknown; return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string').slice(0, 30) : [] } catch { return [] } }
/** Removes from the recents the paths that no longer exist on disk. */
export function dropRecents(projectId: string, gone: string[]): void { if (!gone.length) return; try { localStorage.setItem(key(projectId), JSON.stringify(readRecents(projectId).filter((item) => !gone.includes(item)))) } catch { /* only valid for this session */ } }
export function pushRecent(projectId: string, path: string): void { try { localStorage.setItem(key(projectId), JSON.stringify([path, ...readRecents(projectId).filter((item) => item !== path)].slice(0, 30))) } catch { /* only valid for this session */ } }
