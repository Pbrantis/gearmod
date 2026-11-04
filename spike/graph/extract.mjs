// Extraction of a file: symbols, imports, references, known types and inheritance. Runs inside the workers.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { LANGUAGES } from './langs.mjs'

export const EXTRACTOR_VERSION = 12

const require = createRequire(import.meta.url)
const TS = require('@vscode/tree-sitter-wasm')
const WASM = dirname(require.resolve('@vscode/tree-sitter-wasm'))

const JS_EXTRA = `
(export_statement !source (export_clause (export_specifier name: (identifier) @export.local)))
`

let initPromise
const compiled = new Map()
export const dropped = {} // patterns the grammar did not accept (to debug the queries)

async function language(lang) {
  if (compiled.has(lang)) return compiled.get(lang)
  initPromise ??= TS.Parser.init({ locateFile: (f) => join(WASM, f) })
  await initPromise
  const cfg = LANGUAGES[lang]
  const grammar = await TS.Language.load(readFileSync(join(WASM, `tree-sitter-${cfg.wasm}.wasm`)))
  const parser = new TS.Parser()
  parser.setLanguage(grammar)
  const lines = (cfg.queries + (cfg.family === 'js' ? JS_EXTRA : '')).split('\n').map((l) => l.trim()).filter(Boolean)
  const ok = []
  for (const l of lines) {
    try { new TS.Query(grammar, l).delete(); ok.push(l) } catch (e) { (dropped[lang] ??= []).push(l) }
  }
  const entry = { parser, query: new TS.Query(grammar, ok.join('\n')), cfg }
  compiled.set(lang, entry)
  return entry
}

const BIND_PRIORITY = ['var', 'field', 'call', 'expr', 'destrcall']
const HOLDERS = new Set(['variable_declarator', 'lexical_declaration', 'variable_declaration', 'export_statement', 'decorated_definition'])
const KIND_PRIORITY =['function', 'method', 'class', 'interface', 'struct', 'trait', 'enum', 'module', 'type', 'property', 'const']
const CLASSY = new Set(['class', 'interface', 'struct', 'trait', 'enum', 'module'])
const SCOPE_KINDS = new Set(['function', 'method', 'class', 'interface', 'struct', 'trait', 'enum', 'module'])

function findBody(node, depth = 0) {
  const b = node.childForFieldName?.('body')
  if (b) return b
  if (depth >= 3) return null
  for (const c of node.namedChildren) {
    if (c.type === 'comment') continue
    const r = findBody(c, depth + 1)
    if (r) return r
  }
  return null
}

const squash = (s, n) => s.replace(/\s+/g, ' ').trim().slice(0, n)

