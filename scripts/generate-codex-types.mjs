// Regenerates apps/desktop/src/main/generated/codex-app-server from the installed Codex CLI.
// The types describe the `codex app-server` protocol; run it again after updating Codex and check the diff before committing.
// Usage, from the repository root: node scripts/generate-codex-types.mjs
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
  if (!readdirSync(work).length) throw new Error('The Codex CLI generated no files.')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(work, target, { recursive: true })
  console.log(`Types generated with ${version} in ${target}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
