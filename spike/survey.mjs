// Conta arquivos por linguagem suportada em cada pasta (só lê nomes).
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from './graph/indexer.mjs'
import { langOf } from './graph/langs.mjs'

const base = process.argv[2]
for (const d of readdirSync(base, { withFileTypes: true })) {
  if (!d.isDirectory() || ['node_modules', 'agent-task-manager'].includes(d.name)) continue
  const t = Date.now()
  const { files } = listFiles(join(base, d.name))
  const c = {}
  for (const p of files.keys()) { const l = langOf(p); c[l] = (c[l] ?? 0) + 1 }
  console.log(d.name.padEnd(18), String(files.size).padStart(6), JSON.stringify(c), `${Date.now() - t}ms`)
}
