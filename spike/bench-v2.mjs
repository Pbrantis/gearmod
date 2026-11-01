// Números finais do protótipo v2: indexação do zero, sem mudanças, outra worktree, consultas e tamanho das respostas.
import { CodeIndex } from './graph/index.mjs'
import { rmSync, existsSync, statSync } from 'node:fs'

const [root, other] = process.argv.slice(2)
const file = 'bench-v2.sqlite'
for (const f of [file, file + '-wal', file + '-shm']) if (existsSync(f)) rmSync(f)
const ci = new CodeIndex(file)
const t = async (label, fn) => { const t0 = performance.now(); const r = await fn(); console.log(label.padEnd(34), `${Math.round(performance.now() - t0)} ms`, typeof r === 'string' ? `${r.length} chars ≈ ${Math.round(r.length / 4)} tokens` : JSON.stringify(r)); return r }
await t('indexar do zero', () => ci.index(root, { exclude: ['spike'] }))
await t('indexar de novo (nada mudou)', () => ci.index(root, { exclude: ['spike'] }))
if (other) await t('outra worktree (pasta principal)', () => ci.index(other, { exclude: ['spike'] }))
ci.db.exec('pragma wal_checkpoint(truncate)')
console.log('banco'.padEnd(34), (statSync(file).size / 1e6).toFixed(1), 'MB')
const q = ci.q(root)
await t('explorar (nomes citados)', () => q.explore('como a exploracao de codigo do card fica desatualizada codeVersions recordExploration historySection'))
await t('explorar (pergunta vaga pt-BR)', () => q.explore('como o renderer le um arquivo do projeto e valida o caminho permitido'))
await t('no allowedPath', () => q.node({ symbol: 'allowedPath', includeCode: true }))
await t('impacto allowedPath', () => q.impact('allowedPath'))
await t('buscar "caminho permitido"', () => q.search('caminho permitido'))
await t('mapa 1500 tokens', () => q.map({ tokens: 1500 }))
await t('testes afetados (history.ts)', () => q.affected({ files: ['apps/desktop/src/main/history.ts'] }))
console.log('memória'.padEnd(34), Math.round(process.memoryUsage().rss / 1e6), 'MB')
ci.close()
