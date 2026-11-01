import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { nativeGit, type GitRunner, type WorktreeService } from '../worktrees'
import { tm } from '../i18n'

/** G08: `expect.blobSha` não bate com o blob atual do arquivo — outra edição aconteceu entre a leitura e esta escrita. */
export class SddConflict extends Error {
  constructor(message: string, readonly expectedBlobSha: string | null, readonly actualBlobSha: string | null) { super(message) }
}

const reservedWindowsNames = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)/i

/**
 * Caminho relativo seguro dentro de `rootAbs`: sem `..`, sem absoluto, sem nome reservado do Windows em nenhum segmento.
 * Devolve o caminho absoluto já resolvido (lexicamente contido em `rootAbs`); a verificação de link simbólico é separada
 * (`assertNoSymlinkEscape`), porque depende do disco, não só do texto do caminho.
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
 * Nenhuma pasta já existente, entre o arquivo e a raiz (sem incluir a raiz, que é de confiança), pode ser, de verdade
 * (via link simbólico), uma saída da raiz do SDD. A parada do laço é sempre pelo caminho léxico (igual ao que
 * `allowedPath` usou para montar `targetAbs`), nunca pelo caminho real: no Windows, `realpath` pode trocar um nome curto
 * (`FRANCI~1`) pelo longo mesmo sem link nenhum, e comparar isso com a raiz sem o mesmo tratamento pararia fora dela.
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

/** Hash de blob Git do conteúdo de um arquivo, sem precisar que esteja staged nem committed; `null` se o arquivo não existir. */
async function currentBlobSha(git: GitRunner, targetAbs: string): Promise<string | null> {
  if (!existsSync(targetAbs)) return null
  try { return (await git.run(['hash-object', targetAbs])).stdout.trim() || null } catch { return null }
}

/**
 * G08 — única escrita de SDD (resolver, G03, é read-only). Escreve só dentro da worktree do card (nunca na cópia
 * principal do repositório): garante o repositório como membro (`WorktreeService.ensureMember`, G07), valida o
 * caminho (`allowedPath` + link simbólico), checa conflito por blob sha e grava com temp+rename atômico.
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
    const tempPath = `${targetAbs}.agentboard-tmp-${randomUUID()}`
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
