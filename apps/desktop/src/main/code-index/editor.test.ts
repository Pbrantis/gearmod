import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHostHandler } from './host-handler'
import type { HostMessage, HostRequest } from './protocol'
import { CodeIndexService, type HostProcess } from './service'
import { editorCodeQueries, rootOf } from './editor'

const dirs: string[] = []
const closers: Array<() => void> = []
afterEach(async () => { for (const close of closers.splice(0)) close(); await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
const temp = async (): Promise<string> => { const dir = await mkdtemp(join(tmpdir(), 'gearmod-code-editor-')); dirs.push(dir); return dir }

/** Fake utility process: the same host handler, in the same process. */
function fakeHost(): HostProcess {
  const listeners: Array<(message: HostMessage) => void> = []
  const handler = createHostHandler((message) => listeners.forEach((listener) => listener(message)))
  const host: HostProcess = {
    postMessage(message) {
      const { id, request } = message as { id: number; request: HostRequest }
      handler.handle(request).then((value) => listeners.forEach((listener) => listener({ id, ok: true, value })), (error: unknown) => listeners.forEach((listener) => listener({ id, ok: false, error: (error as Error).message })))
    },
    on(event: string, listener: never) { if (event === 'message') listeners.push(listener); return host },
    kill() { handler.close(); return true }
  }
  closers.push(() => handler.close())
  return host
}

async function setup(enabled = true, settings?: { enabled(projectId: string): boolean; setEnabled(projectId: string, enabled: boolean): void }) {
  const api = await temp(), web = await temp(), data = await temp()
  await mkdir(join(api, 'src')); await mkdir(join(web, 'src'))
  await writeFile(join(api, 'src', 'paths.ts'), 'export class PathGuard {\n  allowed(path: string): boolean {\n    return path.length > 0\n  }\n}\nexport function allowedPath(roots: string[], requested: string): string {\n  return requested\n}\n')
  await writeFile(join(api, 'src', 'files.ts'), "import { allowedPath } from './paths'\nexport function readFile(roots: string[], path: string): string {\n  return allowedPath(roots, path)\n}\n")
  await writeFile(join(web, 'src', 'view.ts'), 'export function allowedPath(): boolean { return true }\n')
  const service = new CodeIndexService({ dataDir: data, fork: fakeHost, enabled: () => enabled })
  closers.push(() => service.dispose())
  const context = { projectId: 'p', cardId: null }
  return { api, web, context, code: editorCodeQueries(service, () => [api, web], settings) }
}

describe('code index queries for the editor', () => {
  it('finds the deepest folder containing the file and returns the path with /', () => {
    expect(rootOf([join('C:', 'w', 'repo'), join('C:', 'w', 'repo', 'pkg')], join('C:', 'w', 'repo', 'pkg', 'src', 'a.ts'))).toEqual({ root: join('C:', 'w', 'repo', 'pkg'), relative: 'src/a.ts' })
    expect(rootOf([join('C:', 'w', 'repo')], join('C:', 'w', 'other', 'a.ts'))).toBeNull()
    expect(rootOf([join('C:', 'w', 'repo')], join('C:', 'w', 'repo'))).toBeNull()
  })

  it('searches symbols in all folders, with absolute and relative paths', async () => {
    const { api, web, context, code } = await setup()
    const hits = await code.symbols({ ...context, query: 'allowedPath' })
    expect(hits.map((hit) => [hit.path, hit.relative, hit.line])).toEqual(expect.arrayContaining([[join(api, 'src', 'paths.ts'), 'src/paths.ts', 6], [join(web, 'src', 'view.ts'), 'src/view.ts', 1]]))
  })

  it('gives the file structure with nesting', async () => {
    const { api, context, code } = await setup()
    const outline = await code.outline({ ...context, path: join(api, 'src', 'paths.ts') })
    expect(outline.map((item) => [item.name, item.depth, item.line, item.endLine])).toEqual([['PathGuard', 0, 1, 5], ['allowed', 1, 2, 4], ['allowedPath', 0, 6, 8]])
    expect(await code.outline({ ...context, path: join(tmpdir(), 'fora.ts') })).toEqual([])
  })

  it('puts first the definition from the folder being asked from and lists who uses it', async () => {
    const { api, web, context, code } = await setup()
    const fromWeb = await code.definition({ ...context, name: 'allowedPath', path: join(web, 'src', 'view.ts') })
    expect(fromWeb[0]!.path).toBe(join(web, 'src', 'view.ts'))
    const fromApi = await code.definition({ ...context, name: 'allowedPath', path: join(api, 'src', 'files.ts') })
    expect(fromApi[0]!.path).toBe(join(api, 'src', 'paths.ts'))
    const uses = await code.references({ ...context, name: 'allowedPath', path: join(api, 'src', 'files.ts') })
    expect(uses).toContainEqual({ path: join(api, 'src', 'files.ts'), relative: 'src/files.ts', line: 3, caller: expect.stringContaining('readFile') as unknown as string })
  })

  it('reports the state of each folder; when off, everything comes back empty', async () => {
    const on = await setup()
    await on.code.symbols({ ...on.context, query: 'readFile' })
    const status = await on.code.status(on.context)
    expect(status.enabled).toBe(true)
    expect(status.roots.map((root) => root.files)).toEqual([2, 1])
    const off = await setup(false)
    expect(await off.code.symbols({ ...off.context, query: 'readFile' })).toEqual([])
    expect(await off.code.status(off.context)).toEqual({ enabled: false, roots: [] })
  })

  it('turns off and on per project; reindexing returns the state of each folder', async () => {
    const disabled = new Set<string>()
    const settings = { enabled: (projectId: string) => !disabled.has(projectId), setEnabled: (projectId: string, on: boolean) => { if (on) disabled.delete(projectId); else disabled.add(projectId) } }
    const { context, code } = await setup(true, settings)
    expect(await code.symbols({ ...context, query: 'readFile' })).not.toEqual([])
    expect(await code.setEnabled({ projectId: 'p', enabled: false })).toEqual({ enabled: false, roots: [] })
    expect(disabled.has('p')).toBe(true)
    expect(await code.symbols({ ...context, query: 'readFile' })).toEqual([])
    expect(await code.reindex({ projectId: 'p' })).toEqual({ enabled: false, roots: [] })
    const on = await code.setEnabled({ projectId: 'p', enabled: true })
    expect(on.enabled).toBe(true)
    expect(on.roots.map((root) => [root.files, root.indexedAt !== null])).toEqual([[2, true], [1, true]])
    const again = await code.reindex({ projectId: 'p' })
    expect(again.roots.map((root) => root.files)).toEqual([2, 1])
    expect(await code.symbols({ ...context, query: 'readFile' })).not.toEqual([])
  })
})
