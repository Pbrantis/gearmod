// Detalha o uso por configuração: tokens novos (escrita no cache, mais caros), lidos do cache (baratos), turnos.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

for (const dir of process.argv.slice(2)) {
  const agg = {}
  for (const f of readdirSync(dir).filter((f) => /^q\d+-.+-\d+\.json$/.test(f))) {
    const cfg = f.split('-')[1]
    const raw = readFileSync(join(dir, f), 'utf8')
    let j
    try { j = JSON.parse(raw.slice(raw.indexOf('{'))) } catch { continue }
    const u = j.usage ?? {}
    const a = (agg[cfg] ??= { runs: 0, fresh: 0, cacheWrite: 0, cacheRead: 0, out: 0, turns: 0, cost: 0 })
    a.runs++; a.fresh += u.input_tokens ?? 0; a.cacheWrite += u.cache_creation_input_tokens ?? 0; a.cacheRead += u.cache_read_input_tokens ?? 0; a.out += u.output_tokens ?? 0; a.turns += j.num_turns ?? 0; a.cost += j.total_cost_usd ?? 0
  }
  console.log(`\n== ${dir} (média por execução)`)
  console.log('config      turnos  escrita-cache  leitura-cache  saída   custo   escrita/turno')
  for (const [c, a] of Object.entries(agg)) {
    const n = a.runs
    console.log(`${c.padEnd(11)} ${(a.turns / n).toFixed(1).padStart(6)} ${Math.round(a.cacheWrite / n).toLocaleString('pt-BR').padStart(14)} ${Math.round(a.cacheRead / n).toLocaleString('pt-BR').padStart(14)} ${Math.round(a.out / n).toLocaleString('pt-BR').padStart(6)} ${(a.cost / n).toFixed(3).padStart(7)} ${Math.round(a.cacheWrite / a.turns).toLocaleString('pt-BR').padStart(14)}`)
  }
}
