import { open, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, sep } from 'node:path'
import { allowedPath } from './file-viewer'
import type { GitRunner } from './worktrees'
import { tm } from './i18n'

export interface FileVersions { path: string; relative: string; root: string; before: string | null; after: string | null; baseLabel: string; binary: boolean; truncated: boolean }
const maxBytes = 1_000_000

/** Caminho permitido mesmo quando o arquivo foi apagado: resolve a pasta (a mais próxima que existe) e reanexa o resto. */
async function resolveTarget(roots: string[], requested: string): Promise<string> {
  try { return await allowedPath(roots, requested) } catch (error) {
    const parent = dirname(requested)
    if (parent === requested) throw error
    return join(await resolveTarget(roots, parent), basename(requested))
  }
}

/**
 * As duas versões do arquivo para o diff: "antes" vem do Git (`baseFor` dá a referência do card; sem ela, `HEAD`) e "depois" é o disco.
 * `null` num dos lados significa arquivo novo (`before`) ou apagado (`after`). Binário ou acima de 1 MB não manda conteúdo.
 */
export async function fileVersions(roots: string[], requested: string, options: { git: GitRunner; baseFor(repoTop: string): Promise<{ ref: string; label: string } | null> }): Promise<FileVersions> {
  const target = await resolveTarget(roots, requested)
  let folder = dirname(target)
  while (!await stat(folder).then((info) => info.isDirectory(), () => false)) { const up = dirname(folder); if (up === folder) break; folder = up }
  const top = await options.git.run(['-C', folder, 'rev-parse', '--show-toplevel']).then((result) => realpath(result.stdout.trim()), () => null)
  if (!top) throw new Error(tm().fileVersions.notInGitRepo)
  const path = relative(top, target).split(sep).join('/'), base = await options.baseFor(top) ?? { ref: 'HEAD', label: 'HEAD' }
  const shown = await options.git.run(['-C', top, 'show', `${base.ref}:${path}`]).then((result) => result.stdout, () => null)
  let after: string | null = null, binary = shown?.includes('\0') ?? false, truncated = shown !== null && Buffer.byteLength(shown) > maxBytes
  const info = await stat(target).catch(() => null)
  if (info?.isFile()) {
    if (info.size > maxBytes) truncated = true
    else {
      const handle = await open(target, 'r')
      try { const bytes = await handle.readFile(); if (bytes.includes(0)) binary = true; else after = bytes.toString('utf8') } finally { await handle.close() }
    }
  }
  const hide = binary || truncated
  return { path: target, relative: path, root: top, before: hide ? null : shown, after: hide ? null : after, baseLabel: base.label, binary, truncated }
}
