/** Letras do nome do arquivo que bateram (índices em `name`), para destacar na lista. */
export interface RankedPath { path: string; name: string; score: number; matched: number[] }

const isBoundary = (text: string, index: number): boolean => index === 0 || /[/\\\-_. ]/.test(text[index - 1]!) || (text[index]! !== text[index]!.toLowerCase() && text[index - 1]! === text[index - 1]!.toLowerCase())

/** Casa `query` como subsequência de `text` (sem diferenciar maiúsculas), preferindo começos de palavra; `null` se alguma letra não aparece. */
function match(text: string, query: string): { score: number; indices: number[] } | null {
  const lower = text.toLowerCase(), indices: number[] = []
  let at = 0, score = 0
  for (const letter of query) {
    let found = lower.indexOf(letter, at)
    if (found < 0) return null
    // Se há um começo de palavra logo adiante, ele vale mais que a primeira ocorrência solta.
    for (let look = found; look >= 0 && look < Math.min(lower.length, found + 8); look = lower.indexOf(letter, look + 1)) if (isBoundary(text, look)) { found = look; break }
    const previous = indices.at(-1)
    score += 10 + (isBoundary(text, found) ? 15 : 0) + (previous !== undefined && found === previous + 1 ? 20 : 0) - Math.min(5, previous === undefined ? found : found - previous - 1)
    indices.push(found); at = found + 1
  }
  return { score, indices }
}

/**
 * Ordena caminhos para o Ctrl+P: bater no nome do arquivo vale muito mais que bater só na pasta, começo de palavra e letras seguidas pontuam,
 * recentes ganham um bônus (o mais recente, mais). Caminhos que não contêm as letras na ordem ficam de fora.
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

const key = (projectId: string): string => `agentboard.recentFiles.${projectId}`
/** Arquivos abertos há pouco neste projeto (mais recente primeiro, até 30), guardados no navegador. */
export function readRecents(projectId: string): string[] { try { const saved = JSON.parse(localStorage.getItem(key(projectId)) ?? '[]') as unknown; return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string').slice(0, 30) : [] } catch { return [] } }
/** Tira dos recentes os caminhos que já não existem no disco. */
export function dropRecents(projectId: string, gone: string[]): void { if (!gone.length) return; try { localStorage.setItem(key(projectId), JSON.stringify(readRecents(projectId).filter((item) => !gone.includes(item)))) } catch { /* só vale nesta sessão */ } }
export function pushRecent(projectId: string, path: string): void { try { localStorage.setItem(key(projectId), JSON.stringify([path, ...readRecents(projectId).filter((item) => item !== path)].slice(0, 30))) } catch { /* só vale nesta sessão */ } }
