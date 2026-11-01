import { nativeGit, type GitRunner } from '../worktrees'
import { tm } from '../i18n'

/** G02 (`02` §4.2): erro tipado — quem chama decide se mostra "referência não encontrada" ou trata como "arquivo ausente". */
export class SddGitError extends Error {
  constructor(message: string, readonly code: 'ref-not-found' | 'git-error') { super(message) }
}

/**
 * Lê arquivos do SDD direto do Git (worktree ou outra ref), sem conteúdo passar pelo SQLite. Cada instância é de um
 * repositório; `ref` pode ser uma branch, tag ou commit. Nunca escreve (isso é o `SddWriter`, G08).
 */
export class GitFileReader {
  constructor(private readonly repoDir: string, private readonly git: GitRunner = nativeGit) {}

  /** `null` quando o arquivo não existe naquela ref (ref válida); lança `SddGitError` quando a própria ref não existe. */
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

  /** Conteúdo do arquivo naquela ref, byte a byte (CRLF/encoding preservados); `null` se não existir. */
  async show(ref: string, path: string): Promise<string | null> {
    const sha = await this.blobSha(ref, path)
    if (!sha) return null
    return (await this.git.run(['-C', this.repoDir, 'show', sha])).stdout
  }

  /** Nomes (relativos a `dir`) de arquivos e pastas na ref; lista vazia se a pasta não existir (ref válida). */
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

/** Git usa `/` mesmo no Windows para caminhos dentro do repositório (`ref:path`). */
function normalize(path: string): string { return path.replace(/\\/g, '/').replace(/^\/+/, '') }
