import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tm } from './i18n'

/** Onde a pasta está: commit do HEAD (null em repositório sem commit) e branch (null com HEAD solto). */
export interface GitState { head: string | null; branch: string | null }
export type UndoKind = 'commit' | 'checkout' | 'create-branch' | 'delete-branch' | 'tag' | 'reset' | 'reset-hard-dirty' | 'discard' | 'stash' | 'stash-drop' | 'ignore'
/** Uma ação da tela de Git que dá para desfazer. `dir` é a pasta onde ela rodou; `pins` são as refs `refs/gearmod/undo/*` que seguram os hashes dela. */
export interface UndoEntry { id: string; kind: UndoKind; at: string; before: GitState; after: GitState; dir: string; pins: string[]; data: Record<string, unknown> }

/** Quantas ações ficam na pilha de cada pasta; a mais antiga sai. */
export const undoLimit = 20
export const sameState = (a: GitState, b: GitState): boolean => a.head === b.head && a.branch === b.branch

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const short = (hash: string | null | undefined): string => (hash ?? '').slice(0, 7)

/** Texto da ação na tela ("commit "Corrige filtro"", "checkout de dev"…), no idioma de agora. */
export function entryLabel(kind: UndoKind, data: Record<string, unknown>): string {
  const g = tm().git
  switch (kind) {
    case 'commit': return data.rename ? g.undoLabelRename(text(data.message)) : data.amend ? g.undoLabelAmend(text(data.message)) : g.undoLabelCommit(text(data.message))
    case 'checkout': return g.undoLabelCheckout(text(data.to))
    case 'create-branch': return g.undoLabelCreateBranch(text(data.name))
    case 'delete-branch': return g.undoLabelDeleteBranch(text(data.name))
    case 'tag': return g.undoLabelTag(text(data.name))
    case 'reset': case 'reset-hard-dirty': return g.undoLabelReset(text(data.mode) || 'hard', short(text(data.to)))
    case 'discard': { const files = Array.isArray(data.files) ? data.files as Array<{ path: string }> : []; return g.undoLabelDiscard(files.length, files[0]?.path ?? '') }
    case 'stash': return g.undoLabelStash
    case 'stash-drop': return g.undoLabelStashDrop(text(data.message))
    case 'ignore': return g.undoLabelIgnore(text(data.pattern))
  }
}

interface Stack { done: UndoEntry[]; undone: UndoEntry[] }

/** Pilha de desfazer/refazer por pasta (chave `${sourceId}:${cardId ?? ''}`). Só em memória. */
export class UndoJournal {
  private readonly stacks = new Map<string, Stack>()
  private stack(key: string): Stack {
    let found = this.stacks.get(key)
    if (!found) { found = { done: [], undone: [] }; this.stacks.set(key, found) }
    return found
  }
  /** Empilha uma ação nova: o refazer some e a mais antiga sai se passar do limite. Devolve as entradas que saíram. */
  push(key: string, entry: UndoEntry): UndoEntry[] {
    const stack = this.stack(key), gone = stack.undone.splice(0)
    stack.done.push(entry)
    gone.push(...stack.done.splice(0, Math.max(0, stack.done.length - undoLimit)))
    return gone
  }
  peekUndo(key: string): UndoEntry | undefined { return this.stacks.get(key)?.done.at(-1) }
  peekRedo(key: string): UndoEntry | undefined { return this.stacks.get(key)?.undone.at(-1) }
  moveToUndone(key: string): void { const stack = this.stack(key), entry = stack.done.pop(); if (entry) stack.undone.push(entry) }
  moveToDone(key: string): void { const stack = this.stack(key), entry = stack.undone.pop(); if (entry) stack.done.push(entry) }
  /** Tira uma entrada (das duas listas) e a devolve. */
  drop(key: string, id: string): UndoEntry[] {
    const stack = this.stacks.get(key)
    if (!stack) return []
    const gone = [...stack.done, ...stack.undone].filter((entry) => entry.id === id)
    stack.done = stack.done.filter((entry) => entry.id !== id); stack.undone = stack.undone.filter((entry) => entry.id !== id)
    return gone
  }
  /** Esvazia a pilha da pasta e devolve tudo que saiu. */
  clear(key: string): UndoEntry[] {
    const stack = this.stacks.get(key)
    this.stacks.delete(key)
    return stack ? [...stack.done, ...stack.undone] : []
  }
  clearWhere(match: (key: string) => boolean): UndoEntry[] { return [...this.stacks.keys()].filter(match).flatMap((key) => this.clear(key)) }
  /** Todas as entradas vivas (para saber o que a limpeza da abertura não pode apagar). */
  all(): UndoEntry[] { return [...this.stacks.values()].flatMap((stack) => [...stack.done, ...stack.undone]) }
}

