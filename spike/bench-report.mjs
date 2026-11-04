// Summarizes the claude -p JSON files: tokens, cost, turns and duration per question and configuration (average of the repetitions).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const rows = []
for (const f of readdirSync(dir).filter((f) => /^q\d+-.+-\d+\.json$/.test(f))) {
  const [q, cfg] = f.replace(/\.json$/, '').split('-')
  const raw = readFileSync(join(dir, f), 'utf8')
  let j
  try { j = JSON.parse(raw.slice(raw.indexOf('{'))) } catch { rows.push({ q, cfg, error: 'saída inválida' }); continue }
  if (j.is_error) { rows.push({ q, cfg, error: j.result?.slice(0, 80) }); continue }
  const u = j.usage ?? {}
  rows.push({ q, cfg, input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, cost: j.total_cost_usd ?? 0, turns: j.num_turns ?? 0, sec: (j.duration_ms ?? 0) / 1000 })
}
const groups = new Map()
for (const r of rows) { const k = `${r.q} ${r.cfg}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r) }
const avg = (list, f) => list.reduce((a, r) => a + (r[f] ?? 0), 0) / list.length
let md = '| pergunta | config | execuções | tokens de entrada | tokens de saída | custo US$ | turnos | segundos |\n|---|---|---|---|---|---|---|---|\n'
for (const [k, list] of [...groups].sort()) {
  const ok = list.filter((r) => !r.error)
  const [q, cfg] = k.split(' ')
  if (!ok.length) { md += `| ${q} | ${cfg} | 0/${list.length} | erro: ${list[0].error} | | | | |\n`; continue }
  md += `| ${q} | ${cfg} | ${ok.length}/${list.length} | ${Math.round(avg(ok, 'input')).toLocaleString('pt-BR')} | ${Math.round(avg(ok, 'output')).toLocaleString('pt-BR')} | ${avg(ok, 'cost').toFixed(3)} | ${avg(ok, 'turns').toFixed(1)} | ${avg(ok, 'sec').toFixed(0)} |\n`
}
console.log(md)
writeFileSync(join(dir, 'RESULTADO.md'), md)
console.log(`(salvo em ${join(dir, 'RESULTADO.md')}; as respostas completas estão nos q*-*.json)`)
