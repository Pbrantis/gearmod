// Consultas sobre o índice de uma pasta. As saídas são texto pensado para o agente: curto, com caminho:linha,
// e código lido do disco na hora (nunca uma cópia velha).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { words } from './store.mjs'
import { isTest, isGenerated } from './langs.mjs'
import { expandTerms } from './terms.mjs'

const CLASSY = new Set(['class', 'interface', 'struct', 'trait', 'enum', 'module', 'type'])
const linesOf = (e) => e.lines || String(e.line)
const CALLISH = ['calls', 'instantiates', 'renders']
const KIND_ORDER = ['class', 'interface', 'struct', 'trait', 'function', 'method', 'enum', 'type', 'module', 'property', 'const']
const STOPWORDS = new Set('a o os as de do da dos das e em no na nos nas um uma para por com como que se ao aos onde quando qual quais porque pra sem sobre entre pelo pela isso esse essa este esta ele ela eles elas seu sua ser ter faz fazer fica ficar the of and to in on for with how what where when why which is are does do it this that from by an be as at or not into via flow work works code file files function functions class method'.split(' '))

export class Queries {
  constructor(db, root) {
    this.db = db
    this.root = root
    this.files = new Map()
    this.st = {
      sym: db.prepare('select s.*, t.path from symbols s join trees t on t.sha = s.sha and t.root = ? where s.id = ? limit 1'),
      byName: db.prepare(`select s.*, t.path from symbols s join trees t on t.sha = s.sha and t.root = ? where s.name = ? and s.kind != 'file'`),
      byNameCi: db.prepare(`select s.*, t.path from symbols s join trees t on t.sha = s.sha and t.root = ? where s.name = ? collate nocase and s.kind != 'file'`),
      byQname: db.prepare(`select s.*, t.path from symbols s join trees t on t.sha = s.sha and t.root = ? where (s.qname = ? or s.qname like ?) and s.kind != 'file'`),
      inFile: db.prepare(`select s.*, t.path from symbols s join trees t on t.sha = s.sha and t.root = ? where t.path = ? and s.kind != 'file' order by s.line`),
      fileSym: db.prepare(`select s.*, t.path from symbols s join trees t on t.sha = s.sha and t.root = ? where t.path = ? and s.idx = 0`),
      in: db.prepare('select e.src, e.dst, e.kind, e.line, e.n, e.conf, e.lines from edges e where e.root = ? and e.dst = ?'),
      out: db.prepare('select e.src, e.dst, e.kind, e.line, e.n, e.conf, e.lines from edges e where e.root = ? and e.src = ?'),
      fileIn: db.prepare('select src, weight from file_edges where root = ? and dst = ?'),
      fileOut: db.prepare('select dst, weight from file_edges where root = ? and src = ?'),
      paths: db.prepare('select path, lang from trees where root = ? order by path'),
      ftsRaw: db.prepare(`select rowid id, bm25(symbols_fts, 10.0, 2.0, 1.5) score from symbols_fts where symbols_fts match ? order by score limit ?`),
      rootIds: db.prepare('select s.id from symbols s join trees t on t.sha = s.sha and t.root = ?')
    }
    this.symCache = new Map()
    // busca textual é global (os blobs são compartilhados); filtra pelos símbolos desta pasta
    let ids = null
    this.st.fts = { all: (match, _root, limit) => {
      ids ??= new Set(this.st.rootIds.all(this.root).map((r) => r.id))
      return this.st.ftsRaw.all(match, Math.max(limit * 8, 400)).filter((r) => ids.has(r.id)).slice(0, limit)
    } }
  }

  // ---- básicos ----------------------------------------------------------------------------------------------------

  sym(id) {
    if (this.symCache.has(id)) return this.symCache.get(id)
    const s = this.st.sym.get(this.root, id) ?? null
    this.symCache.set(id, s)
    return s
  }
  label(s) { return s.kind === 'file' ? s.path : s.qname }
  where(s, line) { return `${s.path}:${line ?? s.line}` }
  lines(path) {
    if (!this.files.has(path)) { try { this.files.set(path, readFileSync(join(this.root, path), 'utf8').split(/\r?\n/)) } catch { this.files.set(path, []) } }
    return this.files.get(path)
  }
  resolvePath(file) {
    if (!file) return null
    const f = file.replace(/\\/g, '/').replace(/^\.\//, '')
    const all = this.st.paths.all(this.root).map((r) => r.path)
    if (all.includes(f)) return f
    const hits = all.filter((p) => p.endsWith('/' + f) || p.slice(p.lastIndexOf('/') + 1) === f || p.slice(p.lastIndexOf('/') + 1).replace(/\.\w+$/, '') === f)
    return hits.sort((a, b) => a.length - b.length)[0] ?? null
  }
  rank(list) { return list.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.exported - a.exported || isTest(a.path) - isTest(b.path) || a.path.length - b.path.length) }

