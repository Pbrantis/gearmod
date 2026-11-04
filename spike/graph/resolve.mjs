// Links references to definitions (edges) for a folder. Depends on the whole tree (imports, types), so it
// is per root, unlike extraction. Can redo only the files affected by a change.
import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { LANGUAGES } from './langs.mjs'

// bump when the linking rule changes: forces relinking the folders even with no changed file
export const LINKER_VERSION = 6

const CLASSY = new Set(['class', 'interface', 'struct', 'trait', 'enum', 'type', 'module'])
const SELF = new Set(['this', 'self', 'cls', 'Self', '$this'])
const EDGE_KIND = { call: 'calls', new: 'instantiates', render: 'renders', type: 'references', ref: 'references' }
// names too generic to link by name alone when the receiver type is unknown
const STOP = new Set('get set has add delete push pop shift unshift map filter forEach reduce find findIndex some every join split slice splice replace replaceAll trim then catch finally toString valueOf keys values entries includes indexOf lastIndexOf run all exec prepare close open on off once emit send write read start stop parse stringify log error warn info debug test match assign from of call apply bind resolve reject next length size clear sort concat flat flatMap at fill startsWith endsWith padStart padEnd toLowerCase toUpperCase dispose update create list remove invoke handle listen format load save init render setState append insert pipe subscribe unsubscribe dispatch query execute fetch post put patch request response json text status sync reset destroy kill spawn exit wait sleep print println printf len cap make new append copy close String Error'.split(' '))

// languages with declared types: can be trusted when the type chain fails
const TYPED = new Set(['csharp', 'java', 'go', 'rust'])
// collection and standard library methods of C#/Java/Unity, too common to link by name
for (const n of 'Add AddRange Remove RemoveAt RemoveAll Contains ContainsKey TryGetValue Find FindAll FindIndex Exists Where Select SelectMany Any All First FirstOrDefault Last LastOrDefault Single ToList ToArray ToDictionary Count Sum Min Max Average OrderBy OrderByDescending ThenBy GroupBy Distinct Skip Take Reverse Insert IndexOf Sort Clear Equals GetHashCode ToString Dispose Invoke GetComponent GetComponents GetComponentInChildren AddComponent Destroy Instantiate SetActive Log LogWarning LogError Format Substring Trim Split Replace StartsWith EndsWith Parse TryParse Lerp Clamp Abs Range Play Pause Stop Start Update Awake Enable Disable Show Hide Move Rotate Translate Load Save Init Initialize Reset Close Open Read Write Send Get Set Put Peek Push Pop Enqueue Dequeue CopyTo forEach stream collect equals hashCode toString size isEmpty contains'.split(' ')) STOP.add(n)

// environment globals: calls on them are never the project's
const GLOBALS = new Set('window document console Math JSON process navigator localStorage sessionStorage Object Array Promise Date Number String Boolean Symbol Reflect Proxy globalThis require module exports Buffer URL URLSearchParams Intl RegExp Error Map Set WeakMap WeakSet crypto performance fetch setTimeout setInterval clearTimeout clearInterval queueMicrotask structuredClone describe it test expect beforeEach afterEach beforeAll afterAll vi jest os sys print len str int dict list fmt'.split(' '))

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

