// Regenera apps/desktop/src/main/generated/codex-app-server a partir da CLI do Codex instalada.
// Os tipos descrevem o protocolo `codex app-server`; rode de novo quando atualizar o Codex e confira o diff antes de commitar.
// Uso, na raiz do repositório: node scripts/generate-codex-types.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, cpSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const target = resolve(import.meta.dirname, '..', 'apps', 'desktop', 'src', 'main', 'generated', 'codex-app-server')
const codex = process.env.CODEX_BIN || 'codex'
const shell = process.platform === 'win32'

const version = execFileSync(codex, ['--version'], { encoding: 'utf8', shell }).trim()
const work = mkdtempSync(join(tmpdir(), 'gearmod-codex-ts-'))
try {
  execFileSync(codex, ['app-server', 'generate-ts', '--out', work], { stdio: 'inherit', shell })
  if (!readdirSync(work).length) throw new Error('A CLI do Codex não gerou nenhum arquivo.')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(work, target, { recursive: true })
  console.log(`Tipos gerados com ${version} em ${target}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
