import { mkdir, open, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

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

/** Todas as letras de `needle`, em ordem, dentro de `text` (busca "aproximada" do Ctrl+P; o ranking final é do renderer). */
const subsequence = (text: string, needle: string): boolean => { let at = 0; for (const letter of needle) { at = text.indexOf(letter, at); if (at < 0) return false; at++ } return true }

/** Busca arquivos por nome: contém o texto, ou (com `fuzzy`) tem as letras em ordem no caminho relativo à raiz, devolvendo mais candidatos para o renderer ordenar. */
export async function searchProjectFiles(roots: string[], query: string, fuzzy = false): Promise<{ paths: string[]; limited: boolean }> {
  const paths: string[] = [], pending = [...roots], visited = new Set<string>(), needle = query.toLocaleLowerCase().replace(/\s+/g, ''), cap = fuzzy ? 1500 : 200
  const real = await Promise.all(roots.map((root) => realpath(root).catch(() => root)))
  const relativeToRoot = (path: string): string => { const root = real.find((item) => path.startsWith(item)); return (root ? path.slice(root.length) : path).toLocaleLowerCase() }
  const excluded = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'coverage'])
  let count = 0
  while (pending.length && paths.length < cap && count < 5000) {
    const folder = pending.shift()!, real = await realpath(folder).catch(() => null)
    if (!real || visited.has(real)) continue
    visited.add(real); count++
    const entries = await listProjectDirectory(roots, folder).catch(() => [])
    for (const entry of entries) {
      if (entry.directory) { if (!excluded.has(entry.name)) pending.push(entry.path) }
      else if (fuzzy ? subsequence(relativeToRoot(entry.path), needle) : entry.path.toLocaleLowerCase().includes(needle)) { paths.push(entry.path); if (paths.length >= cap) break }
    }
  }
  return { paths, limited: pending.length > 0 || paths.length >= cap }
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

const reserved = /[\\/:*?"<>|\0]/
/** Uma parte de caminho (nome de arquivo ou pasta): sem caracteres proibidos no Windows, sem `.`/`..`, sem ponto ou espaço no fim. */
export function validateName(name: string): string {
  const clean = name.trim()
  if (!clean || clean === '.' || clean === '..') throw new Error('Informe um nome válido')
  if (clean.length > 255) throw new Error('O nome pode ter no máximo 255 caracteres')
  if (reserved.test(clean) || /[. ]$/.test(clean)) throw new Error('O nome não pode ter \\ / : * ? " < > | nem terminar com ponto ou espaço')
  return clean
}

/** A raiz em si (ou algo que a contenha) nunca é renomeada nem excluída. */
async function ensureNotRoot(roots: string[], target: string): Promise<void> {
  for (const root of roots) { const base = await realpath(root).catch(() => null); if (!base) continue; const rel = relative(target, base); if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('Não é possível alterar a pasta raiz do projeto') }
}

/** Cria arquivo ou pasta dentro de `parent`; `pasta/arquivo.ts` cria as pastas do meio. Nunca sobrescreve. */
export async function createProjectItem(roots: string[], parent: string, name: string, kind: 'file' | 'folder'): Promise<{ path: string }> {
  const folder = await allowedPath(roots, parent)
  if (!(await stat(folder)).isDirectory()) throw new Error('Escolha uma pasta para criar o item')
  const parts = name.trim().split('/').map(validateName)
  let current = folder
  for (const [index, part] of parts.entries()) {
    const next = join(current, part), last = index === parts.length - 1
    const existing = await stat(next).catch(() => null)
    if (last) {
      if (existing) throw new Error('Já existe um item com esse nome')
      if (kind === 'folder') await mkdir(next)
      else { const handle = await open(next, 'wx'); await handle.close() }
      return { path: next }
    }
    if (existing && !existing.isDirectory()) throw new Error('Já existe um arquivo com o nome de uma das pastas')
    if (!existing) await mkdir(next)
    current = await allowedPath(roots, next)
  }
  throw new Error('Informe um nome válido')
}

/** Troca só o nome do item, dentro da mesma pasta. */
export async function renameProjectItem(roots: string[], path: string, name: string): Promise<{ path: string }> {
  const target = await allowedPath(roots, path), clean = validateName(name)
  await ensureNotRoot(roots, target)
  const next = join(dirname(target), clean)
  if (next !== target && await stat(next).then(() => true, () => false) && next.toLowerCase() !== target.toLowerCase()) throw new Error('Já existe um item com esse nome')
  await rename(target, next)
  return { path: next }
}

/** Caminho validado de algo que pode ir para a Lixeira (nunca uma raiz). */
export async function trashablePath(roots: string[], path: string): Promise<string> {
  const target = await allowedPath(roots, path)
  await ensureNotRoot(roots, target)
  return target
}

const imageExtension: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const stamp = (date: Date): string => { const two = (value: number): string => String(value).padStart(2, '0'); return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}` }

/** Grava uma imagem colada numa subpasta `imagens/` ao lado do `.md` (`imagem-AAAAMMDD-HHMMSS.png`, com `-2`, `-3`... se já existir). */
export async function saveMarkdownImage(roots: string[], markdownPath: string, data: string, mime: string, now = new Date()): Promise<{ path: string; relative: string }> {
  const extension = imageExtension[mime]
  if (!extension) throw new Error('Tipo de imagem não suportado')
  const bytes = Buffer.from(data, 'base64')
  if (!bytes.length) throw new Error('Imagem vazia')
  if (bytes.length > 10_000_000) throw new Error('A imagem passa de 10 MB')
  const file = await allowedPath(roots, markdownPath), folder = join(dirname(file), 'imagens')
  await mkdir(folder, { recursive: true })
  await allowedPath(roots, folder)
  const base = `imagem-${stamp(now)}`
  for (let attempt = 1; attempt < 1000; attempt++) {
    const name = `${base}${attempt > 1 ? `-${attempt}` : ''}.${extension}`, target = join(folder, name)
    try { await writeFile(target, bytes, { flag: 'wx' }); return { path: target, relative: `imagens/${name}` } } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  throw new Error('Não foi possível escolher um nome para a imagem')
}
