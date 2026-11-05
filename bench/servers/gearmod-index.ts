/**
 * The production code index (apps/desktop/src/main/code-index) outside the app, for the benchmark.
 * Bundled by bench/build.mjs and run with Electron as Node (ELECTRON_RUN_AS_NODE=1), so better-sqlite3 loads
 * with the same build the app uses.
 *
 *   serve                      MCP server on stdio (the gearmod_code_* tools, same names and descriptions as the app)
 *   index                      indexes BENCH_ROOT and prints a JSON line with files, symbols, edges and ms
 *   edges <out.jsonl>          exports the call edges (path:line → definition) for the oracle comparison
 *
 * Variables: BENCH_ROOT (folder), BENCH_DB (sqlite file), BENCH_EXCLUDE (commas), BENCH_TOOLS=core|all,
 * BENCH_WATCH=1 (keeps the index up to date while the agent works), BENCH_DETAIL=resumo (explore defaults to the
 * summary), GEARMOD_INDEX_ABLATE (see ablation.ts).
 */
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { CodeIndex } from '../../apps/desktop/src/main/code-index/code-index'
import { codeToolNames, runCodeTool } from '../../apps/desktop/src/main/code-index/tools'

const root = process.env.BENCH_ROOT ?? process.cwd()
const dbFile = process.env.BENCH_DB ?? 'bench-index.sqlite'
const exclude = (process.env.BENCH_EXCLUDE ?? '').split(',').map((item) => item.trim()).filter(Boolean)

