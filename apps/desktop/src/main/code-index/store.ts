import Database from 'better-sqlite3'
import { EXTRACTOR_VERSION, type Extraction } from './extract'

export type Db = Database.Database

/**
 * Banco do índice. Tudo que vem do parse é guardado por blob (sha do Git), então worktrees que compartilham arquivos
 * compartilham a análise. Só `trees`, `edges`, `file_edges` e `roots` são por pasta (root).
 */
export function openStore(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 10000')
  db.pragma('temp_store = MEMORY')
  db.exec(`
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
  const version = db.prepare(`select value from meta where key = 'extractor'`).pluck().get() as string | undefined
  if (version !== String(EXTRACTOR_VERSION)) {
    // a extração mudou: a análise antiga não serve mais
    db.exec('delete from blobs; delete from symbols; delete from refs; delete from imports; delete from binds; delete from heritage; delete from edges; delete from file_edges; delete from symbols_fts; delete from trees; delete from roots;')
    db.prepare(`insert or replace into meta(key, value) values ('extractor', ?)`).run(String(EXTRACTOR_VERSION))
  }
  return db
}

/** "recordExploration" vira "recordExploration record exploration", para a busca achar pelas partes do nome. */
export function words(...parts: Array<string | null | undefined>): string {
  const out = new Set<string>()
  for (const part of parts) {
    if (!part) continue
    for (const raw of part.split(/[^\p{L}\p{N}_$]+/u)) {
      if (!raw) continue
      out.add(raw)
      for (const word of raw.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s_$]+/)) if (word.length > 1) out.add(word.toLowerCase())
    }
  }
  return [...out].join(' ')
}

export function writer(db: Db): (sha: string, lang: string, extraction: Extraction) => void {
  const blob = db.prepare('insert or ignore into blobs(sha, lang, lines, default_export) values (?,?,?,?)')
  const symbol = db.prepare('insert into symbols(sha, idx, name, qname, kind, parent, line, end_line, signature, doc, exported, owner) values (?,?,?,?,?,?,?,?,?,?,?,?)')
  const fts = db.prepare('insert into symbols_fts(rowid, words, signature, doc) values (?,?,?,?)')
  const ref = db.prepare('insert into refs(sha, src, name, receiver, kind, line) values (?,?,?,?,?,?)')
  const imp = db.prepare('insert into imports(sha, spec, local, imported, reexport, line) values (?,?,?,?,?,?)')
  const bind = db.prepare('insert into binds(sha, scope, name, type, kind) values (?,?,?,?,?)')
  const heritage = db.prepare('insert into heritage(sha, owner, owner_name, kind, target) values (?,?,?,?,?)')
  return (sha, lang, x) => {
    blob.run(sha, lang, x.lines, x.defaultExport)
    x.symbols.forEach((s, idx) => {
      const row = symbol.run(sha, idx, s.name, s.qname, s.kind, s.parent, s.line, s.end, s.signature, s.doc, s.exported ? 1 : 0, s.owner)
      if (idx > 0) fts.run(row.lastInsertRowid, words(s.name, s.qname), s.signature, s.doc ?? '')
    })
    for (const r of x.refs) ref.run(sha, r.src, r.name, r.receiver, r.kind, r.line)
    for (const i of x.imports) imp.run(sha, i.spec, i.local, i.imported, i.reexport ? 1 : 0, i.line)
    for (const b of x.binds) bind.run(sha, b.scope, b.name, b.type, b.kind)
    for (const h of x.heritage) heritage.run(sha, h.owner, h.ownerName, h.kind, h.target)
  }
}

/** Apaga a análise dos blobs que nenhuma pasta usa mais. */
export function gc(db: Db): number {
  const dead = db.prepare('select sha from blobs where sha not in (select distinct sha from trees)').pluck().all() as string[]
  if (!dead.length) return 0
  const ids = db.prepare('select id from symbols where sha = ?').pluck()
  const ftsDelete = db.prepare('delete from symbols_fts where rowid = ?')
  const deletes = ['symbols', 'refs', 'imports', 'binds', 'heritage', 'blobs'].map((table) => db.prepare(`delete from ${table} where sha = ?`))
  db.transaction(() => {
    for (const sha of dead) {
      for (const id of ids.all(sha) as number[]) ftsDelete.run(id)
      for (const statement of deletes) statement.run(sha)
    }
  })()
  return dead.length
}
