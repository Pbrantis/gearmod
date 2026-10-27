import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProjectItem, listProjectDirectory, readProjectFile, renameProjectItem, saveMarkdownImage, searchProjectFiles, trashablePath, validateName, writeProjectFile } from './file-viewer'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
const temp = async (): Promise<string> => { const dir = await mkdtemp(join(tmpdir(), 'agentboard-file-')); dirs.push(dir); return dir }

describe('readProjectFile', () => {
  it('lê por caminho relativo ou absoluto e ignora :linha', async () => {
    const root = await temp(); await mkdir(join(root, 'docs')); await writeFile(join(root, 'docs', 'a.md'), '# Oi')
    expect((await readProjectFile([root], 'docs/a.md')).content).toBe('# Oi')
    expect((await readProjectFile([root], join(root, 'docs', 'a.md'))).relative).toBe('docs/a.md')
    expect((await readProjectFile([root], 'docs/a.md:12')).content).toBe('# Oi')
  })
  it('preserva caracteres de caminho no explorador, incluindo #', async () => {
    const root = await temp(); await writeFile(join(root, 'nota #1.md'), '# Nota')
    expect((await readProjectFile([root], join(root, 'nota #1.md'), true)).content).toBe('# Nota')
  })
  it('usa a primeira raiz que tem o arquivo (worktree antes do projeto)', async () => {
    const worktree = await temp(), project = await temp(); await writeFile(join(project, 'x.txt'), 'projeto')
    expect((await readProjectFile([worktree, project], 'x.txt')).content).toBe('projeto')
    await writeFile(join(worktree, 'x.txt'), 'worktree')
    expect((await readProjectFile([worktree, project], 'x.txt')).content).toBe('worktree')
  })
  it('recusa caminhos fora das raízes, inclusive por link simbólico', async () => {
    const root = await temp(), outside = await temp(); await writeFile(join(outside, 'segredo.txt'), 'nao')
    await expect(readProjectFile([root], join(outside, 'segredo.txt'))).rejects.toThrow('não encontrado')
    await expect(readProjectFile([root], '../segredo.txt')).rejects.toThrow('não encontrado')
    try { await symlink(outside, join(root, 'atalho'), 'junction'); await expect(readProjectFile([root], 'atalho/segredo.txt')).rejects.toThrow('não encontrado') } catch (reason) { if (!(reason instanceof Error) || !/EPERM|EACCES/.test(reason.message)) throw reason }
  })
  it('marca binário e corta arquivo grande', async () => {
    const root = await temp(); await writeFile(join(root, 'b.bin'), Buffer.from([1, 0, 2])); await writeFile(join(root, 'big.txt'), 'a'.repeat(1_100_000))
    expect((await readProjectFile([root], 'b.bin')).binary).toBe(true)
    const big = await readProjectFile([root], 'big.txt'); expect(big.truncated).toBe(true); expect(big.content.length).toBe(1_000_000)
  })
  it('lista diretórios e pesquisa arquivos sem entrar nas dependências', async () => {
    const root = await temp(); await mkdir(join(root, 'src')); await mkdir(join(root, 'node_modules'))
    await writeFile(join(root, 'src', 'app.ts'), 'const app = true'); await writeFile(join(root, 'node_modules', 'app.ts'), 'pacote')
    expect((await listProjectDirectory([root], root)).map((item) => item.name)).toEqual(['node_modules', 'src'])
    expect(await searchProjectFiles([root], 'app.ts')).toEqual({ paths: [join(await realpath(root), 'src', 'app.ts')], limited: false })
  })
  it('busca aproximada compara letras em ordem no caminho dentro da raiz', async () => {
    const root = await temp(); await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'WorkspaceFiles.tsx'), ''); await writeFile(join(root, 'src', 'workspace.ts'), '')
    const found = await searchProjectFiles([root], 'wsf', true), real = await realpath(root)
    expect(found.paths).toEqual([join(real, 'src', 'WorkspaceFiles.tsx')])
    expect((await searchProjectFiles([root], 'wsf')).paths).toEqual([])
    expect((await searchProjectFiles([root], 'zzzz', true)).paths).toEqual([])
  })
  it('grava e trunca o texto usando a versão esperada, sem sobrescrever alterações externas', async () => {
    const root = await temp(), path = join(root, 'edit.ts'); await writeFile(path, 'texto original')
    await writeProjectFile([root], path, 'novo', 'texto original')
    expect((await readProjectFile([root], path)).content).toBe('novo')
    await writeFile(path, 'edição do agente')
    await expect(writeProjectFile([root], path, 'minha edição', 'novo')).rejects.toThrow('mudou no disco')
    expect((await readProjectFile([root], path)).content).toBe('edição do agente')
  })
  it('bloqueia listagem e gravação fora da raiz e em arquivos binários ou truncados', async () => {
    const root = await temp(), outside = await temp(), path = join(outside, 'a.txt'); await writeFile(path, 'externo')
    await expect(listProjectDirectory([root], outside)).rejects.toThrow('fora das pastas')
    await expect(writeProjectFile([root], path, 'alterado', 'externo')).rejects.toThrow('fora das pastas')
    await writeFile(join(root, 'b.bin'), Buffer.from([0, 1])); await expect(writeProjectFile([root], join(root, 'b.bin'), 'a', '')).rejects.toThrow('binário')
    await writeFile(join(root, 'big.txt'), 'x'.repeat(1_000_001)); await expect(writeProjectFile([root], join(root, 'big.txt'), 'a', '')).rejects.toThrow('não pode ser editado')
  })
})