function docOf(holder, def, lang, src) {
  // comment right above (//, /** */, #) or Python docstring
  if (lang === 'python') {
    const body = def.childForFieldName('body')
    const first = body?.namedChildren[0]
    if (first?.type === 'expression_statement' && first.namedChildren[0]?.type === 'string') return squash(first.text.replace(/^[rubf]*("""|'''|"|')|("""|'''|"|')$/g, ''), 240)
  }
  const out = []
  let n = holder.previousNamedSibling
  let expectRow = holder.startPosition.row - 1
  while (n && n.type === 'comment' && n.endPosition.row >= expectRow - 0 && n.endPosition.row <= expectRow + 0) {
    out.unshift(n.text)
    expectRow = n.startPosition.row - 1
    n = n.previousNamedSibling
  }
  if (!out.length) return null
  // cleans each comment (///, //, /** */, #) and the C# XML documentation tags
  const clean = out.map((c) => c.replace(/\*\/\s*$/, '').replace(/^\s*(\/\*\*?|\/\/\/?|#|\*)\s?/gm, '')).join(' ')
  return squash(clean.replace(/<\/?(summary|remarks|returns|para|c|code|example|value)>/gi, ' ').replace(/<(see|seealso|paramref|typeparamref)\s+\w+="([^"]*)"\s*\/>/gi, '$2').replace(/<param name="(\w+)">/gi, '$1: ').replace(/<\/param>/gi, ';').replace(/<[^>]+>/g, ' '), 240) || null
}

function cleanReceiver(n) {
  if (!n) return null
  const t = n.text.replace(/\s+/g, '').replace(/\?\./g, '.').replace(/!\./g, '.').replace(/->/g, '.').replace(/::/g, '.')
  if (t.length > 80 || /[()[\]{}"'`]/.test(t)) return t.includes('(') ? '(expr)' : null
  return t
}

export async function extract(lang, src) {
  const { parser, query, cfg } = await language(lang)
  const tree = parser.parse(src)
  const root = tree.rootNode
  const matches = query.matches(root)

  const defsByNode = new Map() // startIndex:endIndex -> def
  const containers = []
  const pending = { imports: [], refs: [], binds: [], heritage: [], defaults: [], localExports: [] }
  const defNameStarts = new Set()

  for (const m of matches) {
    const caps = {}
    for (const c of m.captures) caps[c.name] ??= c.node
    const defKey = Object.keys(caps).find((k) => k.startsWith('def.'))
    if (defKey && caps.name) {
      const node = caps[defKey]
      const kind = defKey.slice(4)
      const key = node.startIndex + ':' + node.endIndex
      const prev = defsByNode.get(key)
      if (!prev || KIND_PRIORITY.indexOf(kind) < KIND_PRIORITY.indexOf(prev.kind)) defsByNode.set(key, { node, nameNode: caps.name, kind, owner: caps.owner?.text ?? null })
      defNameStarts.add(caps.name.startIndex)
      continue
    }
    if (caps.container) { containers.push({ node: caps.container, owner: caps.owner?.text }); continue }
    if (caps.import) { pending.imports.push(caps.import); continue }
    if (caps.call || caps.new || caps.jsx) {
      const node = caps.call ?? caps.new ?? caps.jsx
      if (!caps.callee) continue
      pending.refs.push({ pos: caps.callee.startIndex, node: caps.callee, name: caps.callee.text, receiver: cleanReceiver(caps.receiver), kind: caps.call ? 'call' : caps.new ? 'new' : 'render', line: node.startPosition.row + 1 })
      continue
    }
    if (caps.extends || caps.implements) {
      const n = caps.extends ?? caps.implements
      pending.heritage.push({ pos: n.startIndex, kind: caps.extends ? 'extends' : 'implements', target: n.text.replace(/<.*$/s, '').split(/[.:\\]+/).at(-1), ownerName: caps.owner?.text ?? null })
      continue
    }
    if (caps['bind.name']) { pending.binds.push({ pos: caps['bind.name'].startIndex, name: caps['bind.name'].text, type: caps['bind.type'].text, kind: 'var' }); continue }
    if (caps['field.name']) { pending.binds.push({ pos: caps['field.name'].startIndex, name: caps['field.name'].text, type: caps['field.type'].text, kind: 'field' }); continue }
    if (caps['bindcall.name']) { pending.binds.push({ pos: caps['bindcall.name'].startIndex, name: caps['bindcall.name'].text, type: caps['bindcall.callee'].text.replace(/\s+/g, ''), kind: 'call' }); continue }
    if (caps['bindexpr.name']) { const v = cleanReceiver(caps['bindexpr.value']); if (v && v !== '(expr)') pending.binds.push({ pos: caps['bindexpr.name'].startIndex, name: caps['bindexpr.name'].text, type: v, kind: 'expr' }); continue }
    if (caps['binddestr.name']) { const v = cleanReceiver(caps['binddestr.value']); if (v && v !== '(expr)') pending.binds.push({ pos: caps['binddestr.name'].startIndex, name: caps['binddestr.name'].text, type: v + '.' + caps['binddestr.name'].text, kind: 'expr' }); continue }
    if (caps['bdc.name']) { pending.binds.push({ pos: caps['bdc.name'].startIndex, name: caps['bdc.name'].text, type: caps['bdc.callee'].text.replace(/\s+/g, ''), kind: 'destrcall' }); continue }
    if (caps['export.default']) { pending.defaults.push(caps['export.default'].text); continue }
    if (caps['export.local']) { pending.localExports.push(caps['export.local'].text); continue }
    if (caps.type) { pending.refs.push({ pos: caps.type.startIndex, node: caps.type, name: caps.type.text, receiver: null, kind: 'type', line: caps.type.startPosition.row + 1 }); continue }
    if (caps.ref) { pending.refs.push({ pos: caps.ref.startIndex, node: caps.ref, name: caps.ref.text, receiver: null, kind: 'ref', line: caps.ref.startPosition.row + 1 }); continue }
  }

  // ---- symbols, sorted by position; index 0 is the file itself
  const lines = src.split('\n').length
  const symbols = [{ name: '', qname: '', kind: 'file', parent: -1, line: 1, end: lines, sb: 0, eb: src.length, signature: '', doc: null, exported: 1 }]
  // `namespace X;` (C#) is valid until the end of the file
  for (const d of defsByNode.values()) d.eb = d.node.type === 'file_scoped_namespace_declaration' ? src.length : d.node.endIndex
  const defs = [...defsByNode.values()].sort((a, b) => a.node.startIndex - b.node.startIndex || b.eb - a.eb)
  const stack = [] // [{sb, eb, idx}]
  const containerOf = (pos) => { let best = null; for (const c of containers) if (c.node.startIndex <= pos && pos < c.node.endIndex && (!best || c.node.startIndex >= best.node.startIndex)) best = c; return best }
  for (const d of defs) {
    const sb = d.node.startIndex
    while (stack.length && stack.at(-1).eb <= sb) stack.pop()
    const parentEntry = stack.at(-1)
    const parentIdx = parentEntry ? parentEntry.idx : 0
    const parent = symbols[parentIdx]
    let kind = d.kind
    // consts and properties only at the top of the file / class
    if (kind === 'const' && parent.kind !== 'file' && parent.kind !== 'module') continue
    if (kind === 'property' && !CLASSY.has(parent.kind)) continue
    if (kind === 'function' && CLASSY.has(parent.kind) && parent.kind !== 'module') kind = 'method'
    let owner = d.owner
    if (!owner && parent.kind === 'file') { const c = containerOf(sb); if (c) { owner = c.owner; if (kind === 'function') kind = 'method' } }
    const name = d.nameNode.text
    const qname = owner ? `${owner}.${name}` : parent.kind === 'file' ? name : `${parent.qname}.${name}`
    let holder = d.node
    while (holder.parent && HOLDERS.has(holder.parent.type) && !(holder.type === 'variable_declarator' && holder.parent.namedChildren.filter((c) => c.type === 'variable_declarator').length > 1 && holder.parent.namedChildren.find((c) => c.type === 'variable_declarator').startIndex !== holder.startIndex)) holder = holder.parent
    const body = findBody(d.node)
    const sigEnd = body && body.startIndex > sb ? body.startIndex : Math.min(d.node.endIndex, sb + 240)
    let exported
    if (cfg.family === 'js') { let h = d.node; while (h.parent && HOLDERS.has(h.parent.type)) h = h.parent; exported = h.type === 'export_statement' ? 1 : 0 }
    else if (cfg.exported) exported = cfg.exported(name) ? 1 : 0
    else if (cfg.family === 'rust') exported = d.node.namedChildren.some((c) => c.type === 'visibility_modifier') ? 1 : 0
    else exported = /\bprivate\b/.test(src.slice(sb, sigEnd)) ? 0 : 1
    const idx = symbols.length
    const endLine = d.eb === src.length ? lines : d.node.endPosition.row + 1
    symbols.push({ name, qname, kind, parent: parentIdx, line: d.node.startPosition.row + 1, end: endLine, sb, eb: d.eb, signature: squash(src.slice(sb, sigEnd), 240), doc: docOf(holder, d.node, lang, src), exported, owner })
    if (SCOPE_KINDS.has(kind) || kind === 'const') stack.push({ sb, eb: d.eb, idx })
  }
  for (const n of [...pending.defaults, ...pending.localExports]) for (const s of symbols) if (s.name === n && s.parent === 0) s.exported = 1

  // ---- symbol that encloses a position (stack scan)
  const scopes = symbols.map((s, idx) => ({ ...s, idx })).filter((s) => s.idx > 0).sort((a, b) => a.sb - b.sb || b.eb - a.eb)
  const enclosingAll = (items) => {
    const sorted = items.map((it, i) => [it.pos, i]).sort((a, b) => a[0] - b[0])
    const out = new Array(items.length)
    const st = []
    let k = 0
    for (const [pos, i] of sorted) {
      while (k < scopes.length && scopes[k].sb <= pos) { while (st.length && st.at(-1).eb <= scopes[k].sb) st.pop(); st.push(scopes[k]); k++ }
      while (st.length && st.at(-1).eb <= pos) st.pop()
      out[i] = st.length ? st.at(-1).idx : 0
    }
    return out
  }
  const classOf = (idx) => { for (let i = idx; i > 0; i = symbols[i].parent) if (CLASSY.has(symbols[i].kind)) return i; return 0 }

  const seenRef = new Set()
  const refsRaw = pending.refs.filter((r) => {
    if (r.kind === 'type' && defNameStarts.has(r.pos)) return false
    const k = r.pos + r.kind
    if (seenRef.has(k)) return false
    seenRef.add(k)
    // type reference that is already a call/instantiation at the same point
    return !(r.kind === 'type' && (seenRef.has(r.pos + 'new') || seenRef.has(r.pos + 'call')))
  })
  const refEnc = enclosingAll(refsRaw)
  const refs = refsRaw.map((r, i) => ({ src: refEnc[i], name: r.name, receiver: r.receiver, kind: r.kind, line: r.line }))

  // the variable belongs to the scope where it is declared, not to the const symbol it defines itself
  const bindEnc = enclosingAll(pending.binds).map((idx) => (symbols[idx]?.kind === 'const' ? symbols[idx].parent : idx))
  const binds = pending.binds.map((b, i) => ({ scope: b.kind === 'field' ? classOf(bindEnc[i]) || bindEnc[i] : bindEnc[i], name: b.name, type: b.type.replace(/\s+/g, ' ').slice(0, 2000), kind: b.kind }))
    .sort((a, b) => BIND_PRIORITY.indexOf(a.kind) - BIND_PRIORITY.indexOf(b.kind))
  const seenBind = new Set()
  const bindsUnique = binds.filter((b) => { const k = b.scope + '\0' + b.name; if (seenBind.has(k)) return false; seenBind.add(k); return true })

  const herEnc = enclosingAll(pending.heritage)
  const heritage = pending.heritage.map((h, i) => ({ owner: h.ownerName ? -1 : classOf(herEnc[i]), ownerName: h.ownerName, kind: h.kind, target: h.target }))
    .filter((h) => h.owner !== 0 || h.ownerName)

  const imports = []
  for (const node of pending.imports) {
    try { for (const i of cfg.imports(node)) if (i.spec) imports.push({ ...i, line: node.startPosition.row + 1 }) } catch { /* malformed import */ }
  }

  tree.delete()
  return {
    lines,
    symbols: symbols.map(({ sb, eb, ...s }) => s),
    imports, refs, binds: bindsUnique, heritage,
    defaultExport: pending.defaults[0] ?? null
  }
}
