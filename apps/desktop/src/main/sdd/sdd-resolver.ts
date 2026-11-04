import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SddConfig } from '@gearmod/contracts'
import type { BoardRepository, ProjectRepository } from '../projects'
import type { CardHistoryService } from '../history'
import { nativeGit, type GitRunner, type WorktreeService } from '../worktrees'
import { GitFileReader } from './git-file-reader'
import { constitutionState, mergeBaseCommit, type ThreeWayState } from './constitution-state'
import { tm } from '../i18n'

export type SddVia = 'worktree' | 'ref'
export interface SddLocation { repo: string; rootAbs: string; ref: string; via: SddVia; sourceId: string; method: SddConfig['method']; worktreeBranch: string | null }
export interface ConstitutionView { path: string; content: string | null; blobSha: string | null; baseBlobSha: string | null; headBlobSha: string | null; state: ThreeWayState; method: SddConfig['method']; via: SddVia }
export interface SddEntry { name: string; isDirectory: boolean }

/** Path of the Constitution selected in the project, relative to the SDD repository root. */
function constitutionCandidates(config: SddConfig): Array<{ method: SddConfig['method']; file: string; relPath: string }> {
  const relPath = (file: string): string => [config.root, file].filter(Boolean).join('/').replace(/\\/g, '/')
  const file = config.constitution[config.method]
  return [{ method: config.method, file, relPath: relPath(file) }]
}

/**
 * G03 — `SddResolver.locate` (`02` §4.2, ADR-001 2b): only reads, never writes (that is `SddWriter`, G08). With the card's
 * worktree → file in the worktree (`via:'worktree'`); without a worktree → `git show <baseRef>:<path>` (`via:'ref'`), where
 * `baseRef` is `cards.base_branch` ?? the project default ?? the current branch of the SDD repository. Actionable error when the
 * configured `sourceId` no longer exists in the project.
 */
export class SddResolver {
  constructor(
    private readonly history: Pick<CardHistoryService, 'config'> & Partial<Pick<CardHistoryService, 'sddMethod'>>,
    private readonly board: Pick<BoardRepository, 'card' | 'baseBranch'>,
    private readonly projects: Pick<ProjectRepository, 'get'>,
    private readonly worktrees: Pick<WorktreeService, 'repositories'>,
    private readonly git: GitRunner = nativeGit
  ) {}

  private config(projectId: string): SddConfig { return this.history.config(projectId).sdd }

  private source(projectId: string, config: SddConfig): { id: string; localPath: string } {
    const project = this.projects.get(projectId)
    if (config.sourceId) {
      const found = project.sources.find((item) => item.id === config.sourceId)
      if (!found) throw new Error(tm().sdd.sddRepoGone)
      return { id: found.id, localPath: found.localPath }
    }
    const first = project.sources.find((item) => item.isGitRepository)
    if (!first) throw new Error(tm().sdd.noGitRepoForSdd)
    return { id: first.id, localPath: first.localPath }
  }

  private async currentBranch(repo: string): Promise<string> {
    return (await this.git.run(['-C', repo, 'branch', '--show-current'])).stdout.trim() || 'HEAD'
  }

  async locate(scope: { projectId: string; cardId?: string }): Promise<SddLocation> {
    const config = this.scopeConfig(scope)
    const source = this.source(scope.projectId, config)
    if (scope.cardId) {
      const member = this.worktrees.repositories(scope.cardId).find((item) => item.status === 'active' && samePath(item.repoPath, source.localPath))
      if (member) {
        const branch = (await this.git.run(['-C', member.path, 'branch', '--show-current']).then((result) => result.stdout.trim(), () => null)) || null
        return { repo: source.localPath, rootAbs: join(member.path, config.root), ref: '', via: 'worktree', sourceId: source.id, method: config.method, worktreeBranch: branch }
      }
    }
    const baseRef = (scope.cardId ? this.board.baseBranch(scope.cardId) : null) ?? this.projects.get(scope.projectId).baseBranch ?? await this.currentBranch(source.localPath)
    return { repo: source.localPath, rootAbs: join(source.localPath, config.root), ref: baseRef, via: 'ref', sourceId: source.id, method: config.method, worktreeBranch: null }
  }

  /**
   * Content and (three-way) state of the Constitution. `content: null` = the file does not exist yet at the selected path
   * (not an error). The method and the path are a single project choice; without a file, the response points to where a new
   * Constitution will be created.
   */
  async constitution(scope: { projectId: string; cardId?: string }): Promise<ConstitutionView> {
    const config = this.scopeConfig(scope), location = await this.locate(scope), candidates = constitutionCandidates(config)
    const reader = new GitFileReader(location.repo, this.git)
    if (location.via === 'worktree') {
      for (const candidate of candidates) {
        const fileAbs = join(location.rootAbs, candidate.file)
        const content = await readFile(fileAbs, 'utf8').then((text) => text, () => null)
        if (content === null && candidate !== candidates[candidates.length - 1]) continue
        const headSha = content === null ? null : await this.git.run(['hash-object', fileAbs]).then((result) => result.stdout.trim() || null, () => null)
        // Without a worktree there would be nothing to compare; here it exists, so it measures against the base chosen for the card.
        const baseRefForState = (scope.cardId ? this.board.baseBranch(scope.cardId) : null) ?? this.projects.get(scope.projectId).baseBranch ?? await this.currentBranch(location.repo)
        const baseTip = await reader.blobSha(baseRefForState, candidate.relPath).catch(() => null)
        const mergeBase = location.worktreeBranch ? await mergeBaseCommit(this.git, location.repo, baseRefForState, location.worktreeBranch) : null
        const mergeBaseSha = mergeBase ? await reader.blobSha(mergeBase, candidate.relPath).catch(() => null) : baseTip
        return { path: candidate.relPath, content, blobSha: headSha, baseBlobSha: baseTip, headBlobSha: headSha, state: constitutionState(mergeBaseSha, baseTip, headSha), method: candidate.method, via: 'worktree' }
      }
    }
    // Without a worktree, the read IS the base itself: nothing has diverged yet (three-way state only exists when there is a card copy to compare).
    for (const candidate of candidates) {
      const content = await reader.show(location.ref, candidate.relPath)
      if (content === null && candidate !== candidates[candidates.length - 1]) continue
      const blobSha = content === null ? null : await reader.blobSha(location.ref, candidate.relPath)
      return { path: candidate.relPath, content, blobSha, baseBlobSha: blobSha, headBlobSha: blobSha, state: constitutionState(blobSha, blobSha, blobSha), method: candidate.method, via: 'ref' }
    }
    throw new Error(tm().sdd.noConstitutionPath) // unreachable: `candidates` always has an item
  }

  private scopeConfig(scope: { projectId: string; cardId?: string }): SddConfig {
    const config = this.config(scope.projectId), method = scope.cardId ? this.history.sddMethod?.(scope.cardId) : null
    return method ? { ...config, method } : config
  }

  async list(scope: { projectId: string; cardId?: string }, dir: string): Promise<SddEntry[]> {
    const config = this.config(scope.projectId), location = await this.locate(scope)
    const relDir = [config.root, dir].filter(Boolean).join('/').replace(/\\/g, '/')
    if (location.via === 'worktree') {
      const abs = join(location.rootAbs, dir)
      const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
      return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
    }
    const reader = new GitFileReader(location.repo, this.git)
    const names = await reader.list(location.ref, relDir)
    return names.map((name) => ({ name, isDirectory: !name.includes('.') }))
  }
}

const samePath = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '') === b.replace(/\\/g, '/').toLowerCase().replace(/\/$/, '')
