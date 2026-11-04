// Samples call edges that only one side has and shows the code line, to judge by hand.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const [root, ours, cgFile, n = '20', seed = '7'] = process.argv.slice(2)
let s = Number(seed)
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
const cg = new DatabaseSync(cgFile, { readOnly: true })
const me = new DatabaseSync(ours, { readOnly: true })
const skip = (p) => p.startsWith('spike/')
const key = (sp, tp, tn) => `${sp}|${tp}#${tn}`
const theirs = new Map()
for (const r of cg.prepare(`select e.line, s.file_path sp, t.file_path tp, t.name tn, t.qualified_name tq from edges e join nodes s on s.id = e.source join nodes t on t.id = e.target where e.kind = 'calls'`).all()) if (!skip(r.sp) && !skip(r.tp)) theirs.set(key(r.sp, r.tp, r.tn), r)
const mine = new Map()
for (const r of me.prepare(`select e.line, e.conf, ts.path sp, tt.path tp, d.name tn, d.qname tq from edges e join symbols s on s.id = e.src join trees ts on ts.sha = s.sha and ts.root = e.root join symbols d on d.id = e.dst join trees tt on tt.sha = d.sha and tt.root = e.root where e.root = ? and e.kind in ('calls','renders')`).all(root)) if (!skip(r.sp) && !skip(r.tp)) mine.set(key(r.sp, r.tp, r.tn), r)
const lineOf = (p, l) => { try { return readFileSync(join(root, p), 'utf8').split(/\r?\n/)[l - 1].trim().slice(0, 150) } catch { return '?' } }
const pick = (arr) => arr.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).slice(0, Number(n)).map((x) => x[1])
console.log('== só CodeGraph')
for (const [, r] of pick([...theirs].filter(([k]) => !mine.has(k)))) console.log(`${r.sp}:${r.line} -> ${r.tq} (${r.tp})\n    ${lineOf(r.sp, r.line)}`)
console.log('\n== só nosso')
for (const [, r] of pick([...mine].filter(([k]) => !theirs.has(k)))) console.log(`${r.sp}:${r.line} -> ${r.tq} (${r.tp}) conf ${r.conf}\n    ${lineOf(r.sp, r.line)}`)
