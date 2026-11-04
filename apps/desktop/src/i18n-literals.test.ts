import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Lock (I5): Portuguese text written directly in the code, outside the `i18n/` dictionaries, can only shrink.
 * A new file, or a file with more strings than the baseline, fails. New screen text goes in the dictionary (`useT`, `tr`, `tm`).
 * When you translate strings in a file, run `UPDATE_I18N_BASELINE=1 vitest run src/i18n-literals.test.ts` to lower the baseline.
 */
const accents = /[áàâãéêíóôõúçÁÉÍÓÚÇ]/
const literal = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return ['i18n', 'generated', 'node_modules'].includes(entry.name) ? [] : sources(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function count(path: string): number {
  let total = 0, inBlock = false
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const text = line.trim()
    if (inBlock) { if (text.includes('*/')) inBlock = false; continue }
    if (text.startsWith('/*')) { if (!text.includes('*/')) inBlock = true; continue }
    if (text.startsWith('//') || text.startsWith('*')) continue
    const code = line.replace(/\s\/\/ .*$/, '')
    for (const match of code.matchAll(literal)) if (accents.test(match[0])) total += 1
  }
  return total
}

describe('Portuguese text outside the dictionaries', () => {
  it('does not grow beyond the baseline', () => {
    const root = __dirname, found: Record<string, number> = {}
    for (const path of sources(root)) { const n = count(path); if (n) found[relative(root, path).split('\\').join('/')] = n }
    if (process.env.UPDATE_I18N_BASELINE) {
      writeFileSync(join(root, 'i18n-literals.baseline.json'), `${JSON.stringify(found, null, 2)}\n`)
      return
    }
    const baseline = JSON.parse(readFileSync(join(root, 'i18n-literals.baseline.json'), 'utf8')) as Record<string, number>
    const worse = Object.entries(found).filter(([file, n]) => n > (baseline[file] ?? 0)).map(([file, n]) => `${file}: ${n} (linha de base ${baseline[file] ?? 0})`)
    expect(worse, 'Texto novo em português fora do i18n. Use o dicionário (useT/tr/tm).').toEqual([])
  })
})
