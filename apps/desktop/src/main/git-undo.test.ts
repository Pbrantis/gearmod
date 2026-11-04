import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from './database'
import { GitManager } from './git-manager'
import { entryLabel, sameState, undoLimit, UndoJournal, type UndoEntry } from './git-undo'
import { BoardRepository, GitService, ProfileRepository, ProjectRepository } from './projects'
import { seedProfiles } from './test-helpers'
import { WorktreeService } from './worktrees'

const exec = promisify(execFile), roots: string[] = [], opened: AppDatabase[] = []
afterEach(async () => { opened.splice(0).forEach((item) => item.close()); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))) })
const git = (dir: string, ...args: string[]): Promise<{ stdout: string }> => exec('git', ['-C', dir, ...args])
const out = async (dir: string, ...args: string[]): Promise<string> => (await git(dir, ...args)).stdout.trim()
const head = (dir: string): Promise<string> => out(dir, 'rev-parse', 'HEAD')
const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false)
const refs = async (dir: string): Promise<string[]> => (await out(dir, 'for-each-ref', '--format=%(refname)', 'refs/gearmod/undo')).split(/\r?\n/).filter(Boolean)

/** Repositório temporário registrado num projeto; `remote` liga um bare como origin, `empty` deixa o repositório sem commit. */
async function setup(options: { remote?: boolean; empty?: boolean } = {}): Promise<{ root: string; repo: string; remote: string; backup: string; database: AppDatabase; manager: GitManager; projectId: string; sourceId: string }> {
  const root = await mkdtemp(join(tmpdir(), 'gearmod-undo-')); roots.push(root)
  const repo = join(root, 'repo'), remote = join(root, 'remote.git'), backup = join(root, 'backup'), trash = join(root, 'trash')
  await exec('git', ['init', '-b', 'main', repo])
  await git(repo, 'config', 'user.email', 'test@example.invalid'); await git(repo, 'config', 'user.name', 'GearMod Test'); await git(repo, 'config', 'core.autocrlf', 'false')
  if (!options.empty) { await writeFile(join(repo, 'README.md'), '# fixture\n'); await git(repo, 'add', 'README.md'); await git(repo, 'commit', '-m', 'primeiro') }
  if (options.remote) { await exec('git', ['init', '--bare', '-b', 'main', remote]); await git(repo, 'remote', 'add', 'origin', remote); await git(repo, 'push', '-u', 'origin', 'main') }
  const database = new AppDatabase(join(root, 'data', 'db.sqlite'), '0.1.0'); await database.open(); opened.push(database)
  const project = await new ProjectRepository(database, new GitService()).create({ localPath: repo })
  const source = database.db.prepare('SELECT id FROM project_sources WHERE project_id = ?').get(project.id) as { id: string }
  const toTrash = async (path: string): Promise<void> => { await mkdir(trash, { recursive: true }); await rename(path, join(trash, `${Date.now()}-${basename(path)}`)) }
  return { root, repo, remote, backup, database, manager: new GitManager(database, undefined, undefined, undefined, toTrash, backup), projectId: project.id, sourceId: source.id }
}

const entry = (id: string): UndoEntry => ({ id, kind: 'commit', at: '', before: { head: null, branch: null }, after: { head: id, branch: 'main' }, dir: '/x', pins: [], data: { message: id } })

