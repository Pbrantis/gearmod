import { mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileWatchService } from './file-watch'

const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

/** Espera até `count` eventos (ou 2 s) e devolve o que chegou. */
const collect = (events: Array<Record<string, unknown>>, count: number): Promise<void> => new Promise((resolve) => { const started = Date.now(); const timer = setInterval(() => { if (events.length >= count || Date.now() - started > 2000) { clearInterval(timer); resolve() } }, 20) })

describe('FileWatchService', () => {
  it('avisa quando o arquivo muda, é trocado por rename e é apagado', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gearmod-watch-')); dirs.push(dir)
    const file = join(dir, 'a.txt'); await writeFile(file, 'um')
    const events: Array<Record<string, unknown>> = [], service = new FileWatchService((_type, payload) => events.push(payload), 40)
    service.watch('janela', [file])
    await writeFile(file, 'dois'); await collect(events, 1)
    expect(events[0]).toEqual({ path: file })
    // O agente costuma gravar num temporário e trocar: o watcher precisa seguir o arquivo novo.
    await writeFile(join(dir, 'novo.tmp'), 'tres'); await rename(join(dir, 'novo.tmp'), file); await collect(events, 2)
    expect(events.length).toBeGreaterThanOrEqual(2)
    const before = events.length
    await writeFile(file, 'quatro'); await collect(events, before + 1)
    expect(events.length).toBeGreaterThan(before)
    await unlink(file); await collect(events, events.length + 1)
    expect(events.at(-1)).toEqual({ path: file, deleted: true })
    service.dispose()
  })
  it('lista vazia para de vigiar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gearmod-watch-')); dirs.push(dir)
    const file = join(dir, 'b.txt'); await writeFile(file, 'x')
    const events: Array<Record<string, unknown>> = [], service = new FileWatchService((_type, payload) => events.push(payload), 30)
    service.watch('janela', [file]); service.watch('janela', [])
    await writeFile(file, 'y'); await new Promise((resolve) => setTimeout(resolve, 200))
    expect(events).toEqual([])
    service.dispose()
  })
})