  find(name, { file, line } = {}) {
    if (!name) return []
    let list = name.includes('.') || name.includes('::') ? this.st.byQname.all(this.root, name.replace(/::/g, '.'), '%.' + name.replace(/::/g, '.')) : this.st.byName.all(this.root, name)
    if (!list.length) list = this.st.byNameCi.all(this.root, name)
    if (file) { const p = this.resolvePath(file); const f = list.filter((s) => s.path === p || s.path.endsWith(file)); if (f.length) list = f }
    if (line) { const at = list.filter((s) => s.line <= line && line <= s.end_line); list = at.length ? at : list.sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line)).slice(0, 1) }
    return this.rank(list)
  }
  incoming(id, kinds) { return this.st.in.all(this.root, id).filter((e) => !kinds || kinds.includes(e.kind)) }
  outgoing(id, kinds) { return this.st.out.all(this.root, id).filter((e) => !kinds || kinds.includes(e.kind)) }

  // membros de uma classe (para impacto/quem chama de uma classe)
  members(s) { return this.st.inFile.all(this.root, s.path).filter((m) => m.sha === s.sha && m.parent === s.idx) }

  testsFor(ids, hops = 3) {
    const direct = new Set()
    const via = new Set()
    let frontier = [...ids]
    const seen = new Set(ids)
    for (let h = 1; h <= hops && frontier.length; h++) {
      const next = []
      for (const id of frontier) for (const e of this.incoming(id)) {
        if (seen.has(e.src)) continue
        seen.add(e.src)
        const s = this.sym(e.src)
        if (!s) continue
        if (isTest(s.path)) (h === 1 ? direct : via).add(s.path)
        else next.push(e.src)
      }
      frontier = next
    }
    return { direct: [...direct], via: [...via].filter((p) => !direct.has(p)) }
  }

  snippet(s, maxLines = 120) {
    const L = this.lines(s.path)
    let start = s.line
    // comentário de documentação logo acima
    while (start > 1 && /^\s*(\/\/|\/\*|\*|#|"""|@)/.test(L[start - 2] ?? '') && s.line - start < 12) start--
    const end = Math.min(s.end_line, start + maxLines - 1)
    let out = ''
    for (let i = start; i <= end; i++) out += `${i}\t${L[i - 1] ?? ''}\n`
    if (end < s.end_line) out += `… (+${s.end_line - end} linhas até ${s.end_line})\n`
    return out
  }

  // ---- ferramentas ------------------------------------------------------------------------------------------------

  search(query, { kind, limit = 10 } = {}) {
    const seen = new Map()
    const push = (s, score) => { if (!s || s.kind === 'file' || (kind && s.kind !== kind)) return; const p = seen.get(s.id); if (!p || p.score < score) seen.set(s.id, { s, score }) }
    for (const s of this.find(query)) push(s, 100)
    const tokens = expandTerms(words(query).split(' ').filter((w) => w.length > 1))
    if (tokens.length) {
      const match = tokens.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ')
      try { for (const r of this.st.fts.all(match, this.root, limit * 6)) push(this.sym(r.id), 50 - r.score) } catch { /* consulta inválida */ }
    }
    const list = [...seen.values()].sort((a, b) => b.score - a.score || isGenerated(a.s.path) - isGenerated(b.s.path)).slice(0, limit)
    if (!list.length) return `Nada encontrado para "${query}".`
    return list.map(({ s }) => `${s.kind} ${s.qname} — ${this.where(s)}${s.end_line > s.line ? '-' + s.end_line : ''}\n    ${s.signature}`).join('\n')
  }

  node({ symbol, file, includeCode = false, line, offset, limit, symbolsOnly = false } = {}) {
    if (!symbol && file) {
      const p = this.resolvePath(file)
      if (!p) return `Arquivo não está no índice: ${file}`
      const deps = this.st.fileIn.all(this.root, p).map((r) => r.src)
      const depLine = deps.length ? `Dependem deste arquivo (${deps.length}): ${deps.slice(0, 8).join(', ')}${deps.length > 8 ? ` +${deps.length - 8}` : ''}` : 'Nenhum arquivo do projeto importa este.'
      if (symbolsOnly) {
        const syms = this.st.inFile.all(this.root, p)
        const depthOf = new Map()
        const outline = syms.map((s) => { const d = s.parent > 0 ? (depthOf.get(s.parent) ?? 0) + 1 : 0; depthOf.set(s.idx, d); return `${'  '.repeat(d)}${s.line}: ${s.kind} ${s.name}${s.kind === 'const' ? '' : ' — ' + s.signature.slice(0, 110)}` })
        return `# ${p} (${syms.length} símbolos)\n${outline.join('\n')}\n\n${depLine}`
      }
      const L = this.lines(p)
      const start = Math.max(1, offset ?? 1)
      const end = Math.min(L.length, start + Math.min(limit ?? 2000, 2000) - 1)
      let out = ''
      for (let i = start; i <= end; i++) out += `${i}\t${L[i - 1]}\n`
      return `${out}${end < L.length ? `… (arquivo tem ${L.length} linhas)\n` : ''}\n${depLine}`
    }
    const defs = this.find(symbol, { file, line })
    if (!defs.length) return `Símbolo "${symbol}" não encontrado. Parecidos:\n${this.search(symbol, { limit: 5 })}`
    const parts = []
    for (const s of defs.slice(0, 5)) {
      let out = `## ${s.kind} ${s.qname} — ${s.path}:${s.line}-${s.end_line}\n`
      if (s.doc) out += `${s.doc}\n`
      if (includeCode) {
        if (CLASSY.has(s.kind) && s.end_line - s.line > 120) out += this.snippet({ ...s, end_line: s.line + 3 }, 4) + this.members(s).map((m) => `    ${m.line}: ${m.kind} ${m.name} — ${m.signature.slice(0, 100)}`).join('\n') + '\n'
        else out += '```\n' + this.snippet(s, 200) + '```\n'
      } else out += `${s.signature}\n`
      const ids = CLASSY.has(s.kind) ? [s.id, ...this.members(s).map((m) => m.id)] : [s.id]
      const callers = this.dedupeCallers(ids.flatMap((id) => this.incoming(id)))
      const callees = this.outgoing(s.id).filter((e) => e.kind !== 'references' || CLASSY.has(this.sym(e.dst)?.kind))
      out += `\nUsado por (${callers.length}):\n` + (callers.slice(0, 15).map((c) => `  ${this.label(c.s)} — ${c.s.path}:${linesOf(c.e)}${c.e.kind !== 'calls' ? ' [' + c.e.kind + ']' : ''}${c.e.conf < 0.8 ? ' (provável)' : ''}`).join('\n') || '  (ninguém no projeto)')
      if (callers.length > 15) out += `\n  … +${callers.length - 15}`
      out += `\nUsa (${callees.length}):\n` + (callees.slice(0, 15).map((e) => { const d = this.sym(e.dst); return d ? `  ${d.qname} — ${this.where(d)} [${e.kind}]` : '' }).filter(Boolean).join('\n') || '  (nada do projeto)')
      const t = this.testsFor(ids)
      out += `\nTestes: ${t.direct.length ? t.direct.join(', ') : 'nenhum direto'}${t.via.length ? `; via chamadores: ${t.via.slice(0, 4).join(', ')}` : ''}`
      parts.push(out)
    }
    if (defs.length > 5) parts.push(`… +${defs.length - 5} definições com esse nome; passe file/line para escolher.`)
    return parts.join('\n\n')
  }

  dedupeCallers(edges) {
    const m = new Map()
    for (const e of edges) { const s = this.sym(e.src); if (!s) continue; const k = s.id + ':' + e.kind; const prev = m.get(k); if (!prev) m.set(k, { s, e: { ...e } }); else { const all = [...new Set([...linesOf(prev.e).split(','), ...linesOf(e).split(',')].map(Number))].sort((a, b) => a - b); prev.e.lines = all.join(','); prev.e.line = all[0] } }
    return [...m.values()].sort((a, b) => isTest(a.s.path) - isTest(b.s.path) || a.s.path.localeCompare(b.s.path) || a.e.line - b.e.line)
  }

  walk(symbol, { file, depth = 1, limit = 30, dir }) {
    const defs = this.find(symbol, { file })
    if (!defs.length) return `Símbolo "${symbol}" não encontrado.\n${this.search(symbol, { limit: 5 })}`
    const out = []
    for (const s of defs.slice(0, 3)) {
      const ids = dir === 'in' && CLASSY.has(s.kind) ? [s.id, ...this.members(s).map((m) => m.id)] : [s.id]
      const seen = new Set(ids)
      let frontier = ids
      const rows = []
      for (let d = 1; d <= Math.min(depth, 4) && frontier.length; d++) {
        const next = []
        for (const id of frontier) {
          const es = dir === 'in' ? this.incoming(id, [...CALLISH, 'references']) : this.outgoing(id, CALLISH)
          for (const e of es) {
            const other = dir === 'in' ? e.src : e.dst
            if (seen.has(other)) continue
            seen.add(other)
            const o = this.sym(other)
            if (!o) continue
            rows.push(`${'  '.repeat(d)}${this.label(o)} — ${dir === 'in' ? o.path + ':' + linesOf(e) : this.where(o)}${e.kind !== 'calls' ? ' [' + e.kind + ']' : ''}${e.conf < 0.8 ? ' (provável)' : ''}`)
            next.push(other)
          }
        }
        frontier = next
      }
      out.push(`${s.kind} ${s.qname} — ${this.where(s)}\n${rows.slice(0, limit).join('\n') || '  (nenhum)'}${rows.length > limit ? `\n  … +${rows.length - limit}` : ''}`)
    }
    return out.join('\n\n')
  }
  callers(symbol, opts = {}) { return this.walk(symbol, { ...opts, dir: 'in' }) }
  callees(symbol, opts = {}) { return this.walk(symbol, { ...opts, dir: 'out' }) }

  impact(symbol, { file, depth = 2 } = {}) {
    const defs = this.find(symbol, { file })
    if (!defs.length) return `Símbolo "${symbol}" não encontrado.`
    const s = defs[0]
    const start = CLASSY.has(s.kind) ? [s.id, ...this.members(s).map((m) => m.id)] : [s.id]
    const seen = new Map(start.map((id) => [id, 0]))
    const callLines = new Map() // chamador direto -> linhas onde chama
    let frontier = start
    for (let d = 1; d <= Math.min(depth, 5) && frontier.length; d++) {
      const next = []
      for (const id of frontier) for (const e of this.incoming(id)) { if (d === 1 && e.kind !== 'references') callLines.set(e.src, [...(callLines.get(e.src) ?? []), ...linesOf(e).split(',')]); if (!seen.has(e.src)) { seen.set(e.src, d); next.push(e.src) } }
      frontier = next
    }
    for (const id of start) seen.delete(id)
    const byFile = new Map()
    for (const [id, d] of seen) { const o = this.sym(id); if (!o) continue; if (!byFile.has(o.path)) byFile.set(o.path, []); byFile.get(o.path).push({ o, d }) }
    const files = [...byFile].sort((a, b) => Math.min(...a[1].map((x) => x.d)) - Math.min(...b[1].map((x) => x.d)) || isTest(a[0]) - isTest(b[0]))
    const tests = files.filter(([p]) => isTest(p)).map(([p]) => p)
    let out = `Impacto de mudar ${s.kind} ${s.qname} (${this.where(s)}): ${seen.size} símbolos em ${byFile.size} arquivos, até ${depth} níveis.${defs.length > 1 ? ` (há ${defs.length} definições com esse nome; usei a primeira)` : ''}\n`
    const where = (o) => (callLines.has(o.id) ? ` — chama nas linhas ${[...new Set(callLines.get(o.id))].sort((a, b) => a - b).join(', ')}` : '')
    out += 'Nível 1 (·) usa direto: a linha de cada chamada vem depois do traço. Nível 2 (··) usa quem usa.\n'
    for (const [p, list] of files.filter(([p]) => !isTest(p)).slice(0, 25)) out += `\n${p}\n` + list.sort((a, b) => a.d - b.d || a.o.line - b.o.line).slice(0, 30).map(({ o, d }) => `  ${'·'.repeat(d)} ${o.kind === 'file' ? '(nível do arquivo)' : o.qname}:${o.line}${where(o)}`).join('\n') + (list.length > 30 ? `\n  … +${list.length - 30}` : '')
    // testes que chamam direto também precisam mudar numa renomeação
    const direct = files.filter(([p]) => isTest(p)).flatMap(([, list]) => list.filter(({ o }) => callLines.has(o.id)).map(({ o }) => `  ${o.path}:${[...new Set(callLines.get(o.id))].join(', ')}`))
    if (direct.length) out += `\n\nTestes que usam direto (mudam junto):\n${direct.join('\n')}`
    // nome citado fora do código ligado: strings (mock.patch, rotas, config), comentários, docstrings
    const known = new Set([...callLines].flatMap(([id, ls]) => { const o = this.sym(id); return o ? ls.map((l) => `${o.path}:${l}`) : [] }))
    for (const d of defs) known.add(`${d.path}:${d.line}`)
    const mentions = this.textMentions(s.name, known)
    if (mentions.length) out += `\n\nOutras menções ao nome (texto, comentário, mock, import — confira numa renomeação) (${mentions.length}):\n${mentions.slice(0, 40).map((m) => '  ' + m).join('\n')}${mentions.length > 40 ? `\n  … +${mentions.length - 40}` : ''}`
    for (const m of mentions) { const p = m.slice(0, m.indexOf(':')); if (isTest(p) && !tests.includes(p)) tests.push(p) }
    out += `\n\nTestes para rodar (${tests.length}): ${tests.join(', ') || 'nenhum encontrado'}`
    return out
  }

  // linhas (arquivo:linha) que citam o nome como palavra, menos as já conhecidas
  textMentions(name, known = new Set()) {
    if (!name || name.length < 3) return []
    const re = new RegExp(`(^|[^\\w$])${name.replace(/[$]/g, '\\$')}(?![\\w$])`)
    const out = []
    for (const { path } of this.st.paths.all(this.root)) {
      let text
      try { text = readFileSync(join(this.root, path), 'utf8') } catch { continue }
      if (!text.includes(name)) continue
      text.split(/\r?\n/).forEach((l, i) => { if (re.test(l) && !known.has(`${path}:${i + 1}`)) out.push(`${path}:${i + 1}  ${l.trim().slice(0, 110)}`) })
    }
    return out
  }

  filesTree({ path = '', pattern, format = 'tree', depth } = {}) {
    const counts = new Map(this.db.prepare(`select t.path, count(s.id) n from trees t left join symbols s on s.sha = t.sha and s.idx > 0 where t.root = ? group by t.path`).all(this.root).map((r) => [r.path, r.n]))
    const re = pattern ? new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '.') + '$') : null
    const rows = this.st.paths.all(this.root).filter((r) => r.path.startsWith(path) && (!re || re.test(r.path) || re.test(r.path.slice(r.path.lastIndexOf('/') + 1))))
    if (!rows.length) return 'Nenhum arquivo.'
    if (format === 'flat') return rows.map((r) => `${r.path} (${r.lang}, ${counts.get(r.path) ?? 0})`).join('\n')
    if (format === 'grouped') { const g = {}; for (const r of rows) (g[r.lang] ??= []).push(r.path); return Object.entries(g).map(([l, ps]) => `${l} (${ps.length}):\n  ${ps.join('\n  ')}`).join('\n') }
    const tree = {}
    for (const r of rows) {
      const parts = r.path.slice(path ? path.replace(/\/?$/, '/').length : 0).split('/')
      let node = tree
      parts.forEach((p, i) => { if (i === parts.length - 1) node[p] = `${r.lang}, ${counts.get(r.path) ?? 0}`; else node = node[p + '/'] ??= {} })
    }
    const lines = []
    const render = (node, d) => {
      for (const [k, v] of Object.entries(node).sort(([a, x], [b, y]) => (typeof x === 'string') - (typeof y === 'string') || a.localeCompare(b))) {
        if (typeof v === 'string') lines.push(`${'  '.repeat(d)}${k} (${v})`)
        else { const n = JSON.stringify(v).split('",').length; lines.push(`${'  '.repeat(d)}${k}${depth !== undefined && d >= depth ? ` (${n} arquivos)` : ''}`); if (depth === undefined || d < depth) render(v, d + 1) }
      }
    }
    render(tree, 0)
    return lines.join('\n')
  }

  status() {
    const r = this.db.prepare('select * from roots where root = ?').get(this.root)
    const files = this.db.prepare('select lang, count(*) n from trees where root = ? group by lang').all(this.root)
    const syms = this.db.prepare(`select count(*) n from symbols s join trees t on t.sha = s.sha and t.root = ? where s.idx > 0`).get(this.root).n
    const edges = this.db.prepare('select kind, count(*) n from edges where root = ? group by kind').all(this.root)
    return `Pasta: ${this.root}\nIndexada em: ${r ? new Date(r.indexed_at).toLocaleString() : 'nunca'} (${r?.ms ?? '?'} ms)\nArquivos: ${files.reduce((a, f) => a + f.n, 0)} (${files.map((f) => `${f.lang} ${f.n}`).join(', ')})\nSímbolos: ${syms}\nArestas: ${edges.map((e) => `${e.kind} ${e.n}`).join(', ')}`
  }

  // testes que dependem dos arquivos mudados (padrão: o que mudou desde o HEAD)
  affected({ files } = {}) {
    let changed = files
    if (!changed?.length) {
      try { changed = execFileSync('git', ['-C', this.root, 'status', '--porcelain', '-uall'], { encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')) } catch { changed = [] }
    }
    changed = changed.map((f) => this.resolvePath(f) ?? f)
    const seen = new Map(changed.map((f) => [f, 0]))
    let frontier = [...changed]
    for (let d = 1; d <= 6 && frontier.length; d++) {
      const next = []
      for (const f of frontier) for (const r of this.st.fileIn.all(this.root, f)) if (!seen.has(r.src)) { seen.set(r.src, d); next.push(r.src) }
      frontier = next
    }
    const tests = [...seen].filter(([p]) => isTest(p)).sort((a, b) => a[1] - b[1])
    if (!changed.length) return 'Nada mudou.'
    return `Arquivos mudados (${changed.length}): ${changed.slice(0, 15).join(', ')}${changed.length > 15 ? ' …' : ''}\nTestes afetados (${tests.length}):\n${tests.map(([p, d]) => `  ${p}${d === 0 ? ' (mudou)' : d === 1 ? '' : ` (${d} níveis)`}`).join('\n') || '  nenhum'}`
  }

  // visão geral: arquivos centrais (PageRank no grafo de arquivos) com seus símbolos principais
  map({ tokens = 1500, path = '', focus = [] } = {}) {
    const edges = this.db.prepare('select src, dst, weight from file_edges where root = ?').all(this.root).filter((e) => e.src.startsWith(path) && e.dst.startsWith(path) && !isGenerated(e.src) && !isGenerated(e.dst) && !isTest(e.src) && !isTest(e.dst))
    const nodes = new Set(edges.flatMap((e) => [e.src, e.dst]))
    if (!nodes.size) for (const r of this.st.paths.all(this.root)) if (r.path.startsWith(path)) nodes.add(r.path)
    const out = new Map()
    for (const e of edges) { if (!out.has(e.src)) out.set(e.src, []); out.get(e.src).push(e) }
    const focusSet = new Set(focus.map((f) => this.resolvePath(f)).filter(Boolean))
    const N = nodes.size
    const pv = (n) => (focusSet.size ? (focusSet.has(n) ? 1 / focusSet.size : 0) : 1 / N)
    let rank = new Map([...nodes].map((n) => [n, 1 / N]))
    for (let i = 0; i < 30; i++) {
      const next = new Map([...nodes].map((n) => [n, 0.15 * pv(n)]))
      for (const [src, es] of out) { const tot = es.reduce((a, e) => a + Math.log2(1 + e.weight), 0); for (const e of es) next.set(e.dst, next.get(e.dst) + 0.85 * rank.get(src) * (Math.log2(1 + e.weight) / tot)) }
      rank = next
    }
    const ranked = [...rank].sort((a, b) => b[1] - a[1])
    let text = ''
    for (const [p] of ranked) {
      const syms = this.st.inFile.all(this.root, p)
      const top = syms.filter((s) => s.parent === 0 && s.exported && s.kind !== 'const' || (s.parent === 0 && CLASSY.has(s.kind)))
      const lines = top.slice(0, 12).map((s) => {
        const ms = CLASSY.has(s.kind) ? syms.filter((m) => m.sha === s.sha && m.parent === s.idx && m.kind === 'method' && !m.name.startsWith('#') && m.name !== 'constructor').map((m) => m.name) : []
        return `  ${s.line}: ${s.signature.slice(0, 110)}${ms.length ? `\n      ${ms.slice(0, 14).join(', ')}${ms.length > 14 ? ` +${ms.length - 14}` : ''}` : ''}`
      })
      const chunk = `${p}\n${lines.join('\n')}${top.length > 12 ? `\n  … +${top.length - 12}` : ''}\n`
      if ((text.length + chunk.length) / 4 > tokens) break
      text += chunk
    }
    return text || 'Sem dados para o mapa.'
  }

  // ---- explorar ---------------------------------------------------------------------------------------------------

  // Modo resumo: onde está cada coisa (linhas exatas + assinatura) e só os trechos mais importantes e curtos inteiros.
  // O agente abre o resto com Read(offset/limit) ou codigo_no — paga só pelo que precisar.
  exploreOutline(picked, fileOrder, score, { wantsTests, inFlow = new Set(), snippets = 4, snippetMax = 45, budget = 8000 } = {}) {
    let out = '**Onde está** (linhas exatas; abra só o que precisar com Read offset/limit ou codigo_no codigo=true)\n\n'
    for (const p of fileOrder.slice(0, 15)) {
      if (isTest(p) && !wantsTests) continue
      const syms = picked.filter((s) => s.path === p).sort((a, b) => a.line - b.line)
      out += `\`${p}\`\n` + syms.map((s) => `  ${s.line}-${s.end_line} ${s.kind} ${s.qname}${s.kind === 'const' ? '' : ' — ' + s.signature.slice(0, 120)}${s.doc ? `\n      ${s.doc.slice(0, 110)}` : ''}`).join('\n') + '\n'
    }
    // trechos inteiros: os de maior nota, curtos, que não sejam classes inteiras
    const best = [...picked].filter((s) => !CLASSY.has(s.kind) && s.end_line - s.line + 1 <= snippetMax && (!isTest(s.path) || wantsTests)).sort((a, b) => inFlow.has(b.id) - inFlow.has(a.id) || (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0)).slice(0, snippets)
    let used = 0
    const blocks = []
    for (const s of best.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)) {
      const L = this.lines(s.path)
      let block = `\`${s.path}\` ${s.qname}\n\`\`\`${s.path.slice(s.path.lastIndexOf('.') + 1)}\n`
      for (let k = s.line; k <= s.end_line; k++) block += `${k}\t${L[k - 1] ?? ''}\n`
      block += '```\n'
      if (used + block.length > budget) break
      used += block.length
      blocks.push(block)
    }
    if (blocks.length) out += `\n**Trechos principais** (conteúdo atual do disco)\n\n${blocks.join('\n')}`
    return out
  }

  explore(query, { maxFiles = 12, budget = 26000, detail = 'completo' } = {}) {
    const wantsTests = /\b(test|teste|spec)/i.test(query)
    const raw = query.split(/[^\p{L}\p{N}_$./-]+/u).filter(Boolean)
    const score = new Map()
    const add = (s, v) => { if (!s || s.kind === 'file') return; let k = v; if (isGenerated(s.path)) k *= 0.3; if (isTest(s.path) && !wantsTests) k *= 0.25; score.set(s.id, (score.get(s.id) ?? 0) + k); this.symCache.set(s.id, s) }
    const exactHits = new Set()
    for (const tok of raw) {
      const t = tok.replace(/[./-]+$/, '')
      if (t.length < 3 || STOPWORDS.has(t.toLowerCase())) continue
      if (/[./]/.test(t) && /\.\w{1,4}$|\//.test(t)) {
        const p = this.resolvePath(t)
        if (p) { const syms = this.st.inFile.all(this.root, p).filter((s) => s.parent === 0); for (const s of syms.slice(0, 12)) add(s, s.exported ? 5 : 3) }
        continue
      }
      // identificador de código (camelCase, snake_case, PascalCase) pesa muito; palavra comum pesa pouco
      const ident = /[A-Z_]|\d/.test(t.slice(1)) || /^[A-Z]/.test(t) || t.includes('.')
      const hits = ident ? this.find(t) : this.st.byName.all(this.root, t)
      if (hits.length) {
        const each = ident ? Math.max(4, 16 / Math.sqrt(hits.length)) : 2.5 / Math.sqrt(hits.length)
        for (const s of this.rank(hits).slice(0, 8)) { add(s, each); if (ident) exactHits.add(s.id) }
      }
    }
    const ftsWords = expandTerms(words(raw.join(' ')).split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase())))
    if (ftsWords.length) {
      try {
        const rows = this.st.fts.all(ftsWords.map((w) => `"${w.replace(/"/g, '')}"*`).join(' OR '), this.root, 60)
        rows.forEach((r, i) => add(this.sym(r.id), (exactHits.size ? 4 : 7) * (1 - i / 60)))
      } catch { /* consulta inválida */ }
    }
    if (!score.size) return `Nada encontrado para "${query}". Tente nomes de funções, classes ou arquivos.`

    // ligações entre os candidatos sobem a nota
    let cands = [...score].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id]) => id)
    const candSet = new Set(cands)
    for (const id of cands) {
      const links = [...this.incoming(id), ...this.outgoing(id)].filter((e) => candSet.has(e.src === id ? e.dst : e.src)).length
      if (links) score.set(id, score.get(id) + Math.min(9, links * 3))
    }
    cands = [...score].sort((a, b) => b[1] - a[1]).map(([id]) => id)

    // fluxo: caminhos de chamada entre os símbolos citados (ou, sem citação, entre os mais fortes)
    const strong = exactHits.size >= 2 ? cands.filter((id) => exactHits.has(id)).slice(0, 10) : cands.slice(0, 8)
    const strongSet = new Set(strong)
    const flows = []
    for (const a of strong) {
      const prev = new Map([[a, null]])
      let frontier = [a]
      for (let d = 0; d < 4 && frontier.length; d++) {
        const next = []
        for (const id of frontier) for (const e of this.outgoing(id, CALLISH)) {
          if (prev.has(e.dst)) continue
          prev.set(e.dst, { id, e })
          if (strongSet.has(e.dst) && e.dst !== a) {
            const path = [e.dst]
            for (let p = prev.get(e.dst); p; p = prev.get(p.id)) path.unshift(p.id)
            flows.push(path)
          }
          next.push(e.dst)
        }
        frontier = next
      }
    }
    // prefere caminhos que passam por mais símbolos citados e são curtos
    const named = (f) => f.filter((id) => strongSet.has(id)).length
    const flowsKept = []
    for (const f of flows.sort((x, y) => named(y) - named(x) || x.length - y.length)) if (!flowsKept.some((k) => f.every((id) => k.includes(id)))) flowsKept.push(f)
    // junta caminhos encadeados (a→b e b→c viram a→b→c)
    for (let changed = true; changed;) {
      changed = false
      for (const a of flowsKept) for (const b of flowsKept) if (a !== b && a.at(-1) === b[0] && !b.slice(1).some((id) => a.includes(id))) { a.push(...b.slice(1)); flowsKept.splice(flowsKept.indexOf(b), 1); changed = true; break }
    }
    for (const f of flowsKept) for (const id of f) if (!score.has(id)) score.set(id, 4)

    // seleção por arquivo; corta o que ficou muito abaixo do melhor
    const top = score.get(cands[0]) ?? 0
    const floor = Math.max(2.5, top * (exactHits.size ? 0.22 : 0.35))
    const inFlow = new Set(flowsKept.flat())
    const picked = []
    const perFile = new Map()
    for (const id of [...new Set([...flowsKept.flat(), ...cands])]) {
      const s = this.sym(id)
      if (!s) continue
      if (!inFlow.has(id) && (score.get(id) ?? 0) < floor) continue
      const n = perFile.get(s.path) ?? 0
      if (n >= 6) continue
      perFile.set(s.path, n + 1)
      picked.push(s)
      if (picked.length >= 30) break
    }
    const pickedIds = new Set(picked.map((s) => s.id))

    let out = ''
    if (flowsKept.length) {
      out += '**Fluxo (caminho de chamadas entre os símbolos encontrados)**\n\n'
      for (const f of flowsKept.slice(0, 4)) {
        out += f.map((id, i) => { const s = this.sym(id); return `${i + 1}. ${s.qname} (${this.where(s)})` }).join('\n   ↓\n') + '\n\n'
      }
    }
    const fileOrder = [...new Set(picked.map((s) => s.path))].sort((a, b) => picked.filter((s) => s.path === b).reduce((t, s) => t + (score.get(s.id) ?? 0), 0) - picked.filter((s) => s.path === a).reduce((t, s) => t + (score.get(s.id) ?? 0), 0))
    out += `**Explorar: ${query}**\n\n${picked.length} símbolos em ${fileOrder.length} arquivos.\n\n`

    // quem depende (antes de editar)
    const blast = picked.filter((s) => ['function', 'method', 'class', 'interface', 'struct', 'trait'].includes(s.kind) && exactHits.has(s.id)).concat(picked.filter((s) => ['function', 'method', 'class'].includes(s.kind) && !exactHits.has(s.id))).slice(0, 6)
    if (blast.length) {
      out += '**Quem depende destes (confira antes de editar)**\n\n'
      for (const s of blast) {
        const ids = CLASSY.has(s.kind) ? [s.id, ...this.members(s).map((m) => m.id)] : [s.id]
        const callers = this.dedupeCallers(ids.flatMap((id) => this.incoming(id)))
        const files = [...new Set(callers.map((c) => c.s.path))].filter((p) => !isTest(p))
        const t = this.testsFor(ids)
        out += `- \`${s.qname}\` (${this.where(s)}) — ${callers.length} usos${files.length ? ` em ${files.slice(0, 3).map((p) => '`' + p + '`').join(', ')}${files.length > 3 ? ` +${files.length - 3}` : ''}` : ''}; testes: ${t.direct.length ? t.direct.slice(0, 3).map((p) => '`' + p + '`').join(', ') : t.via.length ? 'via chamadores ' + t.via.slice(0, 2).map((p) => '`' + p + '`').join(', ') : 'nenhum encontrado'}\n`
      }
      out += '\n'
    }

    // relações entre o que foi escolhido
    const rel = {}
    for (const s of picked) for (const e of this.outgoing(s.id)) {
      const d = this.sym(e.dst)
      if (!d || (!pickedIds.has(d.id) && e.kind === 'references')) continue
      ;(rel[e.kind] ??= []).push(`${s.name} → ${d.name}${pickedIds.has(d.id) ? '' : ` (${this.where(d)})`}`)
    }
    if (Object.keys(rel).length) {
      out += '**Relações**\n\n'
      for (const [k, list] of Object.entries(rel)) { const u = [...new Set(list)]; out += `${k}: ${u.slice(0, 12).join(' · ')}${u.length > 12 ? ` · … +${u.length - 12}` : ''}\n` }
      out += '\n'
    }

    if (detail === 'resumo') return out + this.exploreOutline(picked, fileOrder, score, { wantsTests, inFlow })

    // código atual do disco, agrupado por arquivo
    out += '**Código** (conteúdo atual do disco, com número de linha — trate como já lido; não precisa abrir estes trechos de novo)\n\n'
    let used = out.length
    let shownFiles = 0
    const skipped = []
    let testFiles = 0
    for (const p of fileOrder) {
      if (shownFiles >= maxFiles || used > budget) { skipped.push(p); continue }
      if (isTest(p) && !wantsTests && ++testFiles > 1) { skipped.push(p); continue }
      const L = this.lines(p)
      const syms = picked.filter((s) => s.path === p).sort((a, b) => a.line - b.line)
      const ranges = []
      for (const s of syms) {
        const hasPickedMembers = syms.some((m) => m.sha === s.sha && m.parent === s.idx)
        let a = s.line, b = s.end_line
        while (a > 1 && /^\s*(\/\/|\/\*|\*|#|@)/.test(L[a - 2] ?? '') && s.line - a < 10) a--
        if (CLASSY.has(s.kind) && (hasPickedMembers || b - a > 60)) b = Math.min(b, s.line + 4)
        else if (b - a > 90) b = a + 70
        ranges.push([a, b, s])
      }
      ranges.sort((x, y) => x[0] - y[0])
      const merged = []
      for (const r of ranges) { const last = merged.at(-1); if (last && r[0] <= last[1] + 3) last[1] = Math.max(last[1], r[1]); else merged.push([r[0], r[1]]) }
      const lang = p.slice(p.lastIndexOf('.') + 1)
      let block = `**\`${p}\`** — ${syms.map((s) => s.name).join(', ')}\n\n\`\`\`${lang}\n`
      merged.forEach(([a, b], i) => {
        if (i > 0) block += '\n… (trecho omitido) …\n\n'
        for (let k = a; k <= b; k++) block += `${k}\t${L[k - 1] ?? ''}\n`
      })
      block += '```\n\n'
      if (used + block.length > budget * 1.15 && shownFiles > 0) { skipped.push(p); continue }
      out += block
      used += block.length
      shownFiles++
    }
    if (skipped.length) out += `Também relevantes (sem código aqui, use codigo_no): ${skipped.slice(0, 10).join(', ')}\n`
    return out
  }
}