describe('histórico de desfazer', () => {
  it('guarda no máximo 20 ações por pasta e devolve a que saiu', () => {
    const journal = new UndoJournal()
    const gone: string[] = []
    for (let i = 0; i < undoLimit + 3; i++) gone.push(...journal.push('a', entry(`e${i}`)).map((item) => item.id))
    expect(gone).toEqual(['e0', 'e1', 'e2'])
    expect(journal.all()).toHaveLength(undoLimit)
    expect(journal.peekUndo('a')?.id).toBe(`e${undoLimit + 2}`)
    expect(journal.peekUndo('b')).toBeUndefined()
  })

  it('ação nova limpa o refazer; desfazer e refazer movem a entrada de lugar', () => {
    const journal = new UndoJournal()
    journal.push('a', entry('um')); journal.push('a', entry('dois'))
    journal.moveToUndone('a')
    expect(journal.peekUndo('a')?.id).toBe('um'); expect(journal.peekRedo('a')?.id).toBe('dois')
    journal.moveToDone('a')
    expect(journal.peekUndo('a')?.id).toBe('dois'); expect(journal.peekRedo('a')).toBeUndefined()
    journal.moveToUndone('a')
    expect(journal.push('a', entry('tres')).map((item) => item.id)).toEqual(['dois'])
    expect(journal.peekRedo('a')).toBeUndefined()
  })

  it('drop tira uma entrada e clear esvazia a pasta devolvendo tudo', () => {
    const journal = new UndoJournal()
    journal.push('a', entry('um')); journal.push('a', entry('dois')); journal.moveToUndone('a'); journal.push('b', entry('tres'))
    expect(journal.drop('a', 'um').map((item) => item.id)).toEqual(['um'])
    expect(journal.peekUndo('a')).toBeUndefined()
    journal.push('a', entry('quatro')); journal.moveToUndone('a')
    expect(journal.clear('a').map((item) => item.id)).toEqual(['quatro'])
    expect(journal.clearWhere((key) => key === 'b').map((item) => item.id)).toEqual(['tres'])
    expect(journal.all()).toEqual([])
  })

  it('compara estados e escreve o texto da ação', () => {
    expect(sameState({ head: 'a', branch: 'main' }, { head: 'a', branch: 'main' })).toBe(true)
    expect(sameState({ head: 'a', branch: 'main' }, { head: 'a', branch: null })).toBe(false)
    expect(entryLabel('commit', { message: 'Corrige filtro' })).toBe('commit "Corrige filtro"')
    expect(entryLabel('checkout', { to: 'dev' })).toBe('checkout de dev')
    expect(entryLabel('create-branch', { name: 'feature/x' })).toBe('criar a branch feature/x')
    expect(entryLabel('delete-branch', { name: 'feature/x' })).toBe('apagar a branch feature/x')
    expect(entryLabel('reset', { mode: 'hard', to: 'abcdef1234' })).toBe('reset hard para abcdef1')
  })
})

