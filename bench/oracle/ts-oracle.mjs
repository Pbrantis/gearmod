// Precision and recall of the index's call edges against the TypeScript compiler (the oracle), for TS/TSX projects.
//   node bench/oracle/ts-oracle.mjs <repo id> [--tsconfig path/in/repo/tsconfig.json] [--ablate types]
// For every call and `new` in the project, the compiler says which declaration it reaches; the index exports its own
// edges (path:line → file#name). An index edge is right when the compiler has the same pair. Calls into libraries
// (node_modules, .d.ts) are left out on both sides.
// Output: bench/results/_oracle/<repo>[.<ablation>].json (summary) and .misses.csv (samples of both kinds of error).
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { BENCH, DESKTOP, ELECTRON, RESULTS, SERVER, WORK, args, readJson, run, shuffle } from '../lib/util.mjs'

const opt = args()
const repoId = opt._[0]
if (!repoId) { console.error('usage: node bench/oracle/ts-oracle.mjs <repo id> [--tsconfig file] [--ablate types]'); process.exit(1) }
const root = resolve(WORK, 'repos', repoId)
const ts = createRequire(join(DESKTOP, 'package.json'))('typescript')
const posix = (path) => path.split('\\').join('/')
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage'])

// ---------- the compiler's edges ----------
function program() {
  // --tsconfig, or the repository's "tsconfig" in config/repos.json, or every tsconfig*.json found
  const fromRepo = readJson(join(BENCH, 'config', 'repos.json')).repos.find((repo) => repo.id === repoId)?.tsconfig
  const chosen = opt.tsconfig ?? fromRepo
  const configs = chosen ? [resolve(root, chosen)] : findConfigs(root)
  const files = new Set()
  let options = { allowJs: false, jsx: ts.JsxEmit.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, skipLibCheck: true, noEmit: true }
  for (const file of configs) {
    const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
    if (!parsed) continue
    for (const name of parsed.fileNames) files.add(name)
    options = { ...options, ...parsed.options, noEmit: true }
  }
  if (!files.size) walk(root, (path) => { if (/\.(ts|tsx)$/.test(path) && !path.endsWith('.d.ts')) files.add(path) })
  console.log(`compiler: ${configs.length} tsconfig, ${files.size} files`)
  return ts.createProgram([...files], options)
}

function findConfigs(dir) {
  const out = []
  walk(dir, (path) => { if (/(^|[\\/])tsconfig(\.[\w-]+)?\.json$/.test(path) && !/\.(build|eslint|node)\.json$/.test(path)) out.push(path) })
  return out
}
function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, visit)
    else visit(path)
  }
}

/**
 * Declarations the index models as symbols: functions, methods, classes, constructors, module-level constants and class
 * properties. Calls that reach anything else (a local variable such as a React setter, a parameter, a destructured
 * binding, an object-literal property) cannot be judged and are left out on both sides.
 */
function comparable(decl) {
  if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl) || ts.isClassDeclaration(decl) || ts.isConstructorDeclaration(decl) || ts.isPropertyDeclaration(decl) || ts.isMethodSignature(decl)) return true
  if (ts.isVariableDeclaration(decl)) {
    let node = decl.parent
    while (node && !ts.isSourceFile(node)) { if (ts.isFunctionLike(node) || ts.isBlock(node)) return false; node = node.parent }
    return true
  }
  return false
}

/**
 * The compiler's view of every call site, keyed by path:line#name (the index has no column):
 * project = the declarations in the project it reaches; library = it reaches only code outside the project.
 */
