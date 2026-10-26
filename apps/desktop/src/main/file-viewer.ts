import { open, readdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

export interface ProjectFile { path: string; relative: string; content: string; truncated: boolean; size: number; binary: boolean }

const maxBytes = 1_000_000

const inside = (root: string, target: string): boolean => { const rel = relative(root, target); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)) }

/** Resolve caminhos reais antes de listar ou gravar, inclusive quando há junctions no Windows. */
export async function allowedPath(roots: string[], requested: string): Promise<string> {
  if (requested.includes('\0')) throw new Error('Caminho inválido')
  for (const root of roots) {
    const base = await realpath(root).catch(() => null)
    if (!base) continue
    const target = await realpath(resolve(base, requested)).catch(() => null)
    if (target && inside(base, target)) return target
  }
  throw new Error('Caminho fora das pastas deste projeto')
}

export async function listProjectDirectory(roots: string[], path: string): Promise<Array<{ path: string; name: string; directory: boolean }>> {
  const directory = await allowedPath(roots, path)
  const entries = await readdir(directory, { withFileTypes: true })
  const visible = await Promise.all(entries.filter((entry) => entry.name !== '.git').map(async (entry) => {
    const full = resolve(directory, entry.name)
    try { const target = await allowedPath(roots, full), info = await stat(target); return { path: full, name: entry.name, directory: info.isDirectory() } } catch { return null }
  }))
  return visible.filter((entry): entry is NonNullable<typeof entry> => entry !== null).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
}

export async function searchProjectFiles(roots: string[], query: string): Promise<{ paths: string[]; limited: boolean }> {
  const paths: string[] = [], pending = [...roots], visited = new Set<string>(), needle = query.toLocaleLowerCase()
  const excluded = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage'])
  let count = 0
  while (pending.length && paths.length < 200 && count < 5000) {
    const folder = pending.shift()!, real = await realpath(folder).catch(() => null)
    if (!real || visited.has(real)) continue
    visited.add(real); count++
    const entries = await listProjectDirectory(roots, folder).catch(() => [])
    for (const entry of entries) {
      if (entry.directory) { if (!excluded.has(entry.name)) pending.push(entry.path) }
      else if (entry.path.toLocaleLowerCase().includes(needle)) { paths.push(entry.path); if (paths.length >= 200) break }
    }
  }
  return { paths, limited: pending.length > 0 || paths.length >= 200 }
}

/** Só grava texto completo e exige a versão lida: uma edição do agente nunca é sobrescrita silenciosamente. */
export async function writeProjectFile(roots: string[], path: string, content: string, expected: string): Promise<ProjectFile> {
  if (Buffer.byteLength(content) > maxBytes) throw new Error('Edição limitada a arquivos de até 1 MB')
  const target = await allowedPath(roots, path), handle = await open(target, 'r+')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxBytes) throw new Error('Este arquivo não pode ser editado')
    const bytes = await handle.readFile()
    if (bytes.includes(0)) throw new Error('Arquivo binário não pode ser editado')
    if (bytes.toString('utf8') !== expected) throw new Error('O arquivo mudou no disco. Reabra a versão atual antes de salvar; sua edição continua nesta aba.')
    const next = Buffer.from(content)
    let offset = 0
    while (offset < next.length) { const { bytesWritten } = await handle.write(next, offset, next.length - offset, offset); if (!bytesWritten) throw new Error('Não foi possível completar a gravação'); offset += bytesWritten }
    await handle.truncate(next.length)
  } finally { await handle.close() }
  return { path: target, relative: basename(target), content, truncated: false, size: Buffer.byteLength(content), binary: false }
}

/**
 * Lê um arquivo para o visualizador do chat. Só abre o que está dentro de uma das raízes (worktree do card e pasta do projeto),
 * seguindo links simbólicos, para o agente (ou um texto qualquer do chat) não conseguir apontar para fora do projeto.
 */
export async function readProjectFile(roots: string[], requested: string, exact = false): Promise<ProjectFile> {
  const clean = exact ? requested : requested.trim().replace(/^file:\/+/i, '').replace(/[?#].*$/, '').replace(/:\d+(?::\d+)?$/, '')
  if (!clean || clean.includes('\0')) throw new Error('Caminho de arquivo inválido')
  for (const root of roots) {
    let base: string
    try { base = await realpath(root) } catch { continue }
    const candidate = isAbsolute(clean) ? resolve(clean) : resolve(base, clean)
    let real: string
    try { real = await realpath(candidate) } catch { continue }
    if (!inside(base, real)) continue
    const info = await stat(real)
    if (!info.isFile()) continue
    const handle = await open(real, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(info.size, maxBytes)), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const bytes = buffer.subarray(0, bytesRead), binary = bytes.includes(0)
      return { path: real, relative: relative(base, real).split(sep).join('/'), content: binary ? '' : bytes.toString('utf8'), truncated: info.size > maxBytes, size: info.size, binary }
    } finally { await handle.close() }
  }
  throw new Error('Arquivo não encontrado neste projeto')
}