describe('desfazer commit, amend e renomear', () => {
  it('desfaz o commit (arquivos voltam preparados) e refaz com o mesmo hash', async () => {
    const { manager, repo, sourceId } = await setup()
    const first = await head(repo)
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    const { hash } = await manager.commit({ sourceId, cardId: null, message: 'Adiciona a' })
    expect(await manager.undoState(sourceId, null)).toEqual({ undo: { label: 'commit "Adiciona a"' }, redo: null })
    expect((await manager.undoLast(sourceId, null)).output).toBe('Desfeito: commit "Adiciona a".')
    expect(await head(repo)).toBe(first)
    expect(await out(repo, 'status', '--porcelain')).toBe('A  a.txt')
    expect(await manager.undoState(sourceId, null)).toEqual({ undo: null, redo: { label: 'commit "Adiciona a"' } })
    expect((await manager.redoLast(sourceId, null)).output).toBe('Refeito: commit "Adiciona a".')
    expect(await head(repo)).toBe(hash)
    await expect(manager.redoLast(sourceId, null)).rejects.toThrow(/Nada para refazer/)
  })

  it('o refazer recusa se o que está preparado mudou', async () => {
    const { manager, repo, sourceId } = await setup()
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    await manager.commit({ sourceId, cardId: null, message: 'Adiciona a' })
    await manager.undoLast(sourceId, null)
    await writeFile(join(repo, 'a.txt'), 'outro\n'); await git(repo, 'add', 'a.txt')
    await expect(manager.redoLast(sourceId, null)).rejects.toThrow(/preparadas mudaram/)
  })

  it('amend: desfazer volta a mensagem antiga', async () => {
    const { manager, repo, sourceId } = await setup()
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    const one = (await manager.commit({ sourceId, cardId: null, message: 'um' })).hash
    const two = (await manager.commit({ sourceId, cardId: null, message: 'dois', amend: true })).hash
    expect((await manager.undoState(sourceId, null)).undo?.label).toBe('emendar o commit "dois"')
    await manager.undoLast(sourceId, null)
    expect(await head(repo)).toBe(one); expect(await out(repo, 'log', '-1', '--format=%s')).toBe('um')
    await manager.redoLast(sourceId, null)
    expect(await head(repo)).toBe(two)
  })

  it('renomear o commit entra na pilha e desfaz', async () => {
    const { manager, repo, sourceId } = await setup()
    const base = await head(repo)
    const renamed = await manager.renameCommit({ sourceId, cardId: null, hash: base, message: 'novo nome' })
    expect((await manager.undoState(sourceId, null)).undo?.label).toBe('renomear o commit "novo nome"')
    await manager.undoLast(sourceId, null)
    expect(await head(repo)).toBe(base)
    await manager.redoLast(sourceId, null)
    expect(await head(repo)).toBe(renamed.hash)
  })

  it('primeiro commit do repositório: desfazer deixa o repositório sem HEAD e com o arquivo preparado', async () => {
    const { manager, repo, sourceId } = await setup({ empty: true })
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    const { hash } = await manager.commit({ sourceId, cardId: null, message: 'inicial' })
    await manager.undoLast(sourceId, null)
    await expect(git(repo, 'rev-parse', '-q', '--verify', 'HEAD')).rejects.toThrow()
    expect(await out(repo, 'status', '--porcelain')).toBe('A  a.txt')
    await manager.redoLast(sourceId, null)
    expect(await head(repo)).toBe(hash)
  })

  it('commit já publicado não se desfaz', async () => {
    const { manager, repo, sourceId } = await setup({ remote: true })
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    const { hash } = await manager.commit({ sourceId, cardId: null, message: 'publicado' })
    await git(repo, 'push')
    await expect(manager.undoLast(sourceId, null)).rejects.toThrow(/já foi enviado para o remoto/)
    expect(await head(repo)).toBe(hash)
  })

  it('commit feito por fora depois recusa o desfazer e tira a entrada da pilha', async () => {
    const { manager, repo, sourceId } = await setup()
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    await manager.commit({ sourceId, cardId: null, message: 'pela tela' })
    await git(repo, 'commit', '--allow-empty', '-m', 'pelo terminal')
    const outside = await head(repo)
    await expect(manager.undoLast(sourceId, null)).rejects.toThrow(/O repositório mudou/)
    expect(await head(repo)).toBe(outside)
    await expect(manager.undoLast(sourceId, null)).rejects.toThrow(/Nada para desfazer/)
  })

  it('o botão não promete o que ficou velho: undoState descarta a entrada', async () => {
    const { manager, repo, sourceId } = await setup()
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    await manager.commit({ sourceId, cardId: null, message: 'pela tela' })
    await git(repo, 'commit', '--allow-empty', '-m', 'por fora')
    expect(await manager.undoState(sourceId, null)).toEqual({ undo: null, redo: null })
  })

  it('cada pasta tem a sua pilha: commit na worktree do card não aparece na pasta principal', async () => {
    const { root, repo, database, manager, projectId, sourceId } = await setup()
    const profiles = new ProfileRepository(database, root); seedProfiles(profiles)
    const projects = new ProjectRepository(database, new GitService()), board = new BoardRepository(database, projects), column = board.get(projectId).columns[0]!
    const card = board.create({ projectId, columnId: column.id, title: 'Tela de teste', description: '', type: 'task', priority: 'medium', acceptanceCriteria: [] })
    const worktree = await new WorktreeService(database, join(root, 'data')).prepare(card.id)
    const wt = (database.db.prepare('SELECT path FROM worktree_members WHERE worktree_id = ?').get(worktree.id) as { path: string }).path
    const before = await head(wt)
    await writeFile(join(wt, 'w.txt'), 'w\n'); await git(wt, 'add', 'w.txt')
    await manager.commit({ sourceId, cardId: card.id, message: 'no card' })
    expect((await manager.undoState(sourceId, card.id)).undo?.label).toBe('commit "no card"')
    expect(await manager.undoState(sourceId, null)).toEqual({ undo: null, redo: null })
    await manager.undoLast(sourceId, card.id)
    expect(await head(wt)).toBe(before)
    expect(await head(repo)).toBe(before)
  })
})

