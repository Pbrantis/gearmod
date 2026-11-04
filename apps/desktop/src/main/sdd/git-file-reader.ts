import { nativeGit, type GitRunner } from '../worktrees'
import { tm } from '../i18n'

/** G02 (`02` §4.2): typed error — the caller decides whether to show "reference not found" or treat it as "file missing". */
export class SddGitError extends Error {
  constructor(message: string, readonly code: 'ref-not-found' | 'git-error') { super(message) }
}

/**
 * Reads SDD files straight from Git (worktree or another ref), without the content going through SQLite. Each instance belongs to one
 * repository; `ref` can be a branch, tag or commit. Never writes (that is `SddWriter`, G08).
 */
export class GitFileReader {
  constructor(private readonly repoDir: string, private readonly git: GitRunner = nativeGit) {}

  /** `null` when the file does not exist at that ref (valid ref); throws `SddGitError` when the ref itself does not exist. */
  async blobSha(ref: string, path: string): Promise<string | null> {
    try {
      const result = await this.git.run(['-C', this.repoDir, 'rev-parse', '-q', '--verify', `${ref}:${normalize(path)}`])
      const sha = result.stdout.trim()
      return sha || null
    } catch {
      if (await this.refMissing(ref)) throw new SddGitError(tm().sdd.refNotFound(ref), 'ref-not-found')
      return null
    }
  }

  async exists(ref: string, path: string): Promise<boolean> { return (await this.blobSha(ref, path)) !== null }

  /** File content at that ref, byte for byte (CRLF/encoding preserved); `null` if it does not exist. */
  async show(ref: string, path: string): Promise<string | null> {
    const sha = await this.blobSha(ref, path)
    if (!sha) return null
    return (await this.git.run(['-C', this.repoDir, 'show', sha])).stdout
  }

  /** Names (relative to `dir`) of files and folders at the ref; empty list if the folder does not exist (valid ref). */
  async list(ref: string, dir: string): Promise<string[]> {
    try {
      const result = await this.git.run(['-C', this.repoDir, 'ls-tree', '--name-only', '-z', `${ref}:${dir ? normalize(dir) : '.'}`])
      return result.stdout.split('\0').filter(Boolean)
    } catch {
      if (await this.refMissing(ref)) throw new SddGitError(tm().sdd.refNotFound(ref), 'ref-not-found')
      return []
    }
  }

  private async refMissing(ref: string): Promise<boolean> {
    try { await this.git.run(['-C', this.repoDir, 'rev-parse', '-q', '--verify', `${ref}^{commit}`]); return false } catch { return true }
  }
}

/** Git uses `/` even on Windows for paths inside the repository (`ref:path`). */
function normalize(path: string): string { return path.replace(/\\/g, '/').replace(/^\/+/, '') }
