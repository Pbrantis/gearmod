// Gera apps/desktop/src/main/code-index/queries.ts a partir das consultas do protótipo (evita erro de cópia).
import { writeFileSync } from 'node:fs'
import { LANGUAGES } from './graph/langs.mjs'

const out = [
  '// Gerado a partir de spike/graph/langs.mjs (spike/gen-queries.mjs). Consultas tree-sitter por linguagem;',
  '// a convenção das capturas está em languages.ts.',
  '',
  'export const QUERIES: Record<string, string> = {'
]
for (const [lang, cfg] of Object.entries(LANGUAGES)) out.push(`  ${JSON.stringify(lang)}: ${JSON.stringify(cfg.queries)},`)
out.push('}', '')
writeFileSync(new URL('../apps/desktop/src/main/code-index/queries.ts', import.meta.url), out.join('\n'))
console.log('ok', Object.keys(LANGUAGES).length, 'linguagens')