describe('desfazer checkout, branch e tag', () => {
  it('checkout de branch e de commit: volta e refaz', async () => {
    const { manager, repo, sourceId } = await setup()
    const first = await head(repo)
    await git(repo, 'branch', 'dev')
    await manager.branchAction(sourceId, { action: 'checkout', name: 'dev' })
    expect((await manager.undoState(sourceId, null)).undo?.label).toBe('checkout de dev')
    await manager.undoLast(sourceId, null)
    expect(await out(repo, 'branch', '--show-current')).toBe('main')
    await manager.redoLast(sourceId, null)
    expect(await out(repo, 'branch', '--show-current')).toBe('dev')
    await manager.undoLast(sourceId, null)
    await manager.commitAction(sourceId, { action: 'checkout', hash: first })
    expect(await out(repo, 'branch', '--show-current')).toBe('')
    await manager.undoLast(sourceId, null)
    expect(await out(repo, 'branch', '--show-current')).toBe('main')
    await manager.redoLast(sourceId, null)
    expect(await head(repo)).toBe(first); expect(await out(repo, 'branch', '--show-current')).toBe('')
  })

  it('checkout de branch remota que criou a local: desfazer apaga a local, refazer recria', async () => {
    const { manager, repo, sourceId } = await setup({ remote: true })
    await git(repo, 'checkout', '-b', 'feature/x'); await writeFile(join(repo, 'b.txt'), 'b\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', 'feature')
    await git(repo, 'push', 'origin', 'feature/x'); await git(repo, 'checkout', 'main'); await git(repo, 'branch', '-D', 'feature/x')
    await manager.branchAction(sourceId, { action: 'checkout', name: 'origin/feature/x' })
    expect(await out(repo, 'branch', '--show-current')).toBe('feature/x')
    await manager.undoLast(sourceId, null)
    expect(await out(repo, 'branch', '--show-current')).toBe('main')
    expect(await out(repo, 'branch', '--list', 'feature/x')).toBe('')
    await manager.redoLast(sourceId, null)
    expect(await out(repo, 'branch', '--show-current')).toBe('feature/x')
    expect(await out(repo, 'rev-parse', '--abbrev-ref', 'feature/x@{upstream}')).toBe('origin/feature/x')
  })

  it('criar branch: desfazer volta e apaga a nova; commitar nela exige desfazer o commit antes', async () => {
    const { manager, repo, sourceId } = await setup()
    const first = await head(repo)
    await manager.branchAction(sourceId, { action: 'create', name: 'main', newName: 'feat' })
    await manager.undoLast(sourceId, null)
    expect(await out(repo, 'branch', '--show-current')).toBe('main'); expect(await out(repo, 'branch', '--list', 'feat')).toBe('')
    await manager.redoLast(sourceId, null)
    expect(await out(repo, 'branch', '--show-current')).toBe('feat')
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    await manager.commit({ sourceId, cardId: null, message: 'na feat' })
    await manager.undoLast(sourceId, null)
    expect(await head(repo)).toBe(first)
    await manager.undoLast(sourceId, null)
    expect(await out(repo, 'branch', '--show-current')).toBe('main'); expect(await out(repo, 'branch', '--list', 'feat')).toBe('')
  })

  it('criar branch num commit também se desfaz', async () => {
    const { manager, repo, sourceId } = await setup()
    const first = await head(repo)
    await manager.commitAction(sourceId, { action: 'branch', hash: first, name: 'daqui' })
    expect(await out(repo, 'branch', '--show-current')).toBe('daqui')
    await manager.undoLast(sourceId, null)
    expect(await out(repo, 'branch', '--show-current')).toBe('main'); expect(await out(repo, 'branch', '--list', 'daqui')).toBe('')
  })

  it('apagar branch com upstream: desfazer devolve o hash e o upstream, refazer apaga de novo', async () => {
    const { manager, repo, sourceId } = await setup({ remote: true })
    await git(repo, 'branch', 'old'); await git(repo, 'push', '-u', 'origin', 'old')
    const hash = await out(repo, 'rev-parse', 'old')
    await manager.branchAction(sourceId, { action: 'delete', name: 'old' })
    expect(await out(repo, 'branch', '--list', 'old')).toBe('')
    expect((await manager.undoState(sourceId, null)).undo?.label).toBe('apagar a branch old')
    await manager.undoLast(sourceId, null)
    expect(await out(repo, 'rev-parse', 'old')).toBe(hash)
    expect(await out(repo, 'config', 'branch.old.remote')).toBe('origin'); expect(await out(repo, 'config', 'branch.old.merge')).toBe('refs/heads/old')
    await manager.redoLast(sourceId, null)
    expect(await out(repo, 'branch', '--list', 'old')).toBe('')
  })

  it('desfazer apagar branch recusa se já existe outra com o nome', async () => {
    const { manager, repo, sourceId } = await setup()
    await git(repo, 'branch', 'old')
    await manager.branchAction(sourceId, { action: 'delete', name: 'old' })
    await git(repo, 'branch', 'old')
    await expect(manager.undoLast(sourceId, null)).rejects.toThrow(/Já existe uma branch chamada old/)
  })

  it('tag: desfazer apaga e refazer cria de novo', async () => {
    const { manager, repo, sourceId } = await setup()
    const first = await head(repo)
    await manager.commitAction(sourceId, { action: 'tag', hash: first, name: 'v1' })
    expect(await out(repo, 'tag', '--list', 'v1')).toBe('v1')
    await manager.undoLast(sourceId, null)
    expect(await out(repo, 'tag', '--list', 'v1')).toBe('')
    await manager.redoLast(sourceId, null)
    expect(await out(repo, 'rev-parse', 'v1^{commit}')).toBe(first)
  })
})