function splitTopLevel(s, sep = ',') {
  const out = []
  let depth = 0, cur = '', prev = ''
  for (const ch of s) {
    if ('<[({'.includes(ch)) depth++
    else if ('>])}'.includes(ch) && !(ch === '>' && prev === '=')) depth--
    prev = ch
    if (ch === sep && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}

export function normType(t) {
  if (!t) return null
  t = t.trim()
  for (let i = 0; i < 6; i++) {
    const before = t
    t = t.replace(/^(readonly|const|mut|dyn|impl|ref|out|in|params|final|static|struct|class|typeof)\s+/, '').replace(/^[&*?]+\s*/, '').replace(/^\[\]\s*/, '').replace(/(\[\]|\?)+$/, '').trim()
    const union = splitTopLevel(t, '|').filter((x) => !/^(null|undefined|void|None|nil)$/.test(x))
    if (union.length) t = union[0]
    const m = t.match(/^(Promise|PromiseLike|Array|ReadonlyArray|Readonly|Partial|Required|Pick|Omit|NonNullable|Awaited|Ref|MutableRefObject|Option|Optional|List|IList|IEnumerable|ICollection|Set|HashSet|Vec|Box|Rc|Arc|RefCell|Cell|Mutex|RwLock|Task|ValueTask|Observable|Lazy|Result)\s*[<[]\s*(.*)\s*[>\]]$/s)
    if (m) t = splitTopLevel(m[2])[0] ?? ''
    if (t === before) break
  }
  const base = t.replace(/[<[].*$/s, '').trim()
  return /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(base) ? base : null
}

// `{ a: Foo; b?: Bar<X>, readonly c: Baz }` -> Map(a -> 'Foo', b -> 'Bar<X>', c -> 'Baz')
function objectMembers(t) {
  const inner = t.trim().replace(/^\{/, '').replace(/\}$/, '')
  const out = new Map()
  for (const part of splitTopLevel(inner.replace(/;/g, ','))) {
    const m = part.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*([\s\S]+)$/)
    if (m) out.set(m[1], m[2].trim())
  }
  return out
}

function returnType(fn, family) {
  const sig = fn.signature ?? ''
  let r = null
  if (family === 'js') { const i = sig.lastIndexOf('):'); if (i >= 0) r = sig.slice(i + 2).replace(/=>.*$/s, '').replace(/\{\s*$/, '') }
  else if (family === 'python' || family === 'rust') r = sig.match(/->\s*(.+?)\s*(:|where\b|\{|$)/)?.[1]
  else if (family === 'go') { const rest = sig.replace(/^func\s*(\([^)]*\))?\s*[\w]+\s*(\[[^\]]*\])?\s*/, ''); let d = 0, i = 0; for (; i < rest.length; i++) { if (rest[i] === '(') d++; else if (rest[i] === ')') { d--; if (d === 0) break } } r = rest.slice(i + 1).replace(/^\s*\(/, '').split(',')[0] }
  else r = sig.match(new RegExp(`([\\w.<>\\[\\]?]+)\\s+${fn.name.replace(/\W/g, '')}\\s*[(<]`))?.[1]
  return normType(r ?? '')
}

// ---- module resolution ------------------------------------------------------------------------------------------

function moduleResolver(root, paths, manifests) {
  const byBase = new Map()
  for (const p of paths) { const b = p.slice(p.lastIndexOf('/') + 1); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(p) }
  const readJson = (p) => { try { return JSON.parse(readFileSync(join(root, p), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1')) } catch { return null } }
  const pkgs = []
  const aliases = []
  const goMods = []
  const cargo = []
  for (const m of manifests) {
    const base = m.slice(m.lastIndexOf('/') + 1)
    const dir = dirOf(m)
    if (base === 'package.json') {
      const j = readJson(m)
      if (j?.name) {
        const exp = typeof j.exports === 'string' ? j.exports : j.exports?.['.']?.import ?? j.exports?.['.']?.default ?? j.exports?.['.']?.types ?? (typeof j.exports?.['.'] === 'string' ? j.exports['.'] : null)
        pkgs.push({ name: j.name, dir, entries: [j.types, j.source, exp, j.module, j.main, 'src/index', 'index'].filter((x) => typeof x === 'string') })
      }
    } else if (/^[jt]sconfig.*\.json$/.test(base)) {
      const j = readJson(m)
      const o = j?.compilerOptions
      if (o?.paths) {
        const baseUrl = posix.normalize(posix.join(dir, o.baseUrl ?? '.'))
        for (const [k, v] of Object.entries(o.paths)) aliases.push({ dir, prefix: k.replace(/\*$/, ''), wild: k.endsWith('*'), targets: v.map((t) => posix.join(baseUrl, t.replace(/\*$/, ''))) })
      } else if (o?.baseUrl) aliases.push({ dir, prefix: '', wild: true, targets: [posix.normalize(posix.join(dir, o.baseUrl))], baseUrlOnly: true })
    } else if (base === 'go.mod') {
      try { const mod = readFileSync(join(root, m), 'utf8').match(/^module\s+(\S+)/m)?.[1]; if (mod) goMods.push({ dir, mod }) } catch { /* no readable go.mod */ }
    } else if (base === 'Cargo.toml') cargo.push(dir)
  }
  pkgs.sort((a, b) => b.name.length - a.name.length)
  aliases.sort((a, b) => b.prefix.length - a.prefix.length)

  const has = (p) => paths.has(p)
  const JS_EXT = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs', '/index.jsx']
  const tryJs = (base) => {
    base = posix.normalize(base).replace(/^\.\//, '')
    for (const e of JS_EXT) if (has(base + e)) return [base + e]
    const noJs = base.replace(/\.(m|c)?jsx?$/, '')
    if (noJs !== base) for (const e of JS_EXT) if (has(noJs + e)) return [noJs + e]
    return []
  }
  const suffix = (rel, exts) => {
    const out = []
    for (const e of exts) {
      const full = rel + e
      const b = full.slice(full.lastIndexOf('/') + 1)
      for (const p of byBase.get(b) ?? []) if (p === full || p.endsWith('/' + full)) out.push(p)
    }
    return out.sort((a, b) => a.length - b.length)
  }
  const dirFiles = (dir, ext, noTests) => [...paths].filter((p) => dirOf(p) === dir && p.endsWith(ext) && !(noTests && /_test\.go$/.test(p)))

  const cache = new Map()
  return (family, from, spec) => {
    const key = family + '\0' + dirOf(from) + '\0' + spec
    if (cache.has(key)) return cache.get(key)
    let out = []
    if (family === 'js') {
      if (spec.startsWith('.')) out = tryJs(posix.join(dirOf(from), spec))
      else {
        const pkg = pkgs.find((p) => spec === p.name || spec.startsWith(p.name + '/'))
        if (pkg) {
          const rest = spec.slice(pkg.name.length + 1)
          if (rest) out = tryJs(posix.join(pkg.dir, rest)).length ? tryJs(posix.join(pkg.dir, rest)) : tryJs(posix.join(pkg.dir, 'src', rest))
          else for (const e of pkg.entries) { out = tryJs(posix.join(pkg.dir, e)); if (out.length) break }
        }
        if (!out.length) for (const a of aliases) {
          if (!(from.startsWith(a.dir ? a.dir + '/' : '') || !a.dir)) continue
          if (a.wild ? spec.startsWith(a.prefix) : spec === a.prefix) {
            for (const t of a.targets) { out = tryJs(a.wild ? t + spec.slice(a.prefix.length) : t); if (out.length) break }
            if (out.length) break
          }
        }
      }
    } else if (family === 'python') {
      const dots = spec.match(/^\.*/)[0].length
      const rest = spec.slice(dots).replace(/\./g, '/')
      if (dots) {
        let dir = dirOf(from)
        for (let i = 1; i < dots; i++) dir = dirOf(dir)
        const base = posix.join(dir, rest)
        out = [base + '.py', base + '/__init__.py', base + '.pyi'].filter(has)
        if (!rest) out = [posix.join(dir, '__init__.py')].filter(has)
      } else out = suffix(rest, ['.py', '/__init__.py', '.pyi']).slice(0, 1)
    } else if (family === 'go') {
      const m = goMods.find((g) => spec === g.mod || spec.startsWith(g.mod + '/'))
      if (m) out = dirFiles(posix.join(m.dir, spec.slice(m.mod.length + 1)), '.go', true)
    } else if (family === 'java') {
      const rel = spec.replace(/\./g, '/')
      out = suffix(rel, ['.java'])
      if (!out.length) { const pkgDir = rel; out = [...paths].filter((p) => p.endsWith('.java') && (dirOf(p) === pkgDir || dirOf(p).endsWith('/' + pkgDir))) }
      if (!out.length && rel.includes('/')) out = suffix(dirOf(rel), ['.java'])
    } else if (family === 'rust') {
      const segs = spec.split('::')
      const crateRoot = cargo.filter((c) => from.startsWith(c ? c + '/' : '')).sort((a, b) => b.length - a.length)[0]
      let dir = segs[0] === 'crate' ? posix.join(crateRoot ?? '', 'src') : segs[0] === 'super' ? dirOf(dirOf(from)) : segs[0] === 'self' ? dirOf(from) : null
      if (dir !== null) {
        let last = []
        for (const s of segs.slice(1)) {
          const f = [posix.join(dir, s + '.rs'), posix.join(dir, s, 'mod.rs')].filter(has)
          if (!f.length) break
          last = f
          dir = posix.join(dir, s)
        }
        out = last.length ? last : [posix.join(dir, 'lib.rs'), posix.join(dir, 'main.rs'), posix.join(dir, 'mod.rs')].filter(has)
      }
    } else if (family === 'php') {
      const segs = spec.split('\\')
      for (let i = 0; i < segs.length && !out.length; i++) out = suffix(segs.slice(i).join('/'), ['.php']).slice(0, 1)
    } else if (family === 'ruby') {
      out = spec.startsWith('./') ? [posix.join(dirOf(from), spec.slice(2)) + '.rb'].filter(has) : suffix(spec, ['.rb']).slice(0, 1)
    } else if (family === 'c') {
      out = spec.startsWith('./') ? [posix.normalize(posix.join(dirOf(from), spec.slice(2)))].filter(has) : []
      if (!out.length) out = suffix(spec.replace(/^\.\//, ''), ['']).slice(0, 1)
    }
    cache.set(key, out)
    return out
  }
}

// ---- folder context ---------------------------------------------------------------------------------------------

export function loadContext(db, root) {
  const trees = db.prepare('select path, sha, lang from trees where root = ?').all(root)
  const paths = new Set(trees.map((t) => t.path))
  const shaOf = new Map(trees.map((t) => [t.path, t.sha]))
  const pathOf = new Map()
  for (const t of trees) if (!pathOf.has(t.sha)) pathOf.set(t.sha, t.path)
  const familyOf = (lang) => LANGUAGES[lang]?.family ?? lang
  const langOfSha = new Map(trees.map((t) => [t.sha, t.lang]))
  const group = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.sha)) m.set(r.sha, []); m.get(r.sha).push(r) } return m }
  const inRoot = `sha in (select sha from trees where root = ?)`
  const symRows = db.prepare(`select id, sha, idx, name, qname, kind, parent, line, end_line, signature, exported, owner from symbols where ${inRoot} order by sha, idx`).all(root)
  const syms = new Map()
  const byName = new Map()
  const members = new Map() // owner name -> name -> [sym]
  for (const s of symRows) {
    s.path = pathOf.get(s.sha)
    s.family = familyOf(langOfSha.get(s.sha))
    if (!syms.has(s.sha)) syms.set(s.sha, [])
    syms.get(s.sha)[s.idx] = s
  }
  for (const s of symRows) {
    if (s.kind === 'file') continue
    if (!byName.has(s.name)) byName.set(s.name, [])
    byName.get(s.name).push(s)
    const parent = syms.get(s.sha)[s.parent]
    const owner = s.owner ?? (parent && (CLASSY.has(parent.kind) || parent.kind === 'const') ? parent.name : null)
    if (owner) {
      if (!members.has(owner)) members.set(owner, new Map())
      const mm = members.get(owner)
      if (!mm.has(s.name)) mm.set(s.name, [])
      mm.get(s.name).push(s)
    }
  }
  // C#: namespace -> name -> symbols (`using` points to namespaces, not to files)
  const nsMembers = new Map()
  for (const s of symRows) {
    if (s.family !== 'csharp' || s.kind === 'file') continue
    const parent = syms.get(s.sha)[s.parent]
    if (!parent || parent.kind !== 'module') continue
    if (!nsMembers.has(parent.qname)) nsMembers.set(parent.qname, new Map())
    const m = nsMembers.get(parent.qname)
    if (!m.has(s.name)) m.set(s.name, [])
    m.get(s.name).push(s)
  }
  const roots = db.prepare('select manifests from roots where root = ?').get(root)
  const manifests = roots?.manifests ? JSON.parse(roots.manifests) : []
  return {
    root, trees, paths, shaOf, pathOf, syms, byName, members, familyOf, langOfSha, nsMembers,
    imports: group(db.prepare(`select * from imports where ${inRoot}`).all(root)),
    binds: group(db.prepare(`select * from binds where ${inRoot}`).all(root)),
    heritage: group(db.prepare(`select * from heritage where ${inRoot}`).all(root)),
    defaults: new Map(db.prepare(`select sha, default_export from blobs where ${inRoot} and default_export is not null`).all(root).map((r) => [r.sha, r.default_export])),
    resolveModule: moduleResolver(root, paths, manifests)
  }
}

// ---- linking -------------------------------------------------------------------------------------------------------

export function linker(ctx) {
  const fileCtxCache = new Map()
  const fileCtx = (path) => {
    if (fileCtxCache.has(path)) return fileCtxCache.get(path)
    const sha = ctx.shaOf.get(path)
    const family = ctx.familyOf(ctx.langOfSha.get(sha))
    const scope = new Map()
    const wild = []
    const targetsAll = []
    for (const imp of ctx.imports.get(sha) ?? []) {
      const targets = ctx.resolveModule(family, path, imp.spec)
      if (!targets.length) continue
      targetsAll.push(...targets)
      if (imp.local === '*') { wild.push(...targets); continue }
      if (!imp.local) continue
      // Python: `from package import module` brings the module, not a symbol
      if (family === 'python' && imp.imported && imp.imported !== '*' && imp.imported !== 'pkg') {
        const sub = ctx.resolveModule(family, path, imp.spec.endsWith('.') ? imp.spec + imp.imported : imp.spec + '.' + imp.imported)
        if (sub.length) { scope.set(imp.local, { paths: sub, imported: '*' }); targetsAll.push(...sub); continue }
      }
      scope.set(imp.local, { paths: targets, imported: imp.imported })
    }
    // imported names, including from external packages: never fall to the "project's unique name"
    const bound = new Set((ctx.imports.get(sha) ?? []).map((i) => i.local).filter(Boolean))
    const fsyms = ctx.syms.get(sha) ?? []
    // C#: visible namespaces = those of the file (and the outer ones, A.B -> A) + the `using`s
    const namespaces = []
    if (family === 'csharp') {
      for (const s of fsyms) if (s?.kind === 'module') { const parts = s.qname.split('.'); for (let i = parts.length; i > 0; i--) namespaces.push(parts.slice(0, i).join('.')) }
      for (const imp of ctx.imports.get(sha) ?? []) namespaces.push(imp.spec.replace(/^static\s+|^global::/g, ''))
      namespaces.push('')
    }
    const fc = { path, sha, family, scope, wild, bound, namespaces: [...new Set(namespaces)], targets: [...new Set(targetsAll)], syms: fsyms }
    fileCtxCache.set(path, fc)
    return fc
  }

  // exported symbol `name` of a set of files, following re-exports
  const exportCache = new Map()
  function resolveExport(paths, name, depth = 0) {
    if (!paths?.length || depth > 6) return []
    const key = paths.join('|') + '\0' + name
    if (exportCache.has(key)) return exportCache.get(key)
    exportCache.set(key, [])
    let out = []
    for (const p of paths) {
      const fc = fileCtx(p)
      const want = name === 'default' ? ctx.defaults.get(fc.sha) : name
      if (want) {
        const hit = fc.syms.filter((s) => s && s.idx > 0 && s.name === want && (s.parent === 0 || fc.syms[s.parent]?.kind === 'module') && s.kind !== 'method')
        if (hit.length) { out.push(...hit); continue }
      }
      for (const imp of ctx.imports.get(fc.sha) ?? []) {
        if (imp.local === name || (name === 'default' && imp.local === want)) {
          const t = ctx.resolveModule(fc.family, p, imp.spec)
          if (imp.imported === '*') { /* namespace reexport — handled by the caller */ } else out.push(...resolveExport(t, imp.imported, depth + 1))
        } else if (imp.local === '*' && imp.reexport) out.push(...resolveExport(ctx.resolveModule(fc.family, p, imp.spec), name, depth + 1))
      }
    }
    out = [...new Set(out)]
    exportCache.set(key, out)
    return out
  }

  // C#: looks for the name in the file's visible namespaces, from the most specific to the most general
  function nsLookup(fc, name) {
    if (!fc.namespaces?.length) return []
    for (const ns of fc.namespaces) { const hit = ctx.nsMembers.get(ns)?.get(name); if (hit?.length) return hit }
    return []
  }

  // exported namespace (export * as ns / import * as ns)
  function exportNamespace(paths, name) {
    for (const p of paths) {
      const fc = fileCtx(p)
      for (const imp of ctx.imports.get(fc.sha) ?? []) if (imp.local === name && imp.imported === '*') return ctx.resolveModule(fc.family, p, imp.spec)
    }
    return null
  }

  const chainOf = (fc, idx) => { const out = []; for (let i = idx; i >= 0 && fc.syms[i]; i = fc.syms[i].parent) { out.push(fc.syms[i]); if (i === 0) break } return out }
  const classOf = (fc, idx) => chainOf(fc, idx).find((s) => CLASSY.has(s.kind) && s.kind !== 'module') ?? null

  // type (class/interface/struct symbol) by name, in the context of a file
  function resolveTypeName(fc, name, depth = 0) {
    if (!name || depth > 4) return null
    if (name.includes('.')) {
      const [head, ...rest] = name.split('.')
      let t = headType(fc, head, null, depth + 1)
      for (const part of rest) { if (!t) break; t = stepType(t, part, depth + 1) }
      return t?.type ?? null
    }
    const local = fc.syms.find((s) => s && s.name === name && CLASSY.has(s.kind))
    if (local) return local
    const b = fc.scope.get(name)
    if (b) { const hit = resolveExport(b.paths, b.imported === '*' ? name : b.imported).find((s) => CLASSY.has(s.kind)); if (hit) return hit }
    const ns = nsLookup(fc, name).find((s) => CLASSY.has(s.kind))
    if (ns) return ns
    const w = resolveExport(fc.wild, name).find((s) => CLASSY.has(s.kind))
    if (w) return w
    const all = (ctx.byName.get(name) ?? []).filter((s) => CLASSY.has(s.kind) && s.family === fc.family)
    const sameDir = all.filter((s) => dirOf(s.path) === dirOf(fc.path))
    if (sameDir.length === 1) return sameDir[0]
    if (all.length === 1) return all[0]
    return null
  }

  const parentCache = new Map()
  function parentsOf(T) {
    if (parentCache.has(T.id)) return parentCache.get(T.id)
    parentCache.set(T.id, [])
    const out = []
    const fc = fileCtx(T.path)
    for (const h of ctx.heritage.get(T.sha) ?? []) if (h.owner === T.idx || h.owner_name === T.name) { const p = resolveTypeName(fc, h.target); if (p && p.id !== T.id) out.push(p) }
    // impl Trait for T / methods with owners in other files (Go, Rust)
    for (const [sha, list] of ctx.heritage) if (sha !== T.sha) for (const h of list) if (h.owner_name === T.name) { const p = resolveTypeName(fileCtx(ctx.pathOf.get(sha)), h.target); if (p && p.id !== T.id) out.push(p) }
    parentCache.set(T.id, out)
    return out
  }

  // the same class declared in several files (C# partial, Ruby reopened class)
  const partsCache = new Map()
  function partsOf(T) {
    if (partsCache.has(T.id)) return partsCache.get(T.id)
    const out = (ctx.byName.get(T.name) ?? []).filter((s) => s.id === T.id || (s.qname === T.qname && s.kind === T.kind && s.family === T.family && (s.family === 'csharp' || s.family === 'ruby')))
    if (!out.some((s) => s.id === T.id)) out.unshift(T)
    partsCache.set(T.id, out)
    return out
  }

  function memberLookup(T, name, depth = 0) {
    if (!T || depth > 5) return []
    const list = ctx.members.get(T.name)?.get(name) ?? []
    const ids = new Set(partsOf(T).map((s) => s.id))
    const own = list.filter((s) => ids.has(ctx.syms.get(s.sha)[s.parent]?.id) || (s.owner === T.name && s.family === T.family))
    if (own.length) return own
    for (const P of partsOf(T)) for (const p of parentsOf(P)) { const r = memberLookup(p, name, depth + 1); if (r.length) return r }
    return []
  }

  function fieldType(T, name, depth = 0) {
    if (!T || depth > 5) return null
    for (const P of partsOf(T)) {
      const b = (ctx.binds.get(P.sha) ?? []).find((x) => x.scope === P.idx && x.name === name && x.kind === 'field')
      if (b) return typeFromBind(fileCtx(P.path), b, P.idx, depth + 1)
    }
    for (const p of parentsOf(T)) { const r = fieldType(p, name, depth + 1); if (r) return r }
    // getter/property with return type
    const m = memberLookup(T, name).find((s) => s.kind === 'method' || s.kind === 'property')
    if (m) { const rt = returnType(m, m.family); if (rt) { const t = resolveTypeName(fileCtx(m.path), rt, depth + 1); if (t) return { type: t } } }
    return null
  }

  function typeFromBind(fc, b, srcIdx, depth = 0) {
    if (depth > 5) return null
    if (b.kind === 'expr') return chainType(fc, b.type.split('.'), srcIdx, depth + 1)
    const objT = b.type.trim()
    if (objT.startsWith('{')) return { obj: objectMembers(objT), fc }
    if (b.kind === 'call') {
      const fn = resolveCallee(fc, b.type, srcIdx, depth + 1)
      if (!fn) return null
      if (CLASSY.has(fn.kind)) return { type: fn }
      if ((fn.name === 'new' || fn.name === 'create' || fn.name === 'getInstance') && fn.owner) { const t = resolveTypeName(fileCtx(fn.path), fn.owner); if (t) return { type: t } }
      const rt = returnType(fn, fn.family)
      if (!rt) { const p = ctx.syms.get(fn.sha)?.[fn.parent]; if (fn.name === 'new' && p && CLASSY.has(p.kind)) return { type: p }; return null }
      const t = resolveTypeName(fileCtx(fn.path), rt, depth + 1)
      return t ? { type: t } : null
    }
    const t = resolveTypeName(fc, normType(b.type), depth + 1)
    return t ? { type: t } : null
  }

  // `foo` or `a.b.foo` as the callee of a bindcall
  function resolveCallee(fc, text, srcIdx, depth) {
    const parts = text.replace(/\?\./g, '.').replace(/::/g, '.').replace(/->/g, '.').split('.')
    const name = parts.pop()
    if (!parts.length) return bareLookup(fc, name, srcIdx, 'call')[0]?.s ?? null
    const t = chainType(fc, parts, srcIdx, depth)
    if (t?.ns) return resolveExport(t.ns, name)[0] ?? null
    if (t?.type) return memberLookup(t.type, name)[0] ?? null
    return null
  }

  function headType(fc, head, srcIdx, depth = 0) {
    if (depth > 6) return null
    if (SELF.has(head)) { const c = srcIdx !== null ? classOf(fc, srcIdx) : null; return c ? { type: c } : null }
    if (head === 'super') { const c = srcIdx !== null ? classOf(fc, srcIdx) : null; const p = c ? parentsOf(c)[0] : null; return p ? { type: p } : null }
    if (srcIdx !== null) {
      const chain = chainOf(fc, srcIdx)
      const binds = ctx.binds.get(fc.sha) ?? []
      for (const s of chain) {
        const b = binds.find((x) => x.scope === s.idx && x.name === head && x.kind !== 'field')
        if (b) return typeFromBind(fc, b, srcIdx, depth + 1)
      }
    }
    const b = fc.scope.get(head)
    if (b) {
      if (b.imported === '*' || b.imported === 'pkg') return { ns: b.paths }
      const hit = resolveExport(b.paths, b.imported)
      const cls = hit.find((s) => CLASSY.has(s.kind))
      if (cls) return { type: cls, static: true }
      const ns = exportNamespace(b.paths, b.imported)
      if (ns) return { ns }
      const v = hit[0]
      if (v) {
        if (ctx.members.get(v.name)?.size && v.kind === 'const') return { type: v }
        const vb = (ctx.binds.get(v.sha) ?? []).find((x) => x.scope === 0 && x.name === v.name)
        if (vb) return typeFromBind(fileCtx(v.path), vb, 0, depth + 1)
      }
      return null
    }
    const local = fc.syms.find((s) => s && s.idx > 0 && s.name === head && s.parent === 0)
    if (local && CLASSY.has(local.kind)) return { type: local, static: true }
    if (local && local.kind === 'const' && ctx.members.get(local.name)?.size) return { type: local }
    if (/^[A-Z]/.test(head)) { const t = resolveTypeName(fc, head, depth + 1); if (t) return { type: t, static: true } }
    return null
  }

  function stepType(cur, part, depth = 0) {
    if (cur.obj) {
      const t = cur.obj.get(part)
      if (!t) return null
      if (t.trim().startsWith('{')) return { obj: objectMembers(t), fc: cur.fc }
      const r = resolveTypeName(cur.fc, normType(t), depth + 1)
      return r ? { type: r } : null
    }
    if (cur.ns) {
      const hit = resolveExport(cur.ns, part)
      const cls = hit.find((s) => CLASSY.has(s.kind))
      if (cls) return { type: cls, static: true }
      const ns = exportNamespace(cur.ns, part)
      return ns ? { ns } : null
    }
    if (cur.type) return fieldType(cur.type, part, depth + 1)
    return null
  }

  function chainType(fc, parts, srcIdx, depth = 0) {
    let t = headType(fc, parts[0], srcIdx, depth)
    for (const p of parts.slice(1)) { if (!t) return null; t = stepType(t, p, depth) }
    return t
  }

  // name without receiver: same file -> import -> implicit member -> same package -> import * -> unique name
  function bareLookup(fc, name, srcIdx, kind) {
    const wantType = kind === 'type'
    // `new X()` can only be a class (in JS, also a constructor function)
    const ok = (s) => s && s.idx > 0 && (wantType ? CLASSY.has(s.kind) : kind === 'new' ? CLASSY.has(s.kind) || (fc.family === 'js' && s.kind === 'function') : true)
    const chain = srcIdx !== null ? chainOf(fc, srcIdx) : [fc.syms[0]]
    const chainIdx = new Set(chain.map((s) => s.idx))
    const implicitMembers = ['java', 'csharp', 'php', 'ruby', 'c'].includes(fc.family)
    const local = fc.syms.filter((s) => ok(s) && s.name === name && chainIdx.has(s.parent) && (s.kind !== 'method' || implicitMembers || !fc.syms[s.parent] || fc.syms[s.parent].kind === 'file'))
    if (local.length) { local.sort((a, b) => chain.findIndex((c) => c.idx === a.parent) - chain.findIndex((c) => c.idx === b.parent)); return [{ s: local[0], conf: 1 }] }
    const b = fc.scope.get(name)
    if (b && b.imported !== '*') { const hit = resolveExport(b.paths, b.imported).filter(ok); if (hit.length) return hit.map((s) => ({ s, conf: 1 })) }
    // const { open } = useFileDocuments(): the hook's inner function `open` (or member of the return type)
    if (!wantType) {
      const binds = ctx.binds.get(fc.sha) ?? []
      const d = chain.map((c) => binds.find((x) => x.scope === c.idx && x.name === name && x.kind === 'destrcall')).find(Boolean)
      if (d) {
        const fn = resolveCallee(fc, d.type, srcIdx, 1)
        if (fn) {
          const inner = (ctx.syms.get(fn.sha) ?? []).filter((x) => x && x.parent === fn.idx && x.name === name)
          if (inner.length) return inner.map((s) => ({ s, conf: 0.9 }))
          const rt = returnType(fn, fn.family)
          const T = rt ? resolveTypeName(fileCtx(fn.path), rt) : null
          const m = T ? memberLookup(T, name) : []
          if (m.length) return m.map((s) => ({ s, conf: 0.9 }))
        }
      }
    }
    if (implicitMembers || fc.family === 'python') {
      const c = srcIdx !== null ? classOf(fc, srcIdx) : null
      if (c && implicitMembers) { const m = memberLookup(c, name).filter(ok); if (m.length) return m.map((s) => ({ s, conf: 0.9 })) }
    }
    if (LANGUAGES[Object.keys(LANGUAGES).find((l) => LANGUAGES[l].family === fc.family)]?.samePackageDir) {
      const same = (ctx.byName.get(name) ?? []).filter((s) => ok(s) && s.family === fc.family && dirOf(s.path) === dirOf(fc.path) && s.parent === 0)
      if (same.length) return same.slice(0, 3).map((s) => ({ s, conf: 0.9 }))
    }
    const nsHit = nsLookup(fc, name).filter(ok)
    if (nsHit.length) return nsHit.slice(0, 3).map((s) => ({ s, conf: 0.9 }))
    const w = resolveExport(fc.wild, name).filter(ok)
    if (w.length) return w.slice(0, 3).map((s) => ({ s, conf: 0.8 }))
    if (kind === 'ref' || fc.bound.has(name) || GLOBALS.has(name)) return []
    // in JS/TS, Python and Rust a bare name without import cannot come from another file
    if (['js', 'python', 'rust'].includes(fc.family)) return []
    const all = (ctx.byName.get(name) ?? []).filter((s) => ok(s) && s.family === fc.family && s.sha !== fc.sha && (s.parent === 0 || CLASSY.has(s.kind)) && s.kind !== 'method' && s.kind !== 'const' && s.kind !== 'property')
    if (all.length === 1) return [{ s: all[0], conf: 0.5 }]
    const top = (p) => p.split('/').slice(0, 2).join('/')
    const near = all.filter((s) => top(s.path) === top(fc.path))
    if (near.length === 1) return [{ s: near[0], conf: 0.4 }]
    return []
  }

  function resolveRef(fc, r) {
    if (!r.receiver) return bareLookup(fc, r.name, r.src, r.kind)
    if (r.receiver !== '(expr)') {
      const parts = r.receiver.split('.')
      const t = chainType(fc, parts, r.src)
      if (t?.ns) { const hit = resolveExport(t.ns, r.name); if (hit.length) return hit.map((s) => ({ s, conf: 1 })) }
      if (t?.type) { const hit = memberLookup(t.type, r.name); if (hit.length) return hit.map((s) => ({ s, conf: 1 })) }
      // the start of the receiver is known, but the rest is not (e.g. Data.actors.Find): it's a collection/library, not a guess
      if (TYPED.has(fc.family) && (t || (parts.length > 1 && headType(fc, parts[0], r.src)))) return []
    }
    const head = r.receiver.split('.')[0]
    if (STOP.has(r.name) || r.kind === 'type' || GLOBALS.has(head) || fc.bound.has(head)) return []
    // unknown receiver: only links if the method has a single owner in the project
    // and if it is in a file this one imports (or in the same folder)
    const near = new Set(fc.targets)
    const cands = (ctx.byName.get(r.name) ?? []).filter((s) => (s.kind === 'method' || s.kind === 'property') && s.family === fc.family && (near.has(s.path) || dirOf(s.path) === dirOf(fc.path)))
    const owners = new Set(cands.map((s) => s.owner ?? ctx.syms.get(s.sha)[s.parent]?.id))
    if (cands.length && owners.size === 1 && cands.length <= 2) return cands.map((s) => ({ s, conf: 0.6 }))
    return []
  }

  function linkFile(path) {
    const fc = fileCtx(path)
    const edges = new Map()
    const fileW = new Map(fc.targets.map((t) => [t, 1]))
    const add = (src, dst, kind, line, conf) => {
      if (!src || !dst || src.id === dst.id) return
      const k = src.id + ':' + dst.id + ':' + kind
      const e = edges.get(k)
      if (e) { e.n++; if (line < e.line) e.line = line; if (conf > e.conf) e.conf = conf; if (e.lines.length < 60 && !e.lines.includes(line)) e.lines.push(line) } else edges.set(k, { src: src.id, dst: dst.id, kind, line, n: 1, conf, lines: [line] })
      if (dst.path !== path) fileW.set(dst.path, (fileW.get(dst.path) ?? 0) + 1)
    }
    for (const r of refsOf(fc.sha)) {
      const src = fc.syms[r.src] ?? fc.syms[0]
      for (const { s, conf } of resolveRef(fc, r)) add(src, s, EDGE_KIND[r.kind], r.line, conf)
    }
    for (const h of ctx.heritage.get(fc.sha) ?? []) {
      const owner = h.owner > 0 ? fc.syms[h.owner] : resolveTypeName(fc, h.owner_name)
      const target = resolveTypeName(fc, h.target)
      if (owner && target) add(owner, target, h.kind, owner.line, 1)
    }
    return { edges: [...edges.values()], fileEdges: [...fileW].filter(([p]) => p !== path) }
  }

  let refsOf = () => []
  return { linkFile, setRefs: (fn) => { refsOf = fn }, fileCtx, resolveTypeName, memberLookup }
}

export function link(db, root, { changed = null, oldNames = [] } = {}) {
  const t0 = Date.now()
  const ctx = loadContext(db, root)
  const L = linker(ctx)
  const refStmt = db.prepare('select src, name, receiver, kind, line from refs where sha = ?')
  L.setRefs((sha) => refStmt.all(sha))

  let targets
  if (!changed) {
    db.prepare('delete from edges where root = ?').run(root)
    db.prepare('delete from file_edges where root = ?').run(root)
    targets = [...ctx.paths]
  } else {
    const set = new Set(changed.filter((p) => ctx.paths.has(p)))
    const names = new Set(oldNames)
    for (const p of set) for (const s of ctx.syms.get(ctx.shaOf.get(p)) ?? []) if (s?.idx > 0) names.add(s.name)
    const imp = db.prepare('select src from file_edges where root = ? and dst = ?')
    for (const p of changed) for (const r of imp.all(root, p)) if (ctx.paths.has(r.src)) set.add(r.src)
    const nameList = [...names]
    for (let i = 0; i < nameList.length; i += 400) {
      const chunk = nameList.slice(i, i + 400)
      const rows = db.prepare(`select distinct t.path from trees t join refs r on r.sha = t.sha where t.root = ? and r.name in (${chunk.map(() => '?').join(',')})`).all(root, ...chunk)
      for (const r of rows) set.add(r.path)
    }
    targets = [...set]
    const ids = db.prepare('select s.id from symbols s where s.sha = ?')
    const delSrc = db.prepare('delete from edges where root = ? and src = ?')
    const delFile = db.prepare('delete from file_edges where root = ? and src = ?')
    db.exec('begin')
    for (const p of [...targets, ...changed]) { delFile.run(root, p); const sha = ctx.shaOf.get(p); if (sha) for (const { id } of ids.all(sha)) delSrc.run(root, id) }
    // edges pointing to symbols of blobs that left the folder
    db.prepare(`delete from edges where root = ? and (src not in (select s.id from trees t join symbols s on s.sha = t.sha where t.root = ?) or dst not in (select s.id from trees t join symbols s on s.sha = t.sha where t.root = ?))`).run(root, root, root)
    db.exec('commit')
  }

  const insE = db.prepare('insert into edges(root, src, dst, kind, line, n, conf, lines) values (?,?,?,?,?,?,?,?)')
  const insF = db.prepare('insert into file_edges(root, src, dst, weight) values (?,?,?,?)')
  let n = 0
  db.exec('begin')
  for (const p of targets) {
    const { edges, fileEdges } = L.linkFile(p)
    for (const e of edges) { insE.run(root, e.src, e.dst, e.kind, e.line, e.n, e.conf, e.lines.sort((a, b) => a - b).join(',')); n++ }
    for (const [dst, w] of fileEdges) insF.run(root, p, dst, w)
  }
  db.exec('commit')
  return { files: targets.length, edges: n, ms: Date.now() - t0 }
}
