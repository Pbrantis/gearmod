import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createHostHandler } from './host-handler'
import type { HostMessage, HostRequest } from './protocol'
import { CodeIndexService, type HostProcess } from './service'

const dirs: string[] = []
const closers: Array<() => void> = []
afterEach(async () => { closers.splice(0).forEach((close) => close()); await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
const temp = async (): Promise<string> => { const dir = await mkdtemp(join(tmpdir(), 'gearmod-code-service-')); dirs.push(dir); return dir }

/** Fake process: runs the same utilityProcess code, inside the test itself. */
function fakeHost(): HostProcess & { killed: boolean } {
  const listeners: Array<(message: HostMessage) => void> = []
  const exits: Array<(code: number) => void> = []
  const handler = createHostHandler((message) => listeners.forEach((listener) => listener(message)))
  const host = {
    killed: false,
    postMessage(message: unknown) {
      const { id, request } = message as { id: number; request: HostRequest }
      handler.handle(request).then((value) => listeners.forEach((listener) => listener({ id, ok: true, value })), (error: unknown) => listeners.forEach((listener) => listener({ id, ok: false, error: String((error as Error).message ?? error) })))
    },
    on(event: 'message' | 'exit', listener: never) { if (event === 'message') listeners.push(listener); else exits.push(listener); return host },
    kill() { host.killed = true; handler.close(); exits.forEach((exit) => exit(0)); return true }
  }
  closers.push(() => { if (!host.killed) host.kill() })
  return host as HostProcess & { killed: boolean }
}

describe('CodeIndexService', () => {
  it('abre o processo no primeiro uso, indexa a pasta e responde às ferramentas', async () => {
    const data = await temp(), root = await temp()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src', 'paths.ts'), 'export function allowedPath(roots: string[], requested: string): string { return requested }\n')
    await writeFile(join(root, 'src', 'files.ts'), "import { allowedPath } from './paths'\nexport function readFile(roots: string[], path: string): string { return allowedPath(roots, path) }\n")
    let forks = 0
    const service = new CodeIndexService({ dataDir: data, fork: () => { forks++; return fakeHost() } })
    expect(forks).toBe(0)
    expect(service.isTool('gearmod_code_impact')).toBe(true)
    const impact = await service.tool('gearmod_code_impact', { simbolo: 'allowedPath' }, [root])
    expect(impact).toContain('readFile:2 — calls at lines 2')
    const explore = await service.tool('gearmod_code_explore', { pergunta: 'readFile allowedPath' }, [root])
    expect(explore).toContain('**Flow')
    expect((await service.symbols(root, 'read'))[0]).toMatchObject({ name: 'readFile', path: 'src/files.ts', line: 2 })
    expect(forks).toBe(1)
    await expect(service.tool('gearmod_code_search', {}, [root])).rejects.toThrow('consulta')
    await expect(service.tool('gearmod_code_search', { consulta: 'x' }, [join(root, 'nao-existe')])).rejects.toThrow('no project folder')
    service.dispose()
  })

  it('com várias pastas, responde uma seção por pasta; desligado, recusa', async () => {
    const data = await temp(), a = await temp(), b = await temp()
    await writeFile(join(a, 'a.ts'), 'export function alpha(): void {}\n')
    await writeFile(join(b, 'b.py'), 'def beta():\n    pass\n')
    let enabled = true
    const service = new CodeIndexService({ dataDir: data, fork: fakeHost, enabled: () => enabled })
    const text = await service.tool('gearmod_code_search', { consulta: 'alpha beta' }, [a, b])
    expect(text).toMatch(/# .+\n\nfunction alpha[\s\S]*# .+\n\nfunction beta/)
    enabled = false
    await expect(service.tool('gearmod_code_search', { consulta: 'alpha' }, [a])).rejects.toThrow('turned off')
    service.dispose()
  })
})