describe('desfazer reset', () => {
  async function history(repo: string): Promise<{ one: string; two: string }> {
    const one = await head(repo)
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt'); await git(repo, 'commit', '-m', 'dois')
    return { one, two: await head(repo) }
  }

  it('soft, mixed e hard (pasta limpa) desfazem e refazem', async () => {
    const { manager, repo, sourceId } = await setup()
    const { one, two } = await history(repo)
    await manager.commitAction(sourceId, { action: 'reset-soft', hash: one })
    expect(await out(repo, 'status', '--porcelain')).toBe('A  a.txt')
    await manager.undoLast(sourceId, null)
    expect(await head(repo)).toBe(two); expect(await out(repo, 'status', '--porcelain')).toBe('')
    await manager.redoLast(sourceId, null)
    expect(await head(repo)).toBe(one)
    await manager.undoLast(sourceId, null)
    await manager.commitAction(sourceId, { action: 'reset-mixed', hash: one })
    expect(await out(repo, 'status', '--porcelain')).toBe('?? a.txt')
    await manager.undoLast(sourceId, null)
    expect(await head(repo)).toBe(two)
    await manager.redoLast(sourceId, null)
    expect(await head(repo)).toBe(one)
    await manager.undoLast(sourceId, null)
    await manager.commitAction(sourceId, { action: 'reset-hard', hash: one })
    expect(await exists(join(repo, 'a.txt'))).toBe(false)
    expect((await manager.undoState(sourceId, null)).undo?.label).toBe(`reset hard para ${one.slice(0, 7)}`)
    await manager.undoLast(sourceId, null)
    expect(await head(repo)).toBe(two); expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('a\n')
    await manager.redoLast(sourceId, null)
    expect(await head(repo)).toBe(one); expect(await exists(join(repo, 'a.txt'))).toBe(false)
  })

  it('reset hard desfeito com a pasta suja é recusado', async () => {
    const { manager, repo, sourceId } = await setup()
    const { one } = await history(repo)
    await manager.commitAction(sourceId, { action: 'reset-hard', hash: one })
    await writeFile(join(repo, 'README.md'), 'sujo\n')
    await expect(manager.undoLast(sourceId, null)).rejects.toThrow(/não commitadas/)
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('sujo\n')
  })

  it('reset hard com alterações: desfazer devolve as duas (o preparado continua preparado)', async () => {
    const { manager, repo, sourceId } = await setup()
    const { one, two } = await history(repo)
    await writeFile(join(repo, 'a.txt'), 'alterado\n')
    await writeFile(join(repo, 'README.md'), 'preparado\n'); await git(repo, 'add', 'README.md')
    await manager.commitAction(sourceId, { action: 'reset-hard', hash: one })
    expect(await out(repo, 'status', '--porcelain')).toBe('')
    await manager.undoLast(sourceId, null)
    expect(await head(repo)).toBe(two)
    expect(await out(repo, 'status', '--porcelain')).toBe('M  README.md\n M a.txt')
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('alterado\n')
    await manager.redoLast(sourceId, null)
    expect(await head(repo)).toBe(one); expect(await out(repo, 'status', '--porcelain')).toBe('')
  })

  it('reset hard com alterações: o refazer recusa se a pasta mudou depois do desfazer', async () => {
    const { manager, repo, sourceId } = await setup()
    const { one } = await history(repo)
    await writeFile(join(repo, 'a.txt'), 'alterado\n')
    await manager.commitAction(sourceId, { action: 'reset-hard', hash: one })
    await manager.undoLast(sourceId, null)
    await writeFile(join(repo, 'a.txt'), 'mais coisa\n')
    await expect(manager.redoLast(sourceId, null)).rejects.toThrow(/pasta mudou/)
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('mais coisa\n')
  })
})

