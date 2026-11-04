import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { nativeGit, type GitRunner, type WorktreeService } from '../worktrees'
import { tm } from '../i18n'

/** G08: `expect.blobSha` does not match the file's current blob — another edit happened between the read and this write. */
export class SddConflict extends Error {
  constructor(message: string, readonly expectedBlobSha: string | null, readonly actualBlobSha: string | null) { super(message) }
}

const reservedWindowsNames = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)/i

/**
 * Safe relative path inside `rootAbs`: no `..`, no absolute path, no reserved Windows name in any segment.
 * Returns the already resolved absolute path (lexically contained in `rootAbs`); the symlink check is separate
 * (`assertNoSymlinkEscape`), because it depends on the disk, not only on the path text.
 */
function allowedPath(rootAbs: string, relPath: string): string {
  const clean = relPath.replace(/\\/g, '/')
  if (!clean || isAbsolute(relPath) || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) throw new Error(tm().sdd.pathMustBeRelative)
  const segments = clean.split('/').filter(Boolean)
  if (!segments.length || segments.some((segment) => segment === '..' || segment === '.')) throw new Error(tm().sdd.pathNoDots)
  if (segments.some((segment) => reservedWindowsNames.test(segment))) throw new Error(tm().sdd.reservedWindowsName)
  const root = resolve(rootAbs), target = resolve(root, clean)
  const rootLower = root.toLowerCase(), targetLower = target.toLowerCase()
  if (targetLower !== rootLower && !targetLower.startsWith(`${rootLower}${sep}`)) throw new Error(tm().sdd.pathOutsideSddRoot)
  return target
}

/**
 * No already existing folder, between the file and the root (not including the root, which is trusted), may actually be
 * (via symlink) an exit from the SDD root. The loop always stops by the lexical path (the same one
 * `allowedPath` used to build `targetAbs`), never by the real path: on Windows, `realpath` can swap a short name
 * (`FRANCI~1`) for the long one even with no link at all, and comparing that with the root without the same treatment would stop outside it.
 */
async function assertNoSymlinkEscape(rootAbs: string, targetAbs: string): Promise<void> {
  const rootLexical = resolve(rootAbs).toLowerCase()
  let dir = dirname(targetAbs)
  for (let guard = 0; guard < 64; guard += 1) {
    if (dir.toLowerCase() === rootLexical) return
    if (existsSync(dir)) {
      const [real, rootReal] = await Promise.all([realpath(dir), realpath(rootAbs).catch(() => rootAbs)])
      const realLower = resolve(real).toLowerCase(), rootRealLower = resolve(rootReal).toLowerCase()
      if (realLower !== rootRealLower && !realLower.startsWith(`${rootRealLower}${sep}`)) throw new Error(tm().sdd.pathEscapesRoot)
    }
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

/** Git blob hash of a file's content, with no need for it to be staged or committed; `null` if the file does not exist. */
async function currentBlobSha(git: GitRunner, targetAbs: string): Promise<string | null> {
  if (!existsSync(targetAbs)) return null
  try { return (await git.run(['hash-object', targetAbs])).stdout.trim() || null } catch { return null }
}

/**
 * G08 — the only SDD write (the resolver, G03, is read-only). Writes only inside the card's worktree (never in the main
 * copy of the repository): ensures the repository is a member (`WorktreeService.ensureMember`, G07), validates the
 * path (`allowedPath` + symlink), checks for conflict by blob sha and writes with an atomic temp+rename.
 */
export class SddWriter {
  constructor(private readonly worktrees: Pick<WorktreeService, 'ensureMember'>, private readonly git: GitRunner = nativeGit) {}

  async write(cardId: string, sourceId: string, relPath: string, content: string, expect: { blobSha: string | null }): Promise<{ blobSha: string; path: string }> {
    const member = await this.worktrees.ensureMember(cardId, sourceId)
    if (member.status !== 'active') throw new Error(tm().sdd.cannotPrepareSddRepo(member.error ?? tm().common.unknownReason))
    const targetAbs = allowedPath(member.path, relPath)
    await assertNoSymlinkEscape(member.path, targetAbs)
    const current = await currentBlobSha(this.git, targetAbs)
    if (current !== expect.blobSha) throw new SddConflict(tm().sdd.constitutionChangedSinceRead, expect.blobSha, current)
    await mkdir(dirname(targetAbs), { recursive: true })
    const tempPath = `${targetAbs}.gearmod-tmp-${randomUUID()}`
    try {
      await writeFile(tempPath, content, 'utf8')
      await rename(tempPath, targetAbs)
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
    const blobSha = await currentBlobSha(this.git, targetAbs)
    if (!blobSha) throw new Error(tm().sdd.writeFailedNotOnDisk)
    return { blobSha, path: targetAbs }
  }
}
