// node cli.mjs <folder> <command> [args…]   (database in spike/graph.sqlite)
//   index | status | search <q> | explore <q> | node <symbol> [file] | file <file> [--symbols]
//   callers <s> | callees <s> | impact <s> | files [folder] | affected [files…] | map [tokens]
import { CodeIndex } from './graph/index.mjs'

const [root, cmd, ...args] = process.argv.slice(2)
const ci = new CodeIndex(process.env.GRAPH_DB ?? new URL('./graph.sqlite', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
const exclude = (process.env.GRAPH_EXCLUDE ?? 'spike').split(',').filter(Boolean)
const t0 = Date.now()
let out
if (cmd === 'index') out = JSON.stringify(await ci.index(root, { exclude }), null, 1)
else {
  if (!ci.db.prepare('select 1 from roots where root = ?').get(root)) await ci.index(root, { exclude })
  const q = ci.q(root)
  const a = args.join(' ')
  out = cmd === 'status' ? q.status()
    : cmd === 'search' ? q.search(a, { limit: 15 })
    : cmd === 'explore' ? q.explore(a)
    : cmd === 'node' ? q.node({ symbol: args[0], file: args[1], includeCode: true })
    : cmd === 'file' ? q.node({ file: args[0], symbolsOnly: args.includes('--symbols') })
    : cmd === 'callers' ? q.callers(args[0], { depth: Number(args[1] ?? 1) })
    : cmd === 'callees' ? q.callees(args[0], { depth: Number(args[1] ?? 1) })
    : cmd === 'impact' ? q.impact(args[0], { depth: Number(args[1] ?? 2) })
    : cmd === 'files' ? q.filesTree({ path: args[0] ?? '', depth: args[1] ? Number(args[1]) : undefined })
    : cmd === 'affected' ? q.affected({ files: args })
    : cmd === 'map' ? q.map({ tokens: Number(args[0] ?? 1500) })
    : 'comando desconhecido'
}
console.log(out)
console.error(`\n[${Date.now() - t0} ms · ${out.length} caracteres ≈ ${Math.round(out.length / 4)} tokens]`)
ci.close()