describe('desfazer descartar, stash e ignorar', () => {
  it('descartar: arquivo rastreado, novo e binário voltam; refazer descarta de novo', async () => {
    const { manager, repo, sourceId } = await setup()
    const binary = Buffer.from([0, 255, 1, 2, 0, 128])
    await writeFile(join(repo, 'README.md'), 'alterado\n'); await writeFile(join(repo, 'novo.txt'), 'novo\n'); await writeFile(join(repo, 'bin.dat'), binary)
    await manager.discardUnstaged(sourceId, null, ['README.md', 'novo.txt', 'bin.dat'])
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# fixture\n'); expect(await exists(join(repo, 'novo.txt'))).toBe(false)
    expect((await manager.undoState(sourceId, null)).undo?.label).toBe('descartar 3 arquivos')
    await manager.undoLast(sourceId, null)
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('alterado\n'); expect(await readFile(join(repo, 'novo.txt'), 'utf8')).toBe('novo\n')
    expect((await readFile(join(repo, 'bin.dat'))).equals(binary)).toBe(true)
    await manager.redoLast(sourceId, null)
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# fixture\n'); expect(await exists(join(repo, 'bin.dat'))).toBe(false)
  })

  it('descartar: se um arquivo mudou depois, o desfazer recusa sem mexer em nenhum', async () => {
    const { manager, repo, sourceId } = await setup()
    await writeFile(join(repo, 'README.md'), 'alterado\n'); await writeFile(join(repo, 'novo.txt'), 'novo\n')
    await manager.discardUnstaged(sourceId, null, ['README.md', 'novo.txt'])
    await writeFile(join(repo, 'README.md'), 'editado depois\n')
    await expect(manager.undoLast(sourceId, null)).rejects.toThrow(/README\.md mudou depois do descarte/)
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('editado depois\n'); expect(await exists(join(repo, 'novo.txt'))).toBe(false)
  })

  it('descartar sem pasta de cópias funciona, mas não entra na pilha', async () => {
    const { database, repo, sourceId } = await setup()
    const manager = new GitManager(database)
    await writeFile(join(repo, 'README.md'), 'alterado\n')
    await manager.discardUnstaged(sourceId, null, ['README.md'])
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('# fixture\n')
    expect(await manager.undoState(sourceId, null)).toEqual({ undo: null, redo: null })
  })

  it('stash: desfazer devolve as alterações, refazer guarda de novo', async () => {
    const { manager, repo, sourceId } = await setup()
    await writeFile(join(repo, 'README.md'), 'alterado\n'); await writeFile(join(repo, 'novo.txt'), 'novo\n')
    await manager.sync(sourceId, null, 'stash')
    expect(await out(repo, 'status', '--porcelain')).toBe('')
    await manager.undoLast(sourceId, null)
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('alterado\n'); expect(await readFile(join(repo, 'novo.txt'), 'utf8')).toBe('novo\n')
    expect(await out(repo, 'stash', 'list')).toBe('')
    await manager.redoLast(sourceId, null)
    expect(await out(repo, 'status', '--porcelain')).toBe(''); expect((await out(repo, 'stash', 'list')).split('\n')).toHaveLength(1)
  })

  it('stash de um arquivo só mexe nele; outro stash depois recusa o desfazer', async () => {
    const { manager, repo, sourceId } = await setup()
    await writeFile(join(repo, 'README.md'), 'alterado\n'); await writeFile(join(repo, 'outro.txt'), 'outro\n')
    await manager.stashFile(sourceId, null, 'README.md')
    expect(await readFile(join(repo, 'outro.txt'), 'utf8')).toBe('outro\n')
    await manager.undoLast(sourceId, null)
    expect(await readFile(join(repo, 'README.md'), 'utf8')).toBe('alterado\n')
    await manager.redoLast(sourceId, null)
    await git(repo, 'stash', 'push', '--include-untracked')
    await manager.undoLast(sourceId, null).then(() => { throw new Error('devia recusar') }, (error: Error) => expect(error.message).toMatch(/Outro stash/))
  })

  it('apagar stash: desfazer põe de volta na lista, refazer apaga', async () => {
    const { manager, repo, sourceId } = await setup()
    await writeFile(join(repo, 'README.md'), 'alterado\n')
    await git(repo, 'stash', 'push', '-m', 'meu stash')
    const hash = await out(repo, 'rev-parse', 'stash@{0}')
    await manager.stashAction(sourceId, { action: 'drop', ref: 'stash@{0}' })
    expect(await out(repo, 'stash', 'list')).toBe('')
    expect((await manager.undoState(sourceId, null)).undo?.label).toBe('apagar o stash "On main: meu stash"')
    await manager.undoLast(sourceId, null)
    expect(await out(repo, 'rev-parse', 'stash@{0}')).toBe(hash); expect(await out(repo, 'stash', 'list')).toContain('meu stash')
    await manager.redoLast(sourceId, null)
    expect(await out(repo, 'stash', 'list')).toBe('')
  })

  it('ignorar: desfazer apaga o .gitignore que não existia; com um existente, volta o anterior', async () => {
    const { manager, repo, sourceId } = await setup()
    await writeFile(join(repo, 'debug.log'), 'x\n')
    await manager.ignoreFile(sourceId, null, 'debug.log', 'file')
    expect(await readFile(join(repo, '.gitignore'), 'utf8')).toBe('/debug.log\n')
    await manager.undoLast(sourceId, null)
    expect(await exists(join(repo, '.gitignore'))).toBe(false)
    await manager.redoLast(sourceId, null)
    expect(await readFile(join(repo, '.gitignore'), 'utf8')).toBe('/debug.log\n')
    await manager.undoLast(sourceId, null)
    await writeFile(join(repo, '.gitignore'), 'node_modules\n'); await git(repo, 'add', '.gitignore'); await git(repo, 'commit', '-m', 'ignore')
    await writeFile(join(repo, 'a.log'), 'x\n')
    await manager.ignoreFile(sourceId, null, 'a.log', 'extension')
    expect(await readFile(join(repo, '.gitignore'), 'utf8')).toBe('node_modules\n*.log\n')
    await writeFile(join(repo, '.gitignore'), 'node_modules\n*.log\nmais\n')
    await expect(manager.undoLast(sourceId, null)).rejects.toThrow(/\.gitignore mudou/)
  })
})

