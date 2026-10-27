import React, { useEffect, useMemo, useRef, useState } from 'react'
import { FileTypeIcon } from '../FileAppearance'
import { tabLabels, type ChangeRoot } from '../changes'
import { slashed } from './documents'
import { splitLineSuffix } from './position'
import { rankPaths } from './quickOpen'

/**
 * Caixa do Ctrl+P: sem texto lista os arquivos recentes; com texto busca no projeto (aproximada) e ordena no renderer.
 * `nome:42` abre já na linha 42.
 */
export function QuickOpen({ context, roots, recents, open, close }: {
  context: { projectId: string; cardId: string | null }; roots: ChangeRoot[]; recents: string[]; open(path: string, line?: number, column?: number): void; close(): void
}): React.JSX.Element {
  const [text, setText] = useState(''), [found, setFound] = useState<string[]>([]), [selected, setSelected] = useState(0), [error, setError] = useState('')
  const list = useRef<HTMLDivElement>(null), target = splitLineSuffix(text.trim())
  useEffect(() => {
    if (!target.path) { setFound([]); return }
    let alive = true
    const timer = window.setTimeout(() => { void window.agentboard.invoke('workspace:search', { ...context, query: target.path, fuzzy: true }).then((result) => { if (alive) { setFound(result.paths); setError('') } }).catch(() => { if (alive) setError('Não foi possível pesquisar') }) }, 120)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [target.path, context.projectId, context.cardId])
  const ranked = useMemo(() => (target.path ? rankPaths(target.path, found, recents) : rankPaths('', recents)).slice(0, 50), [target.path, found, recents])
  const labels = useMemo(() => tabLabels(ranked.map((item) => item.path), roots), [ranked, roots])
  useEffect(() => { setSelected(0) }, [target.path])
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [selected])
  const folderOf = (path: string): string => { const root = [...roots].sort((a, b) => b.path.length - a.path.length).find((item) => slashed(path).startsWith(`${slashed(item.path).replace(/\/$/, '')}/`)), relative = root ? path.replace(/\\/g, '/').slice(root.path.replace(/[\\/]+$/, '').length + 1) : path; return relative.split('/').slice(0, -1).join('/') }
  const choose = (index: number): void => { const item = ranked[index]; if (item) { close(); open(item.path, target.line, target.column) } }
  const keyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, ranked.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(selected) }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  }
  return <div className="qopen-back" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <div className="qopen" role="dialog" aria-label="Abrir arquivo" onKeyDown={keyDown}>
      <input autoFocus className="in" placeholder="Abrir arquivo por nome (ex.: wsf ou index.ts:42)" aria-label="Nome do arquivo" value={text} onChange={(event) => setText(event.target.value)} />
      <div className="qopen-list" role="listbox" ref={list}>
        {!target.path && ranked.length > 0 && <p className="qopen-note">Recentes</p>}
        {ranked.map((item, index) => { const folder = folderOf(item.path), repo = labels[item.path]?.repo; return <button key={item.path} type="button" role="option" aria-selected={index === selected} className={`qopen-item ${index === selected ? 'on' : ''}`} title={item.path} onMouseEnter={() => setSelected(index)} onClick={() => choose(index)}>
          <FileTypeIcon path={item.path} /><span className="qopen-name">{[...item.name].map((letter, at) => item.matched.includes(at) ? <mark key={at}>{letter}</mark> : letter)}</span><small>{[repo, folder].filter(Boolean).join(' › ')}</small></button> })}
        {!ranked.length && <p className="qopen-note">{error || (target.path ? 'Nenhum arquivo encontrado.' : 'Digite para procurar um arquivo.')}</p>}
      </div>
    </div>
  </div>
}
