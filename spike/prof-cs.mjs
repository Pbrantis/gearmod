// Separates parse time from query time, by default, on C# files (or another language).
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { listFiles } from './graph/indexer.mjs'
import { langOf, LANGUAGES } from './graph/langs.mjs'

const require = createRequire(import.meta.url)
const TS = require('@vscode/tree-sitter-wasm')
const WASM = dirname(require.resolve('@vscode/tree-sitter-wasm'))
const [root, lang = 'csharp', n = '150'] = process.argv.slice(2)
await TS.Parser.init({ locateFile: (f) => join(WASM, f) })
const grammar = await TS.Language.load(readFileSync(join(WASM, `tree-sitter-${LANGUAGES[lang].wasm}.wasm`)))
const parser = new TS.Parser(); parser.setLanguage(grammar)
const patterns = LANGUAGES[lang].queries.split('\n').map((l) => l.trim()).filter(Boolean).flatMap((l) => { try { return [[l, new TS.Query(grammar, l)]] } catch { return [] } })
const all = new TS.Query(grammar, patterns.map((p) => p[0]).join('\n'))
const files = [...listFiles(root).files.keys()].filter((p) => langOf(p) === lang).slice(0, Number(n))
let parseMs = 0, allMs = 0
const per = new Map()
for (const p of files) {
  const src = readFileSync(join(root, p), 'utf8')
  let t = performance.now(); const tree = parser.parse(src); parseMs += performance.now() - t
  t = performance.now(); all.matches(tree.rootNode); allMs += performance.now() - t
  for (const [l, q] of patterns) { t = performance.now(); q.matches(tree.rootNode); per.set(l, (per.get(l) ?? 0) + performance.now() - t) }
  tree.delete()
}
console.log(`${files.length} arquivos · parse ${Math.round(parseMs)} ms · consultas juntas ${Math.round(allMs)} ms`)
for (const [l, ms] of [...per].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${Math.round(ms)} ms  ${l.slice(0, 110)}`)
