import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { highConfidenceSecretPatterns } from './redaction'

export interface SecretHit { path: string; line: number }

const maxBytes = 1_000_000

/**
 * Looks for real keys and passwords in the files the agent wants to commit (S13). Only unmistakable formats (provider API key,
 * private key, JWT, password in a connection URL): a line `API_KEY=your-value` in a `.env.example` does not count. Never returns the value.
 */
export async function scanForSecrets(dir: string, paths: string[]): Promise<SecretHit[]> {
  const hits: SecretHit[] = []
  for (const path of paths) {
    const file = join(dir, path)
    let text: string
    try { if ((await stat(file)).size > maxBytes) continue; text = await readFile(file, 'utf8') } catch { continue }
    if (text.includes('\0')) continue
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      if (highConfidenceSecretPatterns.some((pattern) => { pattern.lastIndex = 0; return pattern.test(lines[index]!) })) { hits.push({ path, line: index + 1 }); break }
    }
  }
  return hits
}
