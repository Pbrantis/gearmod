import React, { useEffect, useRef, useState } from 'react'
import { terminal, useTerminal } from './terminalStore'
import { resolveRelative } from './editor/markdownPaths'
import { highlightCode, type Piece } from './editor/highlightCode'

/** Renderizador Markdown mínimo e seguro (sem HTML cru). Devolve só os blocos: quem chama põe dentro de um `.md`. Checklists no formato do protótipo (`ul.tasks > li.tk`). */
interface Item { indent: number; ordered: boolean; checked: boolean | null; text: string; line: number; children: Item[] }

const inlinePattern = /(!\[[^\]]*\]\([^)]*\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)]*\))/g

/** Quem estiver acima (o chat) recebe o clique em um arquivo citado e abre o visualizador; sem ele, a citação fica como texto. */
export const FileOpenContext = React.createContext<((path: string) => void) | null>(null)
const codeExtensions = /\.(md|mdx|txt|json|jsonc|ya?ml|toml|ini|env|csv|html?|css|scss|less|svg|[cm]?[jt]sx?|vue|svelte|py|rb|go|rs|java|kt|cs|php|sh|bat|ps1|sql|xml|lock|log|c|h|cpp|hpp)$/i
const withoutLine = (target: string): string => target.replace(/#L?\d+(-L?\d+)?$/, '').replace(/:\d+(:\d+)?$/, '')
/** Link de Markdown aponta para um arquivo local (não é URL, âncora nem e-mail). */
const shellLangs = /^(bash|sh|shell|zsh|powershell|pwsh|ps1|ps|cmd|bat|console|terminal)$/i

/** Bloco de código do chat; os de shell (ou sem linguagem) ganham ▶ para rodar no terminal do app, e todos ganham copiar. */
function CodeBlock({ code, lang, runnable: allowRun = true }: { code: string; lang: string; runnable?: boolean }): React.JSX.Element {
  const { context } = useTerminal(), [copied, setCopied] = useState(false), [pieces, setPieces] = useState<Piece[]>([]), [seen, setSeen] = useState(false), box = useRef<HTMLDivElement>(null)
  // Só colore o que chega perto da tela: uma conversa longa tem dezenas de blocos e a rolagem não pode travar.
  useEffect(() => { const element = box.current; if (!element || seen) return; if (typeof IntersectionObserver === 'undefined') { setSeen(true); return } const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setSeen(true); observer.disconnect() } }, { rootMargin: '300px' }); observer.observe(element); return () => observer.disconnect() }, [seen])
  useEffect(() => { if (!seen) return; let alive = true; void highlightCode(code, lang).then((result) => { if (alive) setPieces(result) }).catch(() => undefined); return () => { alive = false } }, [seen, code, lang])
  const runnable = allowRun && Boolean(context) && (!lang || shellLangs.test(lang)) && code.trim().length > 0 && code.length < 4000
  const command = code.split('\n').map((line) => line.replace(/^\s*(\$|PS [^>]*>|>)\s+/, '')).join('\n')
  const copy = (): void => { void navigator.clipboard.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400) }).catch(() => undefined) }
  return <div className="codeblock" ref={box}><pre><code>{pieces.length ? pieces.map((piece, index) => piece.cls ? <span key={index} className={piece.cls}>{piece.text}</span> : piece.text) : code}</code></pre>
    <div className="cb-tools">
      {runnable && <button type="button" className="cb-btn tip" data-tip="Executar no terminal" aria-label="Executar no terminal" onClick={() => void terminal.run(command)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l10 6-10 6z" /></svg></button>}
      <button type="button" className="cb-btn tip" data-tip={copied ? 'Copiado' : 'Copiar'} aria-label="Copiar" onClick={copy}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /></svg></button>
    </div></div>
}

/** De qual arquivo o Markdown veio: com isso as imagens de caminho relativo são carregadas do projeto (`workspace:image`). */
export interface MarkdownBaseInfo { projectId: string; cardId: string | null; path: string }
const MarkdownBase = React.createContext<MarkdownBaseInfo | null>(null)
const imageCache = new Map<string, Promise<string>>()

function MdImage({ alt, src }: { alt: string; src: string }): React.JSX.Element {
  const base = React.useContext(MarkdownBase), [url, setUrl] = useState(/^https:\/\//i.test(src) ? src : ''), [failed, setFailed] = useState(false)
  useEffect(() => {
    if (/^https:\/\//i.test(src)) { setUrl(src); return }
    if (!base || /^[a-z][a-z0-9+.-]*:/i.test(src.replace(/^[A-Za-z]:[\\/]/, ''))) { setUrl(''); return }
    const path = resolveRelative(base.path, src), key = `${base.projectId}|${base.cardId}|${path}`
    let alive = true
    const request = imageCache.get(key) ?? window.agentboard.invoke('workspace:image', { projectId: base.projectId, cardId: base.cardId, path })
    imageCache.set(key, request)
    void request.then((data) => { if (alive) setUrl(data) }).catch(() => { imageCache.delete(key); if (alive) setFailed(true) })
    return () => { alive = false }
  }, [src, base?.path, base?.projectId, base?.cardId])
  if (url && !failed) return <img className="mdimg" src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} />
  return <span className="mdLink" title={src}>{alt || src}</span>
}

function isFileLink(target: string): boolean {
  if (/\s/.test(target) || target.startsWith('#')) return false
  if (/^file:/i.test(target)) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) return false
  return /\.[A-Za-z0-9]{1,8}$|[\\/]/.test(withoutLine(target))
}
/** Trecho de código que parece um caminho de arquivo conhecido (ex.: `src/App.tsx`, `README.md:12`). */
const isFileCode = (text: string): boolean => /^[\w@.~/\\:-]+$/.test(text) && codeExtensions.test(withoutLine(text))

function FileRef({ target, children, code }: { target: string; children: React.ReactNode; code?: boolean }): React.JSX.Element {
  const open = React.useContext(FileOpenContext)
  const ok = open && (code ? isFileCode(target) : isFileLink(target))
  if (!ok && !code && /^(https?:\/\/|mailto:)/i.test(target)) return <a className="mdLink ext" href={target} title={target} onClick={(event) => { event.preventDefault(); event.stopPropagation(); void window.agentboard.invoke('app:open-link', { url: target }).catch(() => undefined) }}>{children}</a>
  if (!ok) return code ? <code>{children}</code> : <span className="mdLink" title={target}>{children}</span>
  return <button type="button" className={`mdFile ${code ? 'code' : ''}`} title={`Abrir ${target}`} onClick={() => open(target.replace(/^file:\/\/\/?/i, '').replace(/^\/([A-Za-z]:)/, '$1'))}>{children}</button>
}

function inline(text: string, key: string): React.ReactNode[] {
  return text.split(inlinePattern).filter((part) => part !== '').map((part, index) => {
    const k = `${key}-${index}`
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <FileRef key={k} target={part.slice(1, -1)} code>{part.slice(1, -1)}</FileRef>
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={k}>{inline(part.slice(2, -2), k)}</strong>
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return part.length > 2 ? <em key={k}>{inline(part.slice(1, -1), k)}</em> : part
    const image = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(part)
    if (image) return <MdImage key={k} alt={image[1]!} src={image[2]!.trim().replace(/\s+"[^"]*"$/, '')} />
    const link = /^\[([^\]]+)\]\(([^)]*)\)$/.exec(part)
    if (link) return <FileRef key={k} target={link[2]!}>{inline(link[1]!, k)}</FileRef>
    return part
  })
}

