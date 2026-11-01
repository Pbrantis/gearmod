// Sorteia arestas de um projeto (sem referência externa) e mostra a linha de código e o destino, para julgar à mão.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const [root, dbFile, n = '20', kinds = 'calls,instantiates', seed = '11'] = process.argv.slice(2)
let s = Number(seed)
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
const db = new DatabaseSync(dbFile, { readOnly: true })
const rows = db.prepare(`select e.kind, e.line, e.conf, ts.path sp, s.qname sq, tt.path tp, d.qname dq, d.kind dk, d.line dl from edges e join symbols s on s.id = e.src join trees ts on ts.sha = s.sha and ts.root = e.root join symbols d on d.id = e.dst join trees tt on tt.sha = d.sha and tt.root = e.root where e.root = ? and e.kind in (${kinds.split(',').map(() => '?').join(',')})`).all(root, ...kinds.split(','))
const lineOf = (p, l) => { try { return readFileSync(join(root, p), 'utf8').split(/\r?\n/)[l - 1].trim().slice(0, 160) } catch { return '?' } }
for (const r of rows.map((x) => [rnd(), x]).sort((a, b) => a[0] - b[0]).slice(0, Number(n)).map((x) => x[1])) {
  console.log(`[${r.kind} conf ${r.conf}] ${r.sp}:${r.line} -> ${r.dk} ${r.dq} (${r.tp}:${r.dl})\n    ${lineOf(r.sp, r.line)}`)
}
