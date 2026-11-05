// Scores the answers of an experiment against the facts of each question.
//   node bench/score.mjs experiments/pilot.json                  regex check (free, instant)
//   node bench/score.mjs experiments/pilot.json --judge haiku    also asks a model to judge each fact (costs a little)
//   node bench/score.mjs experiments/pilot.json --review 0.1     writes review.csv: a random 10% of (run, fact) for a person to mark
// Output: bench-data/results/<experiment>/scores.jsonl (one line per run; rerunning rewrites it).
import { existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BENCH, QUESTIONS, RESULTS, agentEnv, args, readJson, readJsonl, run, shuffle } from './lib/util.mjs'

const opt = args()
const exp = readJson(resolve(BENCH, opt._[0]))
const dir = join(RESULTS, exp.id)
const runs = readJsonl(join(dir, 'runs.jsonl'))
const catalogs = {}
const question = (repo, id) => {
  catalogs[repo] ??= existsSync(join(QUESTIONS, `${repo}.json`)) ? readJson(join(QUESTIONS, `${repo}.json`)).questions : []
  return catalogs[repo].find((q) => q.id === id)
}

// the latest record of each key (a retried run replaces the failed one)
const latest = new Map()
for (const record of runs) latest.set(record.key, record)

const previous = new Map(readJsonl(join(dir, 'scores.jsonl')).map((score) => [score.key, score]))
const judgeModel = opt.judge === true ? 'haiku' : opt.judge

async function judge(q, variant, answer) {
  const must = q.facts.filter((fact) => fact.kind !== 'bad')
  const prompt = `You grade an answer about a codebase against a fixed list of facts. For each fact, say true only if the answer clearly states it (same file, symbol or line; wording may differ). Do not use outside knowledge.\n\nQuestion:\n${variant.text}\n\nFacts:\n${must.map((fact) => `- ${fact.id}: ${fact.label}`).join('\n')}\n\nAnswer to grade:\n<<<\n${answer.slice(0, 30000)}\n>>>\n\nReply with JSON only: {"facts": {"<id>": true|false, ...}, "wrong_claims": <number of clearly wrong file/line/symbol claims>}`
  const res = await run(process.env.BENCH_CLAUDE ?? 'claude', ['-p', '--output-format', 'json', '--model', judgeModel, '--tools', 'Read', '--max-turns', '2', '--no-session-persistence', '--disable-slash-commands', '--setting-sources', 'project', '--strict-mcp-config'], { env: agentEnv(), input: prompt, timeoutMs: 180000 })
  try {
    const outer = JSON.parse(res.stdout)
    const text = String(outer.result ?? '')
    const inner = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return { model: judgeModel, facts: inner.facts ?? {}, wrongClaims: inner.wrong_claims ?? null, costUsd: outer.total_cost_usd ?? null }
  } catch { return { model: judgeModel, error: res.stderr.slice(-200) || 'unparsable judge output' } }
}

const scores = []
for (const record of latest.values()) {
  const q = question(record.repo, record.question)
  if (!q) continue
  const variant = (q.variants ?? []).find((item) => item.id === record.variant) ?? q.variants?.[0]
  const answer = record.answer ?? ''
  const facts = q.facts.map((fact) => ({ id: fact.id, kind: fact.kind ?? 'must', hit: record.ok ? new RegExp(fact.pattern, 'i').test(answer) : false }))
  const must = facts.filter((fact) => fact.kind !== 'bad')
  const score = {
    key: record.key, ok: record.ok,
    facts: Object.fromEntries(facts.map((fact) => [fact.id, fact.hit])),
    mustTotal: must.length, mustHit: must.filter((fact) => fact.hit).length,
    recall: must.length ? must.filter((fact) => fact.hit).length / must.length : null,
    errors: facts.filter((fact) => fact.kind === 'bad' && fact.hit).length,
    checkPassed: record.checkPassed ?? null
  }
  if (judgeModel && record.ok) {
    const before = previous.get(record.key)?.judge
    score.judge = before && before.model === judgeModel && !before.error ? before : await judge(q, variant, answer)
    const values = Object.values(score.judge.facts ?? {})
    score.judgeRecall = values.length ? values.filter(Boolean).length / values.length : null
    process.stdout.write('.')
  } else if (previous.get(record.key)?.judge) { score.judge = previous.get(record.key).judge; score.judgeRecall = previous.get(record.key).judgeRecall }
  scores.push(score)
}
writeFileSync(join(dir, 'scores.jsonl'), scores.map((score) => JSON.stringify(score)).join('\n') + '\n')

// summary per configuration × agent
const groups = {}
for (const score of scores) {
  const record = latest.get(score.key)
  const key = `${record.config} · ${record.agent}`
  const group = (groups[key] ??= { runs: 0, ok: 0, recall: 0, judge: 0, judged: 0, errors: 0 })
  group.runs++
  if (score.ok) { group.ok++; group.recall += score.recall ?? 0; group.errors += score.errors }
  if (score.judgeRecall != null) { group.judge += score.judgeRecall; group.judged++ }
}
console.log(`\n${'configuration · agent'.padEnd(36)} runs  ok   regex recall  judge recall  known errors`)
for (const [key, group] of Object.entries(groups).sort()) console.log(`${key.padEnd(36)} ${String(group.runs).padStart(4)} ${String(group.ok).padStart(3)}   ${group.ok ? (group.recall / group.ok * 100).toFixed(0).padStart(5) + '%' : '    -'}        ${group.judged ? (group.judge / group.judged * 100).toFixed(0).padStart(5) + '%' : '    -'}        ${group.errors}`)

// sample for a human to mark, to measure how far the regex and the judge agree with a person (Cohen's kappa)
if (opt.review) {
  const share = Number(opt.review)
  const rows = []
  for (const score of scores.filter((item) => item.ok)) {
    const record = latest.get(score.key)
    const q = question(record.repo, record.question)
    for (const fact of q.facts.filter((item) => item.kind !== 'bad')) rows.push({ key: score.key, question: q.id, fact: fact.id, label: fact.label, regex: score.facts[fact.id] ? 1 : 0, judge: score.judge?.facts?.[fact.id] === undefined ? '' : score.judge.facts[fact.id] ? 1 : 0 })
  }
  const sample = shuffle(rows, exp.seed ?? 1).slice(0, Math.max(1, Math.round(rows.length * share)))
  const csv = ['key,question,fact,label,regex,judge,human', ...sample.map((row) => [row.key, row.question, row.fact, `"${row.label.replaceAll('"', '""')}"`, row.regex, row.judge, ''].join(','))].join('\n')
  writeFileSync(join(dir, 'review.csv'), `${csv}\n`)
  console.log(`\nreview.csv: ${sample.length} rows. Fill the "human" column with 1/0 by reading the answer in transcripts/ (field result); analysis/analyze.py computes the agreement.`)
}
