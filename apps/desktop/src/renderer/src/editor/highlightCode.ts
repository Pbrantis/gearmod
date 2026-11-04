import { Language, LanguageSupport } from '@codemirror/language'
import { highlightTree } from '@lezer/highlight'
import { languageFor } from './languages'
import { codeHighlightStyle } from './theme'

export interface Piece { text: string; cls: string }
const maxChars = 20_000
const extensions: Record<string, string> = {
  ts: 'ts', typescript: 'ts', tsx: 'tsx', js: 'js', javascript: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js', json: 'json', jsonc: 'jsonc', css: 'css', scss: 'scss', html: 'html', xml: 'xml',
  md: 'md', markdown: 'md', py: 'py', python: 'py', sql: 'sql', yaml: 'yaml', yml: 'yml', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', powershell: 'ps1', pwsh: 'ps1', ps1: 'ps1',
  toml: 'toml', ini: 'ini', go: 'go', rust: 'rs', rs: 'rs', java: 'java', cs: 'cs', csharp: 'cs', cpp: 'cpp', c: 'h'
}
/** File extension equivalent to the language name of a fenced block (` ```ts `); `null` if we do not know it. */
export const extensionForFence = (lang: string): string | null => extensions[lang.trim().toLowerCase()] ?? null

const diffClass = (line: string): string => line.startsWith('+') && !line.startsWith('+++') ? 'cb-add' : line.startsWith('-') && !line.startsWith('---') ? 'cb-del' : line.startsWith('@@') ? 'cb-hunk' : ''

/** Pieces of the block with each one's `tok-*` class (the same colors as the editor); `[]` when there is nothing to color. A `diff` block is colored per line. */
export async function highlightCode(code: string, lang: string): Promise<Piece[]> {
  if (!code || code.length > maxChars) return []
  if (lang.trim().toLowerCase() === 'diff' || lang.trim().toLowerCase() === 'patch') return code.split('\n').flatMap((line, index, all): Piece[] => [{ text: index < all.length - 1 ? `${line}\n` : line, cls: diffClass(line) }])
  const extension = extensionForFence(lang)
  if (!extension) return []
  const loaded = await languageFor(`bloco.${extension}`)
  const language = loaded instanceof LanguageSupport ? loaded.language : loaded instanceof Language ? loaded : null
  if (!language) return []
  const pieces: Piece[] = []
  let at = 0
  highlightTree(language.parser.parse(code), codeHighlightStyle, (from, to, cls) => { if (from > at) pieces.push({ text: code.slice(at, from), cls: '' }); pieces.push({ text: code.slice(from, to), cls }); at = to })
  if (at < code.length) pieces.push({ text: code.slice(at), cls: '' })
  return pieces
}