// Same definitions as apps/desktop/resources/gearmod-mcp/server.mjs (codeTools). Keep both in step.
const core = [
  { name: 'gearmod_code_explore', description: 'Main code tool: use it FIRST to understand an area, a flow or a bug, and before editing. In one call it returns the current source of the relevant symbols grouped by file (treat it as already read), the call path between them, what depends on them and the tests. Accepts a natural-language question (also in Portuguese) or names of symbols/files, e.g. "recordExploration codeVersions history.ts". Use Grep for plain text such as error messages.', inputSchema: { type: 'object', properties: { pergunta: { type: 'string', description: 'Question or names of symbols/files' }, detalhe: { type: 'string', enum: ['completo', 'resumo'], description: 'completo (default) includes the code; resumo gives only where each symbol is plus the main excerpts' }, max_arquivos: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['pergunta'], additionalProperties: false } },
  { name: 'gearmod_code_node', description: 'One symbol by name (or Class.method): location, signature, code (codigo=true), who uses it (with the line of each call), what it uses and its tests. With only arquivo, reads the file like Read (numbered lines, offset/limite) and lists the files that depend on it; estrutura=true returns just the file outline.', inputSchema: { type: 'object', properties: { simbolo: { type: 'string' }, arquivo: { type: 'string', description: 'Path or file name; also disambiguates a symbol name' }, codigo: { type: 'boolean' }, linha: { type: 'integer', minimum: 1, description: 'Disambiguates by line' }, offset: { type: 'integer', minimum: 1 }, limite: { type: 'integer', minimum: 1, maximum: 2000 }, estrutura: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'gearmod_code_search', description: 'Quick symbol search by name or words (also in Portuguese). Locations and signatures only, no code.', inputSchema: { type: 'object', properties: { consulta: { type: 'string' }, tipo: { type: 'string', description: 'function, method, class, interface, type, const…' }, limite: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['consulta'], additionalProperties: false } },
  { name: 'gearmod_code_impact', description: 'What is affected if a symbol changes: direct and indirect users by file, with the line of every call, other mentions of the name (strings, mocks, comments, imports) and the tests to run. Use it before a refactor or rename.', inputSchema: { type: 'object', properties: { simbolo: { type: 'string' }, arquivo: { type: 'string', description: 'Disambiguates when several symbols share the name' }, profundidade: { type: 'integer', minimum: 1, maximum: 5 } }, required: ['simbolo'], additionalProperties: false } }
]
const extra = [
  { name: 'gearmod_code_affected_tests', description: 'Test files that depend on the changed files (default: what changed in Git since HEAD). Use it to choose which tests to run.', inputSchema: { type: 'object', properties: { arquivos: { type: 'array', items: { type: 'string' }, maxItems: 200 } }, additionalProperties: false } },
  { name: 'gearmod_code_map', description: 'Overview of the project: the most central files with their classes and functions, within a token budget.', inputSchema: { type: 'object', properties: { tokens: { type: 'integer', minimum: 200, maximum: 6000 }, pasta: { type: 'string' } }, additionalProperties: false } }
]
const tools = process.env.BENCH_TOOLS === 'all' ? [...core, ...extra] : core

async function serve(): Promise<void> {
  const index = new CodeIndex(dbFile)
  const ready = index.index(root, { exclude }).then(() => { if (process.env.BENCH_WATCH === '1') index.watch(root, { exclude }) })
  const send = (message: unknown): void => { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...(message as object) })}\n`) }
  const pending = new Set<Promise<void>>()
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    let request: { id?: number | string; method?: string; params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string } }
    try { request = JSON.parse(line) } catch { return }
    const { id, method, params } = request
    if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'gearmod-index-bench', version: '1' } } })
    if (method === 'tools/list') return send({ id, result: { tools } })
    if (method === 'tools/call') {
      const tool = codeToolNames[params?.name ?? '']
      if (!tool || !tools.some((item) => item.name === params?.name)) return send({ id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } })
      const args = { ...(params?.arguments ?? {}) }
      if (tool === 'explore' && args.detalhe === undefined && process.env.BENCH_DETAIL === 'resumo') args.detalhe = 'resumo'
      pending.add(ready.then(() => runCodeTool(index.q(root), tool, args))
        .then((text) => send({ id, result: { content: [{ type: 'text', text }] } }), (error: unknown) => send({ id, result: { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true } })))
      return
    }
    if (id !== undefined && method && !method.startsWith('notifications/')) send({ id, error: { code: -32601, message: `Unsupported method: ${method}` } })
  })
  // stdin closed: answer what is still pending, let stdout drain, then leave
  lines.on('close', () => { void ready.then(() => Promise.allSettled([...pending])).finally(() => { index.close(); process.stdout.write('', () => process.exit(0)) }) })
}

async function indexOnly(): Promise<void> {
  const index = new CodeIndex(dbFile)
  const started = Date.now()
  const result = await index.index(root, { exclude })
  const status = index.status(root)
  const edges = index.db.prepare('select count(*) from edges where root = ?').pluck().get(root)
  console.log(JSON.stringify({ root, ms: Date.now() - started, result, files: status.files, symbols: status.symbols, edges }))
  index.close()
}

async function exportEdges(out: string): Promise<void> {
  const index = new CodeIndex(dbFile)
  await index.index(root, { exclude })
  const rows = index.db.prepare(`
    select e.kind, e.conf, e.lines, ts.path as src_path, s.qname as src_name, td.path as dst_path, d.qname as dst_name, d.line as dst_line
    from edges e
    join symbols s on s.id = e.src join trees ts on ts.root = e.root and ts.sha = s.sha
    join symbols d on d.id = e.dst join trees td on td.root = e.root and td.sha = d.sha
    where e.root = ? and e.kind in ('calls', 'instantiates')`).all(root) as Array<{ kind: string; conf: number; lines: string | null; src_path: string; src_name: string; dst_path: string; dst_name: string; dst_line: number }>
  const lines: string[] = []
  for (const row of rows) for (const line of (row.lines ?? '').split(',').filter(Boolean)) lines.push(JSON.stringify({ kind: row.kind, conf: row.conf, path: row.src_path, line: Number(line), caller: row.src_name, target: `${row.dst_path}:${row.dst_line}`, targetName: row.dst_name }))
  writeFileSync(out, `${lines.join('\n')}\n`)
  console.log(JSON.stringify({ edges: lines.length, out }))
  index.close()
}

const [command = 'serve', arg] = process.argv.slice(2)
const run = command === 'index' ? indexOnly() : command === 'edges' ? exportEdges(arg ?? 'edges.jsonl') : serve()
run.catch((error: unknown) => { console.error(error); process.exit(1) })
