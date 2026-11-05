// Moves checked drafts into the catalog bench-data/questions/<repo>.json, applying the checker's verdicts:
// "fix" facts get the corrected label and pattern, "wrong" facts are dropped, "missing" facts are added, and questions
// the checker would drop (keep: false) are left out unless --keep-all.
//   node bench/promote-drafts.mjs typedoc              → status "checked" (runs only with --checked)
//   node bench/promote-drafts.mjs typedoc --approve    → status "reviewed", after a person read <repo>.review.md
// Questions already in the catalog keep their own version; drafts with the same id are skipped.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BENCH, QUESTIONS, args, readJson, writeJson } from './lib/util.mjs'

const opt = args()
const repo = opt._[0]
const draftsFile = join(QUESTIONS, `${repo}.drafts.json`)
if (!repo || !existsSync(draftsFile)) { console.error('usage: node bench/promote-drafts.mjs <repo> [--approve] [--keep-all]'); process.exit(1) }
const drafts = readJson(draftsFile)
if (!drafts.checked && !opt['no-check']) { console.error(`run node bench/check-drafts.mjs ${repo} first (or pass --no-check)`); process.exit(1) }
const catalogFile = join(QUESTIONS, `${repo}.json`)
const catalog = existsSync(catalogFile) ? readJson(catalogFile) : { repo, questions: [] }
const have = new Set(catalog.questions.map((q) => q.id))
const status = opt.approve ? 'reviewed' : 'checked'
let added = 0, dropped = 0, fixed = 0, removed = 0, extra = 0
for (const q of drafts.questions) {
  if (have.has(q.id)) continue
  // a question the checker would drop only because facts were missing is kept with those facts; one it finds
  // ambiguous (nothing to add) is left out
  if (q.check?.keep === false && !(q.check.missing ?? []).length && !opt['keep-all']) { dropped++; continue }
  const facts = []
  for (const fact of q.facts) {
    const verdict = fact.check?.verdict
    if (verdict === 'wrong') { removed++; continue }
    if (verdict === 'fix' && fact.check.fixedPattern) { fixed++; facts.push({ id: fact.id, label: fact.check.fixedLabel ?? fact.label, pattern: fact.check.fixedPattern, ...(fact.kind ? { kind: fact.kind } : {}), origin: 'fixed by checker' }); continue }
    facts.push({ id: fact.id, label: fact.label, pattern: fact.pattern, ...(fact.kind ? { kind: fact.kind } : {}) })
  }
  for (const miss of q.check?.missing ?? []) { extra++; facts.push({ id: miss.id, label: miss.label, pattern: miss.pattern, origin: 'added by checker' }) }
  const valid = facts.filter((fact) => { try { new RegExp(fact.pattern, 'i'); return true } catch { return false } })
  if (valid.filter((fact) => fact.kind !== 'bad').length < 2) { dropped++; continue }
  catalog.questions.push({ id: q.id, type: q.type, status, variants: q.variants, facts: valid, ...(q.notes ? { notes: q.notes } : {}), source: { drafted: drafts.drafted?.model ?? null, checked: drafts.checked?.model ?? null } })
  added++
}
writeJson(catalogFile, catalog)
console.log(`${repo}: ${added} questions added as "${status}" (${dropped} left out), ${fixed} facts fixed, ${removed} removed, ${extra} added → ${catalogFile}`)
