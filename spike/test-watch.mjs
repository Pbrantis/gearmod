// Tests the watcher: creates a new function in a file, waits for the index to update, queries; then undoes.
import { CodeIndex } from './graph/index.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
const ci = new CodeIndex('graph.sqlite')
console.log('index', await ci.index(root, { exclude: ['spike'] }))
const updates = []
ci.watch(root, { exclude: ['spike'], onUpdate: (r) => updates.push(r) })
const file = join(root, 'apps/desktop/src/main/file-viewer.ts')
const orig = readFileSync(file, 'utf8')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return Date.now() - t; await wait(50) } return -1 }
try {
  const t0 = Date.now()
  writeFileSync(file, orig + '\nexport function spikeNovaFuncao(roots: string[]): Promise<string> { return allowedPath(roots, "") }\n')
  const took = await until(() => updates.length > 0)
  console.log('atualizou em', took, 'ms (incluindo debounce de 300 ms)', updates.at(-1))
  console.log(ci.q(root).node({ symbol: 'spikeNovaFuncao' }).split('\n').slice(0, 6).join('\n'))
  console.log(ci.q(root).callers('allowedPath').split('\n').filter((l) => l.includes('spikeNova')))
  updates.length = 0
  writeFileSync(file, orig)
  await until(() => updates.length > 0)
  console.log('desfeito:', updates.at(-1), '| ainda existe?', ci.q(root).find('spikeNovaFuncao').length)
  console.log('total', Date.now() - t0, 'ms')
} finally {
  writeFileSync(file, orig)
  ci.close()
}
