// Joins runs, scores and the metadata of repositories and questions into flat CSV files for the analysis.
//   node bench/export.mjs pilot,main,generalization      one or more experiments (ids)
// Output in bench-data/results/_dataset/: runs.csv (one row per run) and toolcalls.csv (one row per tool call, in order).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BENCH, QUESTIONS, RESULTS, WORK, args, list, readJson, readJsonl } from './lib/util.mjs'

const opt = args()
const ids = list(opt._[0])
if (!ids.length) { console.error('usage: node bench/export.mjs <experiment ids, comma separated>'); process.exit(1) }
const repos = Object.fromEntries(readJson(join(BENCH, 'config', 'repos.json')).repos.map((repo) => [repo.id, repo]))
const stats = existsSync(join(WORK, 'repo-stats.json')) ? readJson(join(WORK, 'repo-stats.json')) : {}
const catalogs = {}
const question = (repo, id) => (catalogs[repo] ??= existsSync(join(QUESTIONS, `${repo}.json`)) ? readJson(join(QUESTIONS, `${repo}.json`)).questions : []).find((q) => q.id === id)
// identifiers cited in the question (camelCase, snake_case, Class.method, file names): a likely predictor of the graph's gain
const identifiers = (text) => (text.match(/\b[A-Za-z_$][\w$]*(?:[A-Z_.][\w$]*)+\b|\b[\w-]+\.(?:ts|tsx|js|py|go|java|cs|rs|php|rb|c|cpp|h)\b/g) ?? []).filter((word) => /[A-Z_.]/.test(word.slice(1))).length

const columns = ['key', 'experiment', 'repo', 'repo_role', 'repo_tier', 'repo_langs', 'repo_files', 'repo_lines', 'question', 'qtype', 'variant', 'lang', 'q_words', 'q_identifiers', 'config', 'agent', 'cli', 'model', 'effort', 'rep', 'ok', 'error', 'sec', 'turns', 'tool_calls', 'graph_calls', 'read_calls', 'search_calls', 'input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens', 'total_input_tokens', 'cost_usd', 'cost_source', 'must_total', 'must_hit', 'recall', 'errors', 'judge_recall', 'check_passed', 'started_at']
const rows = []
const calls = []
for (const id of ids) {
  const latest = new Map(readJsonl(join(RESULTS, id, 'runs.jsonl')).map((record) => [record.key, record]))
  const scores = new Map(readJsonl(join(RESULTS, id, 'scores.jsonl')).map((score) => [score.key, score]))
  for (const record of latest.values()) {
    const repo = repos[record.repo] ?? {}
    const q = question(record.repo, record.question) ?? {}
    const text = (q.variants ?? []).find((variant) => variant.id === record.variant)?.text ?? ''
    const score = scores.get(record.key) ?? {}
    const tools = record.toolCalls ?? []
    rows.push({
      key: `${id}:${record.key}`, experiment: id, repo: record.repo, repo_role: repo.role ?? '', repo_tier: repo.tier ?? '', repo_langs: (repo.langs ?? []).join('+'), repo_files: stats[record.repo]?.sourceFiles ?? '', repo_lines: stats[record.repo]?.sourceLines ?? '',
      question: record.question, qtype: record.qtype, variant: record.variant, lang: record.lang, q_words: text.split(/\s+/).filter(Boolean).length, q_identifiers: identifiers(text),
      config: record.config, agent: record.agent, cli: record.cli, model: record.model, effort: record.effort ?? '', rep: record.rep,
      ok: record.ok ? 1 : 0, error: record.error ?? '', sec: record.sec ?? '', turns: record.turns ?? '',
      tool_calls: tools.length, graph_calls: tools.filter((name) => name.startsWith('mcp__')).length, read_calls: tools.filter((name) => name === 'Read').length, search_calls: tools.filter((name) => name === 'Grep' || name === 'Glob' || name === 'shell').length,
      input_tokens: record.inputTokens ?? '', cache_read_tokens: record.cacheReadTokens ?? '', cache_write_tokens: record.cacheWriteTokens ?? '', output_tokens: record.outputTokens ?? '',
      total_input_tokens: (record.inputTokens ?? 0) + (record.cacheReadTokens ?? 0) + (record.cacheWriteTokens ?? 0),
      cost_usd: record.costUsd ?? '', cost_source: record.costSource ?? '',
      must_total: score.mustTotal ?? '', must_hit: score.mustHit ?? '', recall: score.recall ?? '', errors: score.errors ?? '', judge_recall: score.judgeRecall ?? '', check_passed: record.checkPassed == null ? '' : record.checkPassed ? 1 : 0, started_at: record.startedAt
    })
    tools.forEach((tool, seq) => calls.push({ key: `${id}:${record.key}`, seq, tool, config: record.config, agent: record.agent, repo: record.repo, qtype: record.qtype }))
  }
}
const csv = (cols, data) => [cols.join(','), ...data.map((row) => cols.map((col) => { const value = row[col] ?? ''; const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text }).join(','))].join('\n') + '\n'
const out = join(RESULTS, '_dataset')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'runs.csv'), csv(columns, rows))
writeFileSync(join(out, 'toolcalls.csv'), csv(['key', 'seq', 'tool', 'config', 'agent', 'repo', 'qtype'], calls))
console.log(`${rows.length} runs and ${calls.length} tool calls in ${out}`)