/** O que cada desfazer/refazer precisa do mundo: o git na pasta, a pasta de cópias e o caminho seguro dentro da pasta. */
export interface UndoCtx {
  dir: string; entry: UndoEntry
  run(args: string[]): Promise<string>
  tryRun(args: string[]): Promise<string | null>
  backupDir?: string | undefined
  /** Caminho absoluto de um arquivo da pasta de trabalho; recusa o que fica fora dela. */
  inside(path: string): Promise<string>
  /** Descarta de novo os caminhos (mesma lógica do descarte da tela, sem gravar entrada). */
  discard(paths: string[]): Promise<void>
}
/** Pode devolver um aviso, que vai junto da mensagem "Desfeito: …". */
type Step = (ctx: UndoCtx) => Promise<string | void>
interface Action { undo: Step; redo: Step }

const rev = async (ctx: UndoCtx, ref: string): Promise<string | null> => (await ctx.tryRun(['rev-parse', '-q', '--verify', ref]))?.trim() || null
const trackedClean = async (ctx: UndoCtx): Promise<boolean> => !(await ctx.run(['status', '--porcelain', '--untracked-files=no'])).trim()
const requireClean = async (ctx: UndoCtx): Promise<void> => { if (!await trackedClean(ctx)) throw new Error(tm().git.undoDirty) }
const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

/** Volta ao lugar de antes da ação (branch, ou o commit solto). */
async function goBack(ctx: UndoCtx): Promise<void> {
  const { before } = ctx.entry
  if (before.branch) await ctx.run(['checkout', before.branch, '--'])
  else if (before.head) await ctx.run(['checkout', '--detach', before.head])
}

/** Marca da pasta (árvore da cópia do `stash create`, com índice), ou '' se não há alteração em arquivo rastreado. */
async function snapshotKey(ctx: UndoCtx): Promise<string> {
  const snapshot = (await ctx.tryRun(['stash', 'create']))?.trim()
  if (!snapshot) return ''
  return `${await rev(ctx, `${snapshot}^{tree}`)}:${await rev(ctx, `${snapshot}^2^{tree}`)}`
}

/** Um arquivo de um descarte: `backup` = cópia relativa à pasta da entrada (null se não existia), `afterHash` = blob que ele deve ter depois do descarte (null = ausente). */
export interface DiscardFile { path: string; tracked: boolean; backup: string | null; afterHash: string | null }
const discardFiles = (ctx: UndoCtx): DiscardFile[] => (Array.isArray(ctx.entry.data.files) ? ctx.entry.data.files as DiscardFile[] : [])
const hashOfFile = async (ctx: UndoCtx, full: string): Promise<string | null> => (await exists(full) ? (await ctx.tryRun(['hash-object', '--', full]))?.trim() ?? null : null)
const backupFolder = (ctx: UndoCtx): string => join(ctx.backupDir ?? '', ctx.entry.id)

async function stashPush(ctx: UndoCtx): Promise<string> {
  const paths = Array.isArray(ctx.entry.data.paths) ? ctx.entry.data.paths as string[] : []
  const top = await rev(ctx, 'stash@{0}')
  await ctx.run(['stash', 'push', '--include-untracked', ...(paths.length ? ['--', ...paths.map((path) => `:(literal)${path}`)] : [])])
  const hash = await rev(ctx, 'stash@{0}')
  if (!hash || hash === top) throw new Error(tm().git.fileHasNoChanges)
  return hash
}

/** Posição do stash (`stash@{n}`) com esse hash na lista de agora, ou -1. */
const stashAt = async (ctx: UndoCtx, hash: string): Promise<number> => (await ctx.run(['stash', 'list', '--format=%H'])).split(/\r?\n/).filter(Boolean).indexOf(hash)

