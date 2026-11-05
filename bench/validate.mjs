// Checks question catalogs before a run: structure, regexes, and that every file:line a fact cites exists in the
// prepared checkout (a stale line number is the most common error in an answer key).
//   node bench/validate.mjs            all catalogs
//   node bench/validate.mjs typedoc
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BENCH, QUESTIONS, WORK, args, list, readJson } from './lib/util.mjs'

const opt = args()
const wanted = list(opt._[0])
const TYPES = new Set(['locate', 'flow', 'impact', 'tests', 'vague', 'edit'])
let problems = 0
const cache = new Map()
function files(root) {
  if (!cache.has(root)) {
    const out = []
    const walk = (dir, prefix) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { if (['.git', 'node_modules'].includes(entry.name)) continue; if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`); else out.push(`${prefix}${entry.name}`) } }
    walk(root, '')
    cache.set(root, out)
  }
  return cache.get(root)
}
const warn = (message) => { problems++; console.log(`  ! ${message}`) }
// not an error by itself: the line may name the symbol differently; worth a look in the review
let suspects = 0
const suspect = (message) => { suspects++; if (opt.verbose) console.log(`  ? ${message}`) }

// --drafts checks the <repo>.drafts.json files instead of the catalogs
const pattern = opt.drafts ? /^[\w-]+\.drafts\.json$/ : /^[\w-]+\.json$/
for (const file of readdirSync(QUESTIONS).filter((name) => pattern.test(name) && (opt.drafts || !name.includes('.drafts')))) {
  const repo = file.replace(/(\.drafts)?\.json$/, '')
  if (wanted.length && !wanted.includes(repo)) continue
  const catalog = readJson(join(QUESTIONS, file))
  const root = join(WORK, 'repos', repo)
  const counts = {}
  console.log(`== ${repo} (${catalog.questions.length} questions)`)
  const ids = new Set()
  for (const q of catalog.questions) {
    if (ids.has(q.id)) warn(`${q.id}: duplicated id`)
    ids.add(q.id)
    if (!TYPES.has(q.type)) warn(`${q.id}: unknown type ${q.type}`)
    counts[`${q.type}/${q.status}`] = (counts[`${q.type}/${q.status}`] ?? 0) + 1
    if (!q.variants?.length) warn(`${q.id}: no variants`)
    if (q.type === 'edit' && !q.edit?.check) warn(`${q.id}: edit task without edit.check`)
    if (!q.facts?.length && q.type !== 'edit') warn(`${q.id}: no facts`)
    for (const fact of q.facts ?? []) {
      try { new RegExp(fact.pattern, 'i') } catch (error) { warn(`${q.id}/${fact.id}: invalid regex (${error.message})`); continue }
      // a cited file:line in the label must exist in the checkout
      for (const [, path, line] of (fact.label ?? '').matchAll(/([\w./-]+\.\w+):(\d+)/g)) {
        if (!existsSync(root)) break
        // labels may give only the end of the path (file-viewer.ts): match it against the checkout's files
        // "a/.../b/File.java" = any path ending in b/File.java under a
        const [head, tail] = path.includes('.../') ? [path.slice(0, path.indexOf('.../')), path.slice(path.indexOf('.../') + 4)] : ['', path]
        const matches = files(root).filter((item) => (item === tail || item.endsWith(`/${tail}`)) && item.startsWith(head))
        if (!matches.length) { warn(`${q.id}/${fact.id}: ${path} not found in the checkout`); continue }
        const texts = matches.map((item) => readFileSync(join(root, item), 'utf8').split('\n'))
        if (texts.every((text) => Number(line) > text.length)) { warn(`${q.id}/${fact.id}: ${path} is shorter than line ${line}`); continue }
        // the line (±3) should mention one of the identifiers the label names
        const ids = [...(fact.label ?? '').replace(/[\w./-]+\.\w+:\d+/g, ' ').matchAll(/[A-Za-z_$][\w$]{3,}/g)].map((m) => m[0]).filter((word) => /[A-Z_]|[a-z][A-Z]/.test(word.slice(1)) || /\(\)/.test(word))
        if (ids.length && !texts.some((text) => text.slice(Math.max(0, Number(line) - 4), Number(line) + 3).some((row) => ids.some((id) => row.includes(id.split('.').at(-1)))))) suspect(`${q.id}/${fact.id}: ${path}:${line} does not mention ${ids.slice(0, 3).join(', ')}`)
      }
    }
  }
  console.log(`  ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join('  ')}`)
}
console.log(problems ? `${problems} problem(s)` : 'no problems found')
if (suspects) console.log(`${suspects} fact(s) whose cited line does not mention the symbol in the label (--verbose lists them)`)
process.exit(problems ? 1 : 0)
