// Second opinion on drafted questions, by a different model (Codex by default) that opens every cited file and line.
// It never changes the question text; it annotates each question and fact with a verdict and, when needed, a fix.
//   node bench/check-drafts.mjs typedoc [--model gpt-6.1-terra]
// Writes the verdicts into bench-data/questions/<repo>.drafts.json (field "check" on each question and fact) and a summary
// for the human reviewer in bench-data/questions/<repo>.review.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BENCH, QUESTIONS, WORK, agentEnv, args, readJson, run } from './lib/util.mjs'
import { codexSandbox } from './lib/agents.mjs'

const opt = args()
const repo = opt._[0]
const file = join(QUESTIONS, `${repo}.drafts.json`)
if (!repo || !existsSync(file)) { console.error('usage: node bench/check-drafts.mjs <repo>  (needs questions/<repo>.drafts.json)'); process.exit(1) }
const root = join(WORK, 'repos', repo)
const drafts = readJson(file)
const model = String(opt.model ?? readJson(join(BENCH, 'config', 'agents.json')).agents.find((agent) => agent.cli === 'codex')?.model ?? 'gpt-6.1-terra')

const slim = drafts.questions.map((q) => ({ id: q.id, type: q.type, question: q.variants?.find((v) => v.lang === 'en')?.text ?? q.variants?.[0]?.text, facts: q.facts.map((fact) => ({ id: fact.id, kind: fact.kind ?? 'must', label: fact.label, pattern: fact.pattern })) }))
const prompt = `You are reviewing the answer key of a benchmark about this repository. Another model wrote these questions and facts; your job is to catch its mistakes. Open the code and check every fact yourself: read each cited file at the cited line. Do not modify any file.

For each question:
- keep: false if the question is ambiguous, has no single checkable answer, or its facts miss something a correct answer must contain; say why.
- For each fact: verdict "ok" (exactly right), "fix" (right idea, wrong path/line/name: give fixed_label and fixed_pattern), or "wrong" (not true in this code).
- fixed_pattern follows the same style: a case-insensitive JavaScript regex; for a file+line use "<escaped path tail>[\\\\s\\\\S]{0,150}?\\\\b<line>\\\\b".
- missing: facts a correct answer must contain that the list lacks (same shape as a fact: id, label, pattern). Empty if none.

Questions (JSON):
${JSON.stringify(slim)}

Reply with JSON only:
{"questions":[{"id":"...","keep":true,"reason":"...","facts":[{"id":"...","verdict":"ok|fix|wrong","fixed_label":"...","fixed_pattern":"...","note":"..."}],"missing":[{"id":"...","label":"...","pattern":"..."}]}]}`

let verdicts, usage
if (opt['md-only']) {
  // --md-only rebuilds review.md from the verdicts already stored in the drafts, without calling the checker again
  if (!drafts.checked) { console.error('no stored verdicts; run without --md-only first'); process.exit(1) }
  verdicts = { questions: drafts.questions.map((q) => ({ id: q.id, keep: q.check?.keep, reason: q.check?.reason, missing: q.check?.missing ?? [], facts: q.facts.map((fact) => ({ id: fact.id, verdict: fact.check?.verdict, fixed_label: fact.check?.fixedLabel, fixed_pattern: fact.check?.fixedPattern, note: fact.check?.note })) })) }
  usage = drafts.checked.usage
} else {
  const last = join(WORK, 'logs', `check-${repo}.last.txt`)
  console.log(`checking ${drafts.questions.length} questions of ${repo} with ${model}…`)
  const res = await run(process.env.BENCH_CODEX ?? 'codex', ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', ...codexSandbox(false), '-m', model, '-c', 'model_reasoning_effort="medium"', '-C', root, '-o', last, '-'], { cwd: root, env: agentEnv(), input: prompt, timeoutMs: 90 * 60 * 1000 })
  const text = existsSync(last) ? readFileSync(last, 'utf8') : ''
  try { verdicts = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) } catch { console.error(`no JSON from the checker (exit ${res.code}): ${res.stderr.slice(-500)}`); process.exit(1) }
  if (!(verdicts.questions ?? []).length) { console.error(`the checker returned no verdicts: ${verdicts.error ?? text.slice(0, 300)}`); process.exit(1) }
  usage = res.stdout.split('\n').map((line) => { try { return JSON.parse(line) } catch { return null } }).filter((event) => event?.type === 'turn.completed').map((event) => event.usage)
}

const byId = new Map((verdicts.questions ?? []).map((item) => [item.id, item]))
const counts = { ok: 0, fix: 0, wrong: 0, unchecked: 0, dropped: 0, missing: 0 }
const md = [`# Revisão do gabarito: ${repo}`, '', `Checagem automática por ${model} em ${new Date().toISOString().slice(0, 10)}. Leia as perguntas marcadas; as outras podem ser aprovadas com uma leitura rápida.`, '']
for (const q of drafts.questions) {
  const v = byId.get(q.id)
  q.check = v ? { by: model, keep: v.keep !== false, reason: v.reason ?? '', missing: v.missing ?? [] } : { by: model, keep: null, reason: 'not checked' }
  if (v?.keep === false) counts.dropped++
  counts.missing += (v?.missing ?? []).length
  const flagged = []
  for (const fact of q.facts) {
    const fv = (v?.facts ?? []).find((item) => item.id === fact.id)
    fact.check = fv ? { verdict: fv.verdict, fixedLabel: fv.fixed_label ?? null, fixedPattern: fv.fixed_pattern ?? null, note: fv.note ?? '' } : { verdict: 'unchecked' }
    counts[fact.check.verdict] = (counts[fact.check.verdict] ?? 0) + 1
    if (fact.check.verdict !== 'ok') flagged.push(`- \`${fact.id}\` **${fact.check.verdict}**: ${fact.label}${fact.check.fixedLabel ? ` → ${fact.check.fixedLabel}` : ''}${fact.check.note ? ` (${fact.check.note})` : ''}`)
  }
  for (const miss of v?.missing ?? []) flagged.push(`- falta: ${miss.label}`)
  const verdict = v?.keep === false ? ((v.missing ?? []).length ? ' — completar o gabarito' : ' — descartar?') : ''
  if (v?.keep === false || flagged.length) md.push(`## ${q.id}${verdict}`, '', q.variants?.[0]?.text ?? '', '', ...(v?.reason ? [`Motivo: ${v.reason}`, ''] : []), ...flagged, '')
}
drafts.checked = { at: new Date().toISOString(), model, usage }
writeFileSync(file, `${JSON.stringify(drafts, null, 2)}\n`)
md.splice(3, 0, `Fatos: ${counts.ok} certos, ${counts.fix} a corrigir, ${counts.wrong} errados${counts.unchecked ? `, ${counts.unchecked} sem verificação` : ''}. Perguntas a descartar: ${counts.dropped}. Fatos faltando: ${counts.missing}.`, '')
writeFileSync(join(QUESTIONS, `${repo}.review.md`), `${md.join('\n')}\n`)
console.log(`${repo}: ${JSON.stringify(counts)}`)
