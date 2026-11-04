// Generates apps/desktop/src/main/code-index/queries.ts from the prototype's queries (avoids copy errors).
import { writeFileSync } from 'node:fs'
import { LANGUAGES } from './graph/langs.mjs'

const out = [
  '// Generated from spike/graph/langs.mjs (spike/gen-queries.mjs). Tree-sitter queries per language;',
  '// the capture convention is in languages.ts.',
  '',
  'export const QUERIES: Record<string, string> = {'
]
for (const [lang, cfg] of Object.entries(LANGUAGES)) out.push(`  ${JSON.stringify(lang)}: ${JSON.stringify(cfg.queries)},`)
out.push('}', '')
writeFileSync(new URL('../apps/desktop/src/main/code-index/queries.ts', import.meta.url), out.join('\n'))
console.log('ok', Object.keys(LANGUAGES).length, 'linguagens')
