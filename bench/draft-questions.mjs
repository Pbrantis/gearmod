// Drafts questions and facts for a repository with an agent WITHOUT the index under test (only Read, Grep and Glob),
// so the answer key does not lean on the tool being measured. Every draft must be checked by a person before use.
//   node bench/draft-questions.mjs typedoc --per-type 6 --model sonnet
// Output: bench-data/questions/<repo>.drafts.json. Review each question, fix the facts, set "status": "reviewed" and move it
// into bench-data/questions/<repo>.json. Then run node bench/validate.mjs <repo>.
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BENCH, QUESTIONS, WORK, agentEnv, args, run } from './lib/util.mjs'

const opt = args()
const repo = opt._[0]
if (!repo) { console.error('usage: node bench/draft-questions.mjs <repo> [--per-type 6] [--model sonnet] [--types locate,flow,impact,tests,vague,edit]'); process.exit(1) }
const root = join(WORK, 'repos', repo)
if (!existsSync(root)) { console.error(`run node bench/prepare.mjs ${repo} first`); process.exit(1) }
const perType = Number(opt['per-type'] ?? 6)
const types = String(opt.types ?? 'locate,flow,impact,tests,vague').split(',')

const prompt = `You are building a benchmark that measures how well coding agents answer questions about THIS repository. Explore the code with Read, Grep and Glob and write ${perType} questions for each type: ${types.join(', ')}.

Types:
- locate: where something is implemented ("Where is X validated, and who calls it?")
- flow: how a request or piece of data moves through several files and functions
- impact: what must change if a named function/method/class is renamed or its signature changes (all call sites)
- tests: which test files cover a given function or module
- vague: a question in plain words, with NO identifiers from the code ("How does the app handle an expired session?")
- edit: a small, well-defined change with an existing test command that proves it (only if asked)

Rules:
- Every question must have a single checkable answer in the current code. Spread the questions over different parts of the project.
- Prefer questions whose answer spans 2-6 files. Avoid trivia that one grep answers.
- facts: 3 to 8 per question, each one a thing a correct answer must contain. Verify every fact by reading the code; write the exact path and line.
- pattern: a JavaScript regex (case-insensitive) that matches an answer stating the fact. For a file+line use "<escaped path tail>[\\\\s\\\\S]{0,150}?\\\\b<line>\\\\b"; for a symbol use its name. Keep patterns tolerant to wording.
- Add a fact with "kind": "bad" only for a tempting WRONG claim you saw while exploring (a same-name function elsewhere, an old code path).
- variants: the same question in Portuguese (lang "pt") and in English (lang "en").

Reply with JSON only, no text around it:
{"questions":[{"id":"<type>-<short-slug>","type":"<type>","status":"draft","variants":[{"id":"pt","lang":"pt","text":"..."},{"id":"en","lang":"en","text":"..."}],"facts":[{"id":"<slug>","label":"<what and where, path:line>","pattern":"<regex>"}],"notes":"<how you verified it>"}]}`

console.log(`drafting ${perType} × ${types.length} questions for ${repo} (this takes a few minutes)…`)
const res = await run(process.env.BENCH_CLAUDE ?? 'claude', ['-p', '--output-format', 'json', '--model', String(opt.model ?? 'sonnet'), '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob', '--max-turns', '200', '--no-session-persistence', '--disable-slash-commands', '--setting-sources', 'project', '--strict-mcp-config'], { cwd: root, env: agentEnv(), input: prompt, timeoutMs: 60 * 60 * 1000 })
let outer
try { outer = JSON.parse(res.stdout) } catch { console.error(res.stderr || res.stdout.slice(-2000)); process.exit(1) }
const text = String(outer.result ?? '')
let drafts
try { drafts = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch { writeFileSync(join(QUESTIONS, `${repo}.drafts.raw.txt`), text); console.error('the answer was not valid JSON; saved as .drafts.raw.txt'); process.exit(1) }
const bad = []
for (const q of drafts.questions ?? []) for (const fact of q.facts ?? []) { try { new RegExp(fact.pattern, 'i') } catch { bad.push(`${q.id}/${fact.id}`) } }
const file = join(QUESTIONS, `${repo}.drafts.json`)
writeFileSync(file, `${JSON.stringify({ repo, drafted: { at: new Date().toISOString(), model: opt.model ?? 'sonnet', costUsd: outer.total_cost_usd ?? null, note: 'drafted by an agent without the index; review every fact before use' }, ...drafts }, null, 2)}\n`)
console.log(`${drafts.questions?.length ?? 0} drafts in ${file} (US$ ${(outer.total_cost_usd ?? 0).toFixed(2)})${bad.length ? `; invalid regex in ${bad.join(', ')}` : ''}`)
