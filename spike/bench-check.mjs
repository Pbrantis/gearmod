// Confere as respostas do benchmark contra o gabarito do conjunto (spike/bench-sets/<set>.json).
// Uso: node spike/bench-check.mjs <pasta-dos-resultados> [set]   (padrão: agentboard)
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, set = 'agentboard'] = process.argv.slice(2)
const cfg = JSON.parse(readFileSync(new URL(`./bench-sets/${set}.json`, import.meta.url), 'utf8'))
const facts = Object.fromEntries(Object.entries(cfg.facts).map(([q, list]) => [q, list.map(([label, re, bad]) => [label, new RegExp(re), !!bad])]))
const rows = {}
const score = {}
for (const f of readdirSync(dir).filter((f) => /^q\d+-.+-\d+\.json$/.test(f)).sort()) {
  const [q, cfgName, i] = f.replace(/\.json$/, '').split('-')
  if (!facts[q]) continue
  const raw = readFileSync(join(dir, f), 'utf8')
  let text = ''
  try { text = JSON.parse(raw.slice(raw.indexOf('{'))).result ?? '' } catch { text = '' }
  const hits = facts[q].map(([label, re, bad]) => ({ label, ok: re.test(text), bad }))
  const good = hits.filter((h) => !h.bad && h.ok).length
  const total = hits.filter((h) => !h.bad).length
  const errors = hits.filter((h) => h.bad && h.ok).map((h) => h.label)
  ;(score[cfgName] ??= { good: 0, total: 0, errors: 0 })
  score[cfgName].good += good; score[cfgName].total += total; score[cfgName].errors += errors.length
  ;(rows[q] ??= []).push(`${cfgName.padEnd(10)} #${i}: ${good}/${total} fatos${errors.length ? ' · ERRO: ' + errors.join(', ') : ''}${good < total ? ' · faltou: ' + hits.filter((h) => !h.bad && !h.ok).map((h) => h.label).join('; ') : ''}`)
}
for (const [q, list] of Object.entries(rows)) console.log(`\n== ${q}\n` + list.join('\n'))
console.log('\n== total')
for (const [c, s] of Object.entries(score)) console.log(`${c.padEnd(10)} ${s.good}/${s.total} fatos (${Math.round((s.good / s.total) * 100)}%)${s.errors ? ` · ${s.errors} erros conhecidos` : ''}`)
