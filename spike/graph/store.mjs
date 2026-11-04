// Index database. Everything from parsing is stored per blob (Git sha), so worktrees that share
// files share the analysis. Only `trees`, `edges` and `file_edges` are per folder (root).
import { createRequire } from 'node:module'
import { EXTRACTOR_VERSION } from './extract.mjs'

const require = createRequire(import.meta.url)

export function openStore(file) {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(file)
  db.exec(`
    pragma busy_timeout = 10000; pragma journal_mode = wal; pragma synchronous = normal; pragma temp_store = memory; pragma cache_size = -32000;
    create table if not exists meta(key text primary key, value text);
    create table if not exists blobs(sha text primary key, lang text, lines int, default_export text);
    create table if not exists symbols(id integer primary key, sha text, idx int, name text, qname text, kind text, parent int, line int, end_line int, signature text, doc text, exported int, owner text);
    create unique index if not exists symbols_sha_idx on symbols(sha, idx);
    create index if not exists symbols_name on symbols(name);
    create table if not exists refs(sha text, src int, name text, receiver text, kind text, line int);
    create index if not exists refs_sha on refs(sha);
    create index if not exists refs_name on refs(name);
    create table if not exists imports(sha text, spec text, local text, imported text, reexport int, line int);
    create index if not exists imports_sha on imports(sha);
    create table if not exists binds(sha text, scope int, name text, type text, kind text);
    create index if not exists binds_sha on binds(sha);
    create table if not exists heritage(sha text, owner int, owner_name text, kind text, target text);
    create index if not exists heritage_sha on heritage(sha);
    create table if not exists trees(root text, path text, sha text, lang text, primary key(root, path));
    create index if not exists trees_sha on trees(root, sha);
    create table if not exists roots(root text primary key, indexed_at int, manifests text, files int, ms int);
    create table if not exists edges(root text, src int, dst int, kind text, line int, n int, conf real, lines text);
    create index if not exists edges_src on edges(root, src);
    create index if not exists edges_dst on edges(root, dst);
    create table if not exists file_edges(root text, src text, dst text, weight int);
    create index if not exists file_edges_src on file_edges(root, src);
    create index if not exists file_edges_dst on file_edges(root, dst);
    create virtual table if not exists symbols_fts using fts5(words, signature, doc, content='', contentless_delete=1, tokenize="unicode61 remove_diacritics 2");
  `)
  // old databases: column with all the call lines
  if (!db.prepare('pragma table_info(edges)').all().some((c) => c.name === 'lines')) db.exec('alter table edges add column lines text')
  const v = db.prepare(`select value from meta where key = 'extractor'`).get()?.value
  if (v !== String(EXTRACTOR_VERSION)) {
    // extractor changed: the old analysis is no longer valid
    db.exec(`delete from blobs; delete from symbols; delete from refs; delete from imports; delete from binds; delete from heritage; delete from edges; delete from file_edges; delete from symbols_fts; delete from trees; delete from roots;`)
    db.prepare(`insert or replace into meta(key, value) values ('extractor', ?)`).run(String(EXTRACTOR_VERSION))
  }
  return db
}

// "recordExploration" -> "recordExploration record exploration"; "file_viewer.ts" -> "file viewer"
export function words(...parts) {
  const out = new Set()
  for (const p of parts) {
    if (!p) continue
    for (const raw of p.split(/[^\p{L}\p{N}_$]+/u)) {
      if (!raw) continue
      out.add(raw)
      for (const w of raw.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s_$]+/)) if (w.length > 1) out.add(w.toLowerCase())
    }
  }
  return [...out].join(' ')
}

export function writer(db) {
  const st = {
    blob: db.prepare('insert or ignore into blobs(sha, lang, lines, default_export) values (?,?,?,?)'),
    sym: db.prepare('insert into symbols(sha, idx, name, qname, kind, parent, line, end_line, signature, doc, exported, owner) values (?,?,?,?,?,?,?,?,?,?,?,?)'),
    fts: db.prepare('insert into symbols_fts(rowid, words, signature, doc) values (?,?,?,?)'),
    ref: db.prepare('insert into refs(sha, src, name, receiver, kind, line) values (?,?,?,?,?,?)'),
    imp: db.prepare('insert into imports(sha, spec, local, imported, reexport, line) values (?,?,?,?,?,?)'),
    bind: db.prepare('insert into binds(sha, scope, name, type, kind) values (?,?,?,?,?)'),
    her: db.prepare('insert into heritage(sha, owner, owner_name, kind, target) values (?,?,?,?,?)')
  }
  return (sha, lang, x) => {
    st.blob.run(sha, lang, x.lines, x.defaultExport)
    x.symbols.forEach((s, idx) => {
      const r = st.sym.run(sha, idx, s.name, s.qname, s.kind, s.parent, s.line, s.end, s.signature, s.doc, s.exported, s.owner ?? null)
      if (idx > 0) st.fts.run(r.lastInsertRowid, words(s.name, s.qname), s.signature, s.doc ?? '')
    })
    for (const r of x.refs) st.ref.run(sha, r.src, r.name, r.receiver, r.kind, r.line)
    for (const i of x.imports) st.imp.run(sha, i.spec, i.local ?? null, i.imported ?? null, i.reexport ? 1 : 0, i.line)
    for (const b of x.binds) st.bind.run(sha, b.scope, b.name, b.type, b.kind)
    for (const h of x.heritage) st.her.run(sha, h.owner, h.ownerName, h.kind, h.target)
  }
}

// Deletes the analysis of blobs that no folder uses anymore.
export function gc(db) {
  const dead = db.prepare('select sha from blobs where sha not in (select distinct sha from trees)').all().map((r) => r.sha)
  if (!dead.length) return 0
  db.exec('begin')
  const ids = db.prepare('select id from symbols where sha = ?')
  const delFts = db.prepare('delete from symbols_fts where rowid = ?')
  for (const sha of dead) {
    for (const { id } of ids.all(sha)) delFts.run(id)
    for (const t of ['symbols', 'refs', 'imports', 'binds', 'heritage', 'blobs']) db.prepare(`delete from ${t} where sha = ?`).run(sha)
  }
  db.exec('commit')
  return dead.length
}
