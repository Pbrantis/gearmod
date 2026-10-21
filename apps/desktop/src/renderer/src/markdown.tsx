import React from 'react'

/** Renderizador Markdown mínimo e seguro (sem HTML cru). Devolve só os blocos: quem chama põe dentro de um `.md`. Checklists no formato do protótipo (`ul.tasks > li.tk`). */
interface Item { indent: number; ordered: boolean; checked: boolean | null; text: string; line: number; children: Item[] }

const inlinePattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)]*\))/g

function inline(text: string, key: string): React.ReactNode[] {
  return text.split(inlinePattern).filter((part) => part !== '').map((part, index) => {
    const k = `${key}-${index}`
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={k}>{part.slice(1, -1)}</code>
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) return <strong key={k}>{inline(part.slice(2, -2), k)}</strong>
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) return part.length > 2 ? <em key={k}>{inline(part.slice(1, -1), k)}</em> : part
    const link = /^\[([^\]]+)\]\(([^)]*)\)$/.exec(part)
    if (link) return <span className="mdLink" key={k} title={link[2]}>{link[1]}</span>
    return part
  })
}

const listLine = /^(\s*)([-*+]|\d+\.)\s+(?:\[( |x|X)\]\s+)?(.*)$/
const isSpecial = (line: string): boolean => /^(#{1,6}\s|```|>\s?|\s*([-*+]|\d+\.)\s|---+\s*$)/.test(line) || /^\|.*\|\s*$/.test(line)

function renderItems(items: Item[], onToggle: ((line: number, checked: boolean) => void) | undefined, key: string): React.JSX.Element {
  if (items.some((item) => item.checked !== null)) {
    const flat: Array<{ item: Item; depth: number }> = []
    const walk = (list: Item[], depth: number): void => list.forEach((item) => { flat.push({ item, depth }); walk(item.children, depth + 1) })
    walk(items, 0)
    return <ul key={key} className="tasks">{flat.map(({ item, depth }) => <li key={`${key}-${item.line}`} className={`tk ${depth ? 'sub' : ''}`} data-ln={onToggle ? item.line : undefined} onClick={onToggle ? () => onToggle(item.line, !item.checked) : undefined}><span className={`tkb ${item.checked ? 'on' : ''}`} />{inline(item.text, `${key}-${item.line}`)}</li>)}</ul>
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

export function Markdown({ source, onToggle }: { source: string; onToggle?(line: number, checked: boolean): void }): React.JSX.Element {
  const lines = source.split('\n'), blocks: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { i += 1; continue }
    if (line.startsWith('```')) {
      const start = i; const body: string[] = []; i += 1
      while (i < lines.length && !lines[i]!.startsWith('```')) { body.push(lines[i]!); i += 1 }
      i += 1; blocks.push(<pre key={`b${start}`}><code>{body.join('\n')}</code></pre>); continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) { const Tag = `h${Math.min(3, heading[1]!.length)}` as 'h1'; blocks.push(<Tag key={`b${i}`}>{inline(heading[2]!, `b${i}`)}</Tag>); i += 1; continue }
    if (/^---+\s*$/.test(line)) { blocks.push(<hr key={`b${i}`} />); i += 1; continue }
    if (/^>\s?/.test(line)) {
      const start = i; const body: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i]!)) { body.push(lines[i]!.replace(/^>\s?/, '')); i += 1 }
      blocks.push(<blockquote key={`b${start}`}>{inline(body.join(' '), `b${start}`)}</blockquote>); continue
    }
    if (listLine.test(line)) {
      const start = i; const collected: Array<{ match: RegExpExecArray; line: number }> = []
      while (i < lines.length) { const match = listLine.exec(lines[i]!); if (!match) break; collected.push({ match, line: i }); i += 1 }
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
  return <>{blocks.length ? blocks : <p className="mdEmpty">Nada escrito ainda.</p>}</>
}
