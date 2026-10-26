import React from 'react'
export function fileKind(path: string): string {
  if (/\.(png|jpe?g|webp|gif|svg|bmp|ico)$/i.test(path)) return 'image'
  if (/\.html?$/i.test(path)) return 'html'
  if (/\.(md|markdown|mdx)$/i.test(path)) return 'markdown'
  if (/\.(mp4|webm|mov)$/i.test(path)) return 'video'
  if (/\.(mp3|wav|ogg|m4a)$/i.test(path)) return 'audio'
  if (/\.(zip|gz|tar|7z|rar)$/i.test(path)) return 'archive'
  if (/\.(json|jsonc|ya?ml|toml|ini|conf|env|lock)$/i.test(path) || /[\\/]\.env/.test(path)) return 'config'
  if (/\.(m?[jt]sx?|cjs|css|scss|less|py|sh|ps1|sql|go|rs|java|cs|cpp|h|xml)$/i.test(path)) return 'code'
  return 'file'
}
export function FileTypeIcon({ path, directory = false }: { path: string; directory?: boolean }): React.JSX.Element {
  const kind = directory ? 'folder' : fileKind(path)
  return <svg className={`filetype ${kind}`} viewBox="0 0 20 20" aria-hidden="true">{kind === 'folder' ? <path d="M2.5 5h5l2 2h8v9h-15z" /> : kind === 'image' ? <><rect x="3" y="3" width="14" height="14" rx="2" /><circle cx="7" cy="7" r="1.5" /><path d="m4 15 4-4 3 2 3-5 3 6" /></> : kind === 'html' ? <><circle cx="10" cy="10" r="7" /><ellipse cx="10" cy="10" rx="3" ry="7" /><path d="M3 10h14" /></> : kind === 'code' || kind === 'config' ? <><path d="m7 5-5 5 5 5m6-10 5 5-5 5" />{kind === 'config' && <path d="m11 3-2 14" />}</> : kind === 'video' ? <><rect x="2" y="4" width="12" height="12" rx="2" /><path d="m14 8 4-3v10l-4-3" /></> : kind === 'audio' ? <><path d="M8 14V4l8-2v10M8 6l8-2" /><circle cx="5.5" cy="14.5" r="2.5" /><circle cx="13.5" cy="12.5" r="2.5" /></> : <><path d="M5 2h7l4 4v12H5zM12 2v5h4" />{kind === 'markdown' && <path d="M7 14v-4l2 2 2-2v4m2-4v4" />}{kind === 'archive' && <path d="M10 8v7m-1-5h2m-2 3h2" />}</>}</svg>
}

export interface SourceToken { text: string; kind: string }
/** Tokenização local para colorir o texto sem interpretar nem executar o arquivo. */
export function sourceTokens(content: string, path: string): SourceToken[] {
  const kind = fileKind(path)
  if (!['code', 'config', 'html'].includes(kind)) return [{ text: content, kind: '' }]
  const hashComments = /\.(py|sh|ps1|ya?ml|toml|conf|ini|env)$/i.test(path) || /[\\/]\.env/.test(path)
  const pattern = /<!--[^]*?-->|\/\*[^]*?\*\/|\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|<\/?[\w:-]+|\/?>|\b(?:0x[\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|[\w$-]+|[^]/gi
  const keywords = new Set('const let var function return if else for while do class new import export from default async await try catch throw finally switch case break continue public private static interface type extends implements def self elif except with lambda pass and or not in is select where insert update delete table as null true false undefined None True False this super typeof instanceof void yield'.split(' '))
  let previous = ''
  return [...content.matchAll(pattern)].map((match) => {
    const text = match[0]
    let token = ''
    if (/^(\/\/|\/\*|<!--)/.test(text) || (hashComments && text.startsWith('#'))) token = 'comment'
    else if (/^["'`]/.test(text)) token = kind === 'config' && /^\s*:/.test(content.slice(match.index + text.length)) ? 'property' : 'string'
    else if (/^<\/?[\w:-]+|^\/?>$/.test(text) && kind === 'html') token = 'tag'
    else if (/^\d/.test(text)) token = 'number'
    else if (keywords.has(text)) token = 'keyword'
    else if (/^[\w$-]+$/.test(text) && /^\s*[:=]/.test(content.slice(match.index + text.length))) token = 'property'
    else if (/^[\w$-]+$/.test(text) && /^\s*\(/.test(content.slice(match.index + text.length))) token = 'function'
    else if (previous === '.' && /^[\w$-]+$/.test(text)) token = 'property'
    if (text.trim()) previous = text
    return { text, kind: token }
  })
}