const readIgnore = (path: string): Promise<string | null> => readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })

export const undoActions: Record<UndoKind, Action> = {
  commit: {
    async undo(ctx) {
      const { before, after } = ctx.entry
      if (!before.head) { await ctx.run(['update-ref', '-d', 'HEAD']); return }
      // Já publicado: reescrever o histórico do remoto não é com este botão.
      const upstream = (await ctx.tryRun(['rev-parse', '--abbrev-ref', '@{upstream}']))?.trim()
      if (upstream && after.head && await ctx.tryRun(['merge-base', '--is-ancestor', after.head, upstream]) !== null) throw new Error(tm().git.undoCommitPublished)
      await ctx.run(['reset', '--soft', before.head])
    },
    async redo(ctx) {
      const { after } = ctx.entry
      if (!after.head) return
      // Renomear não mexe nos arquivos (a árvore é a mesma); commit e amend só refazem se o preparado ainda é o do commit.
      if (!ctx.entry.data.rename && (await ctx.tryRun(['write-tree']))?.trim() !== await rev(ctx, `${after.head}^{tree}`)) throw new Error(tm().git.redoIndexChanged)
      if (await rev(ctx, 'HEAD')) await ctx.run(['reset', '--soft', after.head]); else await ctx.run(['update-ref', 'HEAD', after.head])
    }
  },
  checkout: {
    async undo(ctx) {
      const created = text(ctx.entry.data.createdLocal)
      await goBack(ctx)
      if (created && await rev(ctx, `refs/heads/${created}`) === text(ctx.entry.data.createdAt)) await ctx.run(['branch', '-D', created])
    },
    async redo(ctx) {
      const { after } = ctx.entry, created = text(ctx.entry.data.createdLocal)
      if (created && !await rev(ctx, `refs/heads/${created}`)) await ctx.run(['branch', '--track', created, text(ctx.entry.data.remote)])
      if (after.branch) await ctx.run(['checkout', after.branch, '--']); else if (after.head) await ctx.run(['checkout', '--detach', after.head])
    }
  },
  'create-branch': {
    async undo(ctx) {
      const name = text(ctx.entry.data.name)
      await goBack(ctx)
      if (await rev(ctx, `refs/heads/${name}`) === text(ctx.entry.data.hash)) await ctx.run(['branch', '-D', name])
      else return tm().git.undoBranchKept(name)
    },
    async redo(ctx) { await ctx.run(['checkout', '-b', text(ctx.entry.data.name), text(ctx.entry.data.hash)]) }
  },
  'delete-branch': {
    async undo(ctx) {
      const { name, hash, remote, merge } = { name: text(ctx.entry.data.name), hash: text(ctx.entry.data.hash), remote: text(ctx.entry.data.remote), merge: text(ctx.entry.data.merge) }
      if (await rev(ctx, `refs/heads/${name}`)) throw new Error(tm().git.undoBranchExists(name))
      await ctx.run(['branch', name, hash])
      if (remote) await ctx.run(['config', `branch.${name}.remote`, remote])
      if (merge) await ctx.run(['config', `branch.${name}.merge`, merge])
    },
    async redo(ctx) {
      const name = text(ctx.entry.data.name)
      if (await rev(ctx, `refs/heads/${name}`) !== text(ctx.entry.data.hash)) throw new Error(tm().git.undoBranchMoved(name))
      await ctx.run(['branch', '-D', name])
    }
  },
  tag: {
    async undo(ctx) {
      const name = text(ctx.entry.data.name)
      if (await rev(ctx, `refs/tags/${name}`) !== text(ctx.entry.data.hash)) throw new Error(tm().git.undoTagChanged(name))
      await ctx.run(['tag', '-d', name])
    },
    async redo(ctx) { await ctx.run(['tag', text(ctx.entry.data.name), text(ctx.entry.data.hash)]) }
  },
  reset: {
    async undo(ctx) {
      const mode = text(ctx.entry.data.mode)
      if (mode === 'hard') await requireClean(ctx)
      if (ctx.entry.before.head) await ctx.run(['reset', `--${mode}`, ctx.entry.before.head])
    },
    async redo(ctx) {
      const mode = text(ctx.entry.data.mode)
      if (mode === 'hard') await requireClean(ctx)
      if (ctx.entry.after.head) await ctx.run(['reset', `--${mode}`, ctx.entry.after.head])
    }
  },
  'reset-hard-dirty': {
    async undo(ctx) {
      const snapshot = text(ctx.entry.data.snapshot), from = ctx.entry.before.head
      await requireClean(ctx)
      if (!from) return
      await ctx.run(['reset', '--hard', from])
      try { await ctx.run(['stash', 'apply', '--index', snapshot]) } catch (error) { throw new Error(tm().git.undoRestoreFailed(short(snapshot), error instanceof Error ? error.message : String(error))) }
      ctx.entry.data.restored = await snapshotKey(ctx)
    },
    async redo(ctx) {
      // A pasta tem que estar como o desfazer deixou; senão o reset jogaria fora alterações novas.
      if (await snapshotKey(ctx) !== text(ctx.entry.data.restored)) throw new Error(tm().git.redoFolderChanged)
      if (ctx.entry.after.head) await ctx.run(['reset', '--hard', ctx.entry.after.head])
    }
  },
  discard: {
    async undo(ctx) {
      const files = discardFiles(ctx), root = backupFolder(ctx)
      const fulls = await Promise.all(files.map((file) => ctx.inside(file.path)))
      // Confere todos antes de mexer em qualquer um.
      for (const [index, file] of files.entries()) {
        if (await hashOfFile(ctx, fulls[index]!) !== file.afterHash) throw new Error(tm().git.undoFileChanged(file.path))
        if (file.backup && !await exists(join(root, file.backup))) throw new Error(tm().git.undoBackupMissing(file.path))
      }
      for (const [index, file] of files.entries()) {
        const full = fulls[index]!
        if (file.backup) { await mkdir(dirname(full), { recursive: true }); await copyFile(join(root, file.backup), full) } else await unlink(full).catch(() => undefined)
      }
    },
    async redo(ctx) {
      const files = discardFiles(ctx), root = backupFolder(ctx)
      for (const file of files) {
        const full = await ctx.inside(file.path)
        // O arquivo tem que estar igual à cópia (o que o desfazer devolveu); arquivo apagado no descarte, tem que continuar ausente.
        const saved = file.backup ? await readFile(join(root, file.backup)).catch(() => null) : null
        const same = file.backup ? saved !== null && await exists(full) && (await readFile(full)).equals(saved) : !await exists(full)
        if (!same) throw new Error(tm().git.undoFileChanged(file.path))
      }
      await ctx.discard(files.map((file) => file.path))
    }
  },
  stash: {
    async undo(ctx) {
      if (await rev(ctx, 'stash@{0}') !== text(ctx.entry.data.hash)) throw new Error(tm().git.undoStashNotTop)
      // Com --index o que estava preparado volta preparado; se o Git não conseguir, volta sem.
      if (await ctx.tryRun(['stash', 'pop', '--index']) === null) await ctx.run(['stash', 'pop'])
    },
    async redo(ctx) { ctx.entry.data.hash = await stashPush(ctx) }
  },
  'stash-drop': {
    async undo(ctx) {
      const hash = text(ctx.entry.data.hash)
      if (await stashAt(ctx, hash) >= 0) throw new Error(tm().git.undoStashExists)
      await ctx.run(['stash', 'store', '-m', text(ctx.entry.data.message), hash])
    },
    async redo(ctx) {
      const at = await stashAt(ctx, text(ctx.entry.data.hash))
      if (at < 0) throw new Error(tm().git.undoStashMissing)
      await ctx.run(['stash', 'drop', `stash@{${at}}`])
    }
  },
  ignore: {
    async undo(ctx) {
      const path = join(ctx.dir, '.gitignore'), previous = ctx.entry.data.previous
      if (await readIgnore(path) !== ctx.entry.data.next) throw new Error(tm().git.undoIgnoreChanged)
      if (typeof previous === 'string') await writeFile(path, previous, 'utf8'); else await unlink(path)
    },
    async redo(ctx) {
      const path = join(ctx.dir, '.gitignore'), previous = typeof ctx.entry.data.previous === 'string' ? ctx.entry.data.previous : null
      if (await readIgnore(path) !== previous) throw new Error(tm().git.undoIgnoreChanged)
      await writeFile(path, text(ctx.entry.data.next), 'utf8')
    }
  }
}