/** Uma linha de Markdown sem blocos (código, negrito, itálico, links), para títulos curtos como o de uma task. */
export function InlineMarkdown({ text }: { text: string }): React.JSX.Element { return <>{inline(text, 'il')}</> }

const listLine =/^(\s*)([-*+]|\d+\.)\s+(?:\[( |x|X)\]\s+)?(.*)$/
const isSpecial = (line: string): boolean => /^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s|---+\s*$)/.test(line) || /^\|.*\|\s*$/.test(line)

function renderItems(items: Item[], onToggle: ((line: number, checked: boolean) => void) | undefined, key: string): React.JSX.Element {
  if (items.some((item) => item.checked !== null)) {
    const flat: Array<{ item: Item; depth: number }> = []
    const walk = (list: Item[], depth: number): void => list.forEach((item) => { flat.push({ item, depth }); walk(item.children, depth + 1) })
    walk(items, 0)
    return <ul key={key} className="tasks">{flat.map(({ item, depth }) => <li key={`${key}-${item.line}`} className={`tk ${depth ? 'sub' : ''} ${item.checked ? 'done' : ''}`} data-ln={onToggle ? item.line : undefined} onClick={onToggle ? () => onToggle(item.line, !item.checked) : undefined}><span className={`tkb ${item.checked ? 'on' : ''}`}>{item.checked && <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.5-5" /></svg>}</span><span className="tkt">{inline(item.text, `${key}-${item.line}`)}</span></li>)}</ul>
  }
  const Tag = items[0]?.ordered ? 'ol' : 'ul'
  return <Tag key={key}>{items.map((item) => <li key={`${key}-${item.line}`}>{inline(item.text, `${key}-${item.line}`)}{item.children.length > 0 && renderItems(item.children, onToggle, `${key}-${item.line}c`)}</li>)}</Tag>
}

function buildTree(lines: Array<{ match: RegExpExecArray; line: number }>): Item[] {
  const root: Item[] = [], stack: Item[] = []
  for (const { match, line } of lines) {
    const item: Item = { indent: match[1]!.replace(/\t/g, '  ').length, ordered: /\d/.test(match[2]!), checked: match[3] === undefined ? null : match[3] !== ' ', text: match[4]!, line, children: [] }
    while (stack.length && stack[stack.length - 1]!.indent >= item.indent) stack.pop()
    ;(stack.length ? stack[stack.length - 1]!.children : root).push(item)
    stack.push(item)
  }
  return root
}

export function Markdown({ source, onToggle, base, runnable = true }: { source: string; onToggle?(line: number, checked: boolean): void; base?: MarkdownBaseInfo; runnable?: boolean }): React.JSX.Element {
  const inherited = React.useContext(MarkdownBase)
  // Aceita quebras do Windows (CRLF): o `\r` no fim da linha impedia de reconhecer títulos e listas.
  const lines = source.split(/\r?\n/), blocks: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i += 1; continue }
    // Comentário HTML (ex.: o relatório de versões que o Spec Kit põe no topo da constituição) não aparece.
    if (/^\s*<!--/.test(line)) { while (i < lines.length && !lines[i]!.includes('-->')) i += 1; i += 1; continue }
    const fence = /^(`{3,})\s*([\w-]*)/.exec(line)
    if (fence) {
      const start = i; const body: string[] = []; const size = fence[1]!.length; i += 1
      while (i < lines.length && !new RegExp(`^\`{${size},}\\s*$`).test(lines[i]!)) { body.push(lines[i]!); i += 1 }
      i += 1
      // Arquivo Markdown colado no chat: mostra renderizado, não como código.
      if (/^(md|markdown)$/i.test(fence[2]!)) blocks.push(<div key={`b${start}`} className="mdfile"><Markdown source={body.join('\n')} runnable={runnable} /></div>)
      else blocks.push(<CodeBlock key={`b${start}`} code={body.join('\n')} lang={fence[2]!} runnable={runnable} />)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) { const Tag = `h${Math.min(3, heading[1]!.length)}` as 'h1'; blocks.push(<Tag key={`b${i}`} data-line={i}>{inline(heading[2]!, `b${i}`)}</Tag>); i += 1; continue }
    if (/^---+\s*$/.test(line)) { blocks.push(<hr key={`b${i}`} />); i += 1; continue }
    if (/^>\s?/.test(line)) {
      const start = i; const body: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) { body.push(lines[i]!.replace(/^>\s?/, '')); i += 1 }
      blocks.push(<blockquote key={`b${start}`}>{inline(body.join(' '), `b${start}`)}</blockquote>); continue
    }
    if (listLine.test(line)) {
      const start = i; const collected: Array<{ match: RegExpExecArray; line: number }> = []
      while (i < lines.length) {
        const match = listLine.exec(lines[i]!)
        // Linha recuada logo depois de um item é a continuação do texto dele, não um parágrafo novo.
        if (!match && /^\s+\S/.test(lines[i]!) && collected.length) { const last = collected[collected.length - 1]!.match; last[4] = `${last[4]} ${lines[i]!.trim()}`; i += 1; continue }
        if (!match) break
        collected.push({ match, line: i }); i += 1
      }
      blocks.push(renderItems(buildTree(collected), onToggle, `b${start}`)); continue
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      const start = i; const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
      const head = cells(line); i += 2; const rows: string[][] = []
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) { rows.push(cells(lines[i]!)); i += 1 }
      blocks.push(<table key={`b${start}`}><thead><tr>{head.map((cell, c) => <th key={c}>{inline(cell, `h${start}${c}`)}</th>)}</tr></thead><tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{inline(cell, `t${start}${r}${c}`)}</td>)}</tr>)}</tbody></table>); continue
    }
    const start = i; const body: string[] = []
    while (i < lines.length && lines[i]!.trim() && (i === start || !isSpecial(lines[i]!))) { body.push(lines[i]!.trim()); i += 1 }
    blocks.push(<p key={`b${start}`}>{inline(body.join(' '), `b${start}`)}</p>)
  }
  return <MarkdownBase.Provider value={base ?? inherited}>{blocks.length ? blocks : <p className="mdEmpty">Nada escrito ainda.</p>}</MarkdownBase.Provider>
}