describe('limpeza da pilha e proteção contra o gc', () => {
  it('push limpa a pilha; fetch não', async () => {
    const { manager, repo, sourceId } = await setup({ remote: true })
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    await manager.commit({ sourceId, cardId: null, message: 'um' })
    await manager.sync(sourceId, null, 'fetch')
    expect((await manager.undoState(sourceId, null)).undo?.label).toBe('commit "um"')
    await manager.sync(sourceId, null, 'push')
    expect(await manager.undoState(sourceId, null)).toEqual({ undo: null, redo: null })
    expect(await refs(repo)).toEqual([])
  })

  it('merge e cherry-pick também limpam', async () => {
    const { manager, repo, sourceId } = await setup()
    for (const [name, file] of [['dev', 'd.txt'], ['dev2', 'e.txt']] as const) { await git(repo, 'checkout', '-b', name, 'main'); await writeFile(join(repo, file), 'x\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-m', name) }
    await git(repo, 'checkout', 'main')
    const mark = async (message: string): Promise<void> => { await writeFile(join(repo, `${message}.txt`), 'a\n'); await git(repo, 'add', '.'); await manager.commit({ sourceId, cardId: null, message }) }
    await mark('um')
    expect((await manager.undoState(sourceId, null)).undo).not.toBeNull()
    await manager.commitAction(sourceId, { action: 'cherry-pick', hash: await out(repo, 'rev-parse', 'dev') })
    expect(await manager.undoState(sourceId, null)).toEqual({ undo: null, redo: null })
    await mark('dois')
    await manager.branchAction(sourceId, { action: 'merge', name: 'dev2' })
    expect(await manager.undoState(sourceId, null)).toEqual({ undo: null, redo: null })
    expect(await refs(repo)).toEqual([])
  })

  it('as refs de proteção existem enquanto a entrada vive e somem quando ela sai', async () => {
    const { manager, repo, sourceId } = await setup()
    const first = await head(repo)
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    const one = (await manager.commit({ sourceId, cardId: null, message: 'um' })).hash
    const pinned = await refs(repo)
    expect(pinned).toHaveLength(2)
    expect(await Promise.all(pinned.map((ref) => out(repo, 'rev-parse', ref)))).toEqual(expect.arrayContaining([first, one]))
    await manager.undoLast(sourceId, null)
    await writeFile(join(repo, 'b.txt'), 'b\n'); await git(repo, 'add', 'b.txt')
    const two = (await manager.commit({ sourceId, cardId: null, message: 'dois' })).hash
    const now = await Promise.all((await refs(repo)).map((ref) => out(repo, 'rev-parse', ref)))
    expect(now.sort()).toEqual([first, two].sort())
  })

  it('ao abrir, apaga as refs e as cópias que sobraram da sessão anterior', async () => {
    const { database, repo, backup, projectId } = await setup()
    await git(repo, 'update-ref', 'refs/gearmod/undo/velha-0', await head(repo))
    await mkdir(join(backup, 'velha'), { recursive: true }); await writeFile(join(backup, 'velha', 'x'), 'x')
    const reopened = new GitManager(database, undefined, undefined, undefined, undefined, backup)
    await reopened.repos(projectId)
    expect(await refs(repo)).toEqual([])
    expect(await readdir(backup)).toEqual([])
  })

  it('apagar a pasta de cópias junto com a entrada: sair da pilha remove os arquivos copiados', async () => {
    const { manager, repo, backup, sourceId } = await setup()
    await writeFile(join(repo, 'README.md'), 'alterado\n')
    await manager.discardUnstaged(sourceId, null, ['README.md'])
    expect(await readdir(backup)).toHaveLength(1)
    await writeFile(join(repo, 'a.txt'), 'a\n'); await git(repo, 'add', 'a.txt')
    await manager.undoLast(sourceId, null)
    await manager.commit({ sourceId, cardId: null, message: 'ação nova' })
    expect(await readdir(backup)).toEqual([])
  })
})
