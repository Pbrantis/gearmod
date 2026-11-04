// Indexes another project (read-only) and shows numbers and a few examples per language.
import { CodeIndex } from './graph/index.mjs'

const root = process.argv[2]
const ci = new CodeIndex(process.env.GRAPH_DB ?? 'other.sqlite')
const r = await ci.index(root)
console.log(r)
const db = ci.db
console.log(db.prepare('select t.lang, count(distinct t.path) files, count(s.id) syms from trees t join symbols s on s.sha = t.sha and s.idx > 0 where t.root = ? group by t.lang').all(root))
console.log(db.prepare(`select e.kind, count(*) n, round(avg(e.conf),2) conf from edges e where e.root = ? group by e.kind`).all(root))
// per language: % of calls (call/new) that became an edge
const rows = db.prepare(`select t.lang, count(*) total, sum(case when exists (select 1 from symbols s join edges e on e.src = s.id and e.root = t.root join symbols d on d.id = e.dst where s.sha = r.sha and s.idx = r.src and d.name = r.name) then 1 else 0 end) linked from refs r join trees t on t.sha = r.sha and t.root = ? where r.kind in ('call','new') group by t.lang`).all(root)
console.log('chamadas ligadas por linguagem', rows.map((x) => `${x.lang} ${x.linked}/${x.total} (${Math.round((x.linked / x.total) * 100)}%)`))
// examples of a language (LANG, default python)
const py = db.prepare(`select s.qname, t.path, s.line from symbols s join trees t on t.sha = s.sha and t.root = ? where t.lang = ? and s.kind in ('class','method') and (select count(*) from edges e where e.root = t.root and e.dst = s.id) > 2 order by random() limit 3`).all(root, process.env.LANG_SAMPLE ?? 'python')
for (const p of py) console.log('\n' + ci.q(root).node({ symbol: p.qname }).split('\n').slice(0, 14).join('\n'))
console.log('rss MB', Math.round(process.memoryUsage().rss / 1e6))
ci.close()
