import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const has = (dir: string, name: string): boolean => existsSync(join(dir, name))
const read = (dir: string, name: string): string => { try { return readFileSync(join(dir, name), 'utf8') } catch { return '' } }

/**
 * Suggests the test command for a project folder by looking at its marker files. Returns '' when nothing is recognized.
 * It only suggests: the user confirms it before it runs (the command is executed without a shell, as executable + args).
 */
export function detectTestCommand(dir: string): string {
  const pkg = read(dir, 'package.json')
  if (pkg) {
    let script = ''
    try { script = String((JSON.parse(pkg) as { scripts?: Record<string, unknown> }).scripts?.test ?? '') } catch { /* invalid package.json: ignores */ }
    // The default `npm init` placeholder is not a real test.
    if (script && !/no test specified/i.test(script)) {
      if (has(dir, 'pnpm-lock.yaml')) return 'pnpm test'
      if (has(dir, 'yarn.lock')) return 'yarn test'
      if (has(dir, 'bun.lockb') || has(dir, 'bun.lock')) return 'bun test'
      return 'npm test'
    }
  }
  if (has(dir, 'manage.py')) return 'python manage.py test'
  const python = `${read(dir, 'pyproject.toml')}\n${read(dir, 'tox.ini')}\n${read(dir, 'setup.cfg')}`
  if (has(dir, 'pytest.ini') || has(dir, 'conftest.py') || /pytest/i.test(python)) return 'python -m pytest'
  if (has(dir, 'Cargo.toml')) return 'cargo test'
  if (has(dir, 'go.mod')) return 'go test ./...'
  if (has(dir, 'gradlew.bat') || has(dir, 'gradlew')) return process.platform === 'win32' ? 'gradlew.bat test' : './gradlew test'
  if (has(dir, 'pom.xml')) return 'mvn test'
  if (has(dir, 'Makefile') && /^test\s*:/m.test(read(dir, 'Makefile'))) return 'make test'
  return ''
}
