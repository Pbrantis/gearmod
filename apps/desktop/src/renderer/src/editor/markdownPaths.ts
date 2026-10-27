const parts = (path: string): string[] => path.replace(/\\/g, '/').split('/')
const normalize = (segments: string[]): string[] => { const out: string[] = []; for (const part of segments) { if (part === '.' || part === '') { if (out.length === 0 && part === '') out.push(''); continue } if (part === '..' && out.length > 0 && out.at(-1) !== '..' && out.at(-1) !== '') out.pop(); else out.push(part) } return out }
const isAbsolute = (path: string): boolean => /^[A-Za-z]:[\\/]/.test(path) || /^[\\/](?![\\/])/.test(path)

/** Endereço de uma imagem de Markdown em relação à pasta do `.md` (`../img/a.png` a partir de `docs/x/y.md` → `docs/img/a.png`); absoluto fica como está. */
export function resolveRelative(markdownPath: string, target: string): string {
  let clean = target.trim().replace(/^<|>$/g, '').replace(/[?#].*$/, '')
  try { clean = decodeURI(clean) } catch { /* mantém como veio */ }
  if (isAbsolute(clean)) return normalize(parts(clean)).join('/')
  const folder = parts(markdownPath).slice(0, -1)
  return normalize([...folder, ...parts(clean)]).join('/')
}

/** Caminho de `target` visto da pasta do `.md`, com `/` e espaços codificados; `null` se não dá para relacionar (discos diferentes). */
export function relativeLink(markdownPath: string, target: string): string | null {
  const from = normalize(parts(markdownPath).slice(0, -1)), to = normalize(parts(target))
  if (from[0]?.toLowerCase() !== to[0]?.toLowerCase()) return null
  let shared = 0
  while (shared < from.length && shared < to.length - 1 && from[shared]!.toLowerCase() === to[shared]!.toLowerCase()) shared++
  const link = [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/')
  return link.replace(/ /g, '%20')
}
