// Compara as arestas do protótipo com as do CodeGraph (mesma pasta). Chave: tipo + arquivo:linha da chamada + arquivo e nome do destino.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')

const [root, ours = 'g2.sqlite', cgFile = root + '/.codegraph/codegraph.db', show = '15'] = process.argv.slice(2)
const cg = new DatabaseSync(cgFile, { readOnly: true })
const me = new DatabaseSync(ours, { readOnly: true })
const skip = (p) => p.startsWith('spike/')

const theirs = new Map()
for (const r of cg.prepare(`select e.kind, e.line, s.file_path sp, s.qualified_name sq, t.file_path tp, t.name tn, t.kind tk from edges e join nodes s on s.id = e.source join nodes t on t.id = e.target where e.kind in ('calls','instantiates','references','extends','implements')`).all()) {
  if (skip(r.sp) || skip(r.tp)) continue
  const kind = r.kind === 'references' ? 'references' : r.kind
  theirs.set(`${kind}|${r.sp}:${r.line}|${r.tp}#${r.tn}`, r)
}
const mine = new Map()
for (const r of me.prepare(`select e.kind, e.line, e.conf, ts.path sp, s.qname sq, tt.path tp, d.name tn, d.kind tk from edges e join symbols s on s.id = e.src join trees ts on ts.sha = s.sha and ts.root = e.root join symbols d on d.id = e.dst join trees tt on tt.sha = d.sha and tt.root = e.root where e.root = ?`).all(root)) {
  if (skip(r.sp) || skip(r.tp)) continue
  const kind = r.kind === 'renders' ? 'calls' : r.kind
  mine.set(`${kind}|${r.sp}:${r.line}|${r.tp}#${r.tn}`, r)
}
// O CodeGraph guarda uma aresta por linha de chamada; nós guardamos a primeira linha por par. Comparamos também por par (sem linha).
const pair = (k) => k.replace(/:\d+\|/, '|')
const theirPairs = new Map([...theirs].map(([k, v]) => [pair(k), v]))
const myPairs = new Map([...mine].map(([k, v]) => [pair(k), v]))
for (const kind of ['calls', 'instantiates', 'references', 'extends', 'implements']) {
  const T = [...theirPairs.keys()].filter((k) => k.startsWith(kind + '|'))
  const M = [...myPairs.keys()].filter((k) => k.startsWith(kind + '|'))
  const both = M.filter((k) => theirPairs.has(k)).length
  console.log(`${kind.padEnd(13)} codegraph=${T.length} nosso=${M.length} em comum=${both} cobertura=${T.length ? ((both / T.length) * 100).toFixed(0) : '-'}% concordancia=${M.length ? ((both / M.length) * 100).toFixed(0) : '-'}%`)
}
const n = Number(show)
const missed = [...theirPairs].filter(([k]) => k.startsWith('calls|') && !myPairs.has(k))
const extra = [...myPairs].filter(([k]) => k.startsWith('calls|') && !theirPairs.has(k))
console.log(`\n-- calls que só o CodeGraph tem (${missed.length}), amostra:`)
for (const [k, v] of missed.sort(() => Math.random() - 0.5).slice(0, n)) console.log('  ', v.sp + ':' + v.line, v.sq, '->', v.tp + '#' + v.tn, v.tk)
console.log(`\n-- calls que só nós temos (${extra.length}), amostra:`)
for (const [k, v] of extra.sort(() => Math.random() - 0.5).slice(0, n)) console.log('  ', v.sp + ':' + v.line, v.sq, '->', v.tp + '#' + v.tn, v.tk, 'conf', v.conf)