function oracleSites(prog) {
  const checker = prog.getTypeChecker()
  const project = new Map()
  const library = new Set()
  const inside = (file) => !file.isDeclarationFile && !posix(file.fileName).includes('/node_modules/') && posix(file.fileName).startsWith(posix(root))
  for (const source of prog.getSourceFiles()) {
    if (!inside(source)) continue
    const from = posix(relative(root, source.fileName))
    const visit = (node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = node.expression
        const nameNode = ts.isPropertyAccessExpression(callee) ? callee.name : ts.isIdentifier(callee) ? callee : null
        if (nameNode) {
          let symbol = checker.getSymbolAtLocation(nameNode)
          if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
          const decls = symbol?.declarations ?? []
          const line = source.getLineAndCharacterOfPosition(nameNode.getStart(source)).line + 1
          const site = `${from}:${line}#${nameNode.text}`
          const own = decls.filter((decl) => inside(decl.getSourceFile()))
          if (decls.length && !own.length) library.add(site)
          for (const decl of own.filter(comparable)) {
            const set = project.get(site) ?? new Set()
            set.add(posix(relative(root, decl.getSourceFile().fileName)))
            project.set(site, set)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { project, library }
}

// ---------- the index's edges ----------
async function indexEdges(tsFiles) {
  const tag = opt.ablate ? String(opt.ablate) : 'full'
  const out = join(RESULTS, '_oracle', `${repoId}.${tag}.edges.jsonl`)
  mkdirSync(dirname(out), { recursive: true })
  const res = await run(ELECTRON, [SERVER, 'edges', out], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', BENCH_ROOT: root, BENCH_DB: join(WORK, 'index', `${repoId}.${tag}.sqlite`), GEARMOD_INDEX_ABLATE: opt.ablate ? String(opt.ablate) : '' } })
  if (res.code !== 0) throw new Error(res.stderr)
  const edges = new Map()
  for (const line of readFileSync(out, 'utf8').split('\n').filter(Boolean)) {
    const edge = JSON.parse(line)
    const targetPath = edge.target.slice(0, edge.target.lastIndexOf(':'))
    // compare only where the compiler can judge: TS source on both ends
    if (!tsFiles.has(edge.path) || !tsFiles.has(targetPath)) continue
    edges.set(`${edge.path}:${edge.line}#${edge.targetName.split('.').at(-1)}->${targetPath}`, edge.conf)
  }
  return edges
}

// ---------- compare ----------
if (!existsSync(root)) { console.error(`run node bench/prepare.mjs ${repoId} first`); process.exit(1) }
if (!existsSync(SERVER)) { console.error('run node bench/build.mjs first'); process.exit(1) }
const prog = program()
const tsFiles = new Set(prog.getSourceFiles().filter((file) => !file.isDeclarationFile && posix(file.fileName).startsWith(posix(root))).map((file) => posix(relative(root, file.fileName))))
const { project, library } = oracleSites(prog)
const truth = new Set([...project].flatMap(([site, targets]) => [...targets].map((target) => `${site}->${target}`)))
const found = await indexEdges(tsFiles)
// an index edge is judged when the compiler resolved that call site: right if the compiler reaches the same file,
// wrong if the compiler reaches another file or only library code; sites that reach locals are not judged
const judged = [...found].filter(([key]) => { const site = key.slice(0, key.lastIndexOf('->')); return project.has(site) || library.has(site) })
const right = judged.filter(([key]) => truth.has(key))
const byConf = {}
for (const [key, conf] of judged) { const bucket = conf >= 1 ? '1.0' : conf >= 0.8 ? '0.8-0.9' : '<0.8'; const b = (byConf[bucket] ??= { edges: 0, right: 0 }); b.edges++; if (truth.has(key)) b.right++ }
const summary = {
  repo: repoId, ablate: opt.ablate ?? null, at: new Date().toISOString(), files: tsFiles.size,
  compilerEdges: truth.size, compilerLibrarySites: library.size, indexEdges: found.size, indexEdgesJudged: judged.length, right: right.length,
  precision: judged.length ? right.length / judged.length : null,
  recall: truth.size ? [...truth].filter((key) => found.has(key)).length / truth.size : null,
  precisionByConfidence: Object.fromEntries(Object.entries(byConf).map(([bucket, b]) => [bucket, { edges: b.edges, precision: b.right / b.edges }]))
}
const base = join(RESULTS, '_oracle', `${repoId}${opt.ablate ? `.${opt.ablate}` : ''}`)
writeFileSync(`${base}.json`, `${JSON.stringify(summary, null, 2)}\n`)
const falsePositives = shuffle(judged.map(([key]) => key).filter((key) => !truth.has(key)), 1).slice(0, 100)
const falseNegatives = shuffle([...truth].filter((key) => !found.has(key)), 1).slice(0, 100)
writeFileSync(`${base}.misses.csv`, ['kind,edge,manual_verdict', ...falsePositives.map((edge) => `index_only,${edge},`), ...falseNegatives.map((edge) => `compiler_only,${edge},`)].join('\n') + '\n')
console.log(JSON.stringify(summary, null, 2))
console.log(`samples of disagreements for a manual look: ${base}.misses.csv`)
