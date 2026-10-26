import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listProjectDirectory, readProjectFile, searchProjectFiles, writeProjectFile } from './file-viewer'

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
