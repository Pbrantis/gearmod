// Mede o tempo de extração por linguagem (uma thread) numa amostra de arquivos.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from './graph/indexer.mjs'
import { langOf } from './graph/langs.mjs'
import { extract } from './graph/extract.mjs'

const root = process.argv[2]
const n = Number(process.argv[3] ?? 200)
const { files } = listFiles(root)
const by = {}
for (const p of [...files.keys()].slice(0, n * 3)) {
  const lang = langOf(p)
  const b = (by[lang] ??= { files: 0, bytes: 0, ms: 0, worst: [0, ''] })
  if (b.files >= n) continue
  let src
  try { src = readFileSync(join(root, p), 'utf8') } catch { continue }
  const t = performance.now()
  await extract(lang, src)
  const ms = performance.now() - t
  b.files++; b.bytes += src.length; b.ms += ms
  if (ms > b.worst[0]) b.worst = [Math.round(ms), p]
}
for (const [l, b] of Object.entries(by)) console.log(l.padEnd(11), `${b.files} arquivos`, `${(b.bytes / 1e6).toFixed(1)} MB`, `${Math.round(b.ms)} ms`, `${(b.ms / b.files).toFixed(1)} ms/arquivo`, 'pior:', b.worst)