describe('criar, renomear e excluir', () => {
  it('valida nomes', () => {
    expect(validateName('  ok.ts ')).toBe('ok.ts')
    for (const bad of ['', '..', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'nome.', 'x'.repeat(256)]) expect(() => validateName(bad), bad).toThrow()
  })
  it('cria arquivo e pasta, inclusive com pastas intermediárias, sem sobrescrever', async () => {
    const root = await temp(), real = await realpath(root)
    expect((await createProjectItem([root], root, 'novo.ts', 'file')).path).toBe(join(real, 'novo.ts'))
    expect((await createProjectItem([root], root, 'a/b/c.ts', 'file')).path).toBe(join(real, 'a', 'b', 'c.ts'))
    expect((await listProjectDirectory([root], join(root, 'a'))).map((item) => item.name)).toEqual(['b'])
    await createProjectItem([root], root, 'pasta', 'folder')
    await expect(createProjectItem([root], root, 'novo.ts', 'file')).rejects.toThrow('Já existe')
    await expect(createProjectItem([root], root, 'novo.ts/filho.ts', 'file')).rejects.toThrow('nome de uma das pastas')
    await expect(createProjectItem([root], root, '../fora.ts', 'file')).rejects.toThrow()
  })
  it('recusa criar fora das raízes', async () => {
    const root = await temp(), outside = await temp()
    await expect(createProjectItem([root], outside, 'x.ts', 'file')).rejects.toThrow('fora das pastas')
  })
  it('renomeia dentro da mesma pasta e recusa nome existente, nome com barra e a raiz', async () => {
    const root = await temp(), real = await realpath(root)
    await writeFile(join(root, 'a.ts'), 'a'); await writeFile(join(root, 'b.ts'), 'b')
    expect((await renameProjectItem([root], join(root, 'a.ts'), 'c.ts')).path).toBe(join(real, 'c.ts'))
    expect((await readProjectFile([root], join(root, 'c.ts'), true)).content).toBe('a')
    await expect(renameProjectItem([root], join(root, 'c.ts'), 'b.ts')).rejects.toThrow('Já existe')
    await expect(renameProjectItem([root], join(root, 'c.ts'), '../x.ts')).rejects.toThrow()
    await expect(renameProjectItem([root], root, 'outro')).rejects.toThrow('raiz')
  })
  it('só libera para a Lixeira o que está dentro das raízes e não é a raiz', async () => {
    const root = await temp(), outside = await temp(); await writeFile(join(root, 'a.ts'), 'a'); await writeFile(join(outside, 'x.ts'), 'x')
    expect(await trashablePath([root], join(root, 'a.ts'))).toBe(join(await realpath(root), 'a.ts'))
    await expect(trashablePath([root], root)).rejects.toThrow('raiz')
    await expect(trashablePath([root], join(outside, 'x.ts'))).rejects.toThrow('fora das pastas')
  })
})

describe('saveMarkdownImage', () => {
  const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString('base64'), when = new Date(2026, 9, 27, 14, 5, 9)
  it('grava em imagens/ ao lado do .md com nome por data e hora, sem sobrescrever', async () => {
    const root = await temp(), real = await realpath(root); await mkdir(join(root, 'docs')); await writeFile(join(root, 'docs', 'a.md'), '# a')
    const first = await saveMarkdownImage([root], join(root, 'docs', 'a.md'), png, 'image/png', when)
    expect(first.relative).toBe('imagens/imagem-20261027-140509.png'); expect(first.path).toBe(join(real, 'docs', 'imagens', 'imagem-20261027-140509.png'))
    expect((await saveMarkdownImage([root], join(root, 'docs', 'a.md'), png, 'image/png', when)).relative).toBe('imagens/imagem-20261027-140509-2.png')
    expect((await saveMarkdownImage([root], join(root, 'docs', 'a.md'), png, 'image/jpeg', when)).relative).toBe('imagens/imagem-20261027-140509.jpg')
  })
  it('recusa tipo inválido, vazio, grande e fora das raízes', async () => {
    const root = await temp(), outside = await temp(); await writeFile(join(root, 'a.md'), ''); await writeFile(join(outside, 'x.md'), '')
    await expect(saveMarkdownImage([root], join(root, 'a.md'), png, 'image/svg+xml')).rejects.toThrow('suportado')
    await expect(saveMarkdownImage([root], join(root, 'a.md'), '', 'image/png')).rejects.toThrow('vazia')
    await expect(saveMarkdownImage([root], join(root, 'a.md'), Buffer.alloc(10_000_001).toString('base64'), 'image/png')).rejects.toThrow('10 MB')
    await expect(saveMarkdownImage([root], join(outside, 'x.md'), png, 'image/png')).rejects.toThrow('fora das pastas')
  })
})
