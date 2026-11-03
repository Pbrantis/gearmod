import React, { useEffect, useRef, useState } from 'react'
import type { CodeSymbol } from '@gearmod/contracts'
import { kindMark } from './codeNavigation'
import { useT } from '../i18n'

/** Linha de resultado das listas do índice de código: tipo, nome e onde está. */
export interface NavItem { path: string; relative: string; line: number; title: string; detail?: string | undefined; kind?: string | undefined }

export function KindMark({ kind }: { kind?: string | undefined }): React.JSX.Element {
  return <span className="cnav-kind" data-kind={kind ?? ''} aria-hidden="true">{kindMark(kind)}</span>
}

/** Lista navegável por teclado (↑ ↓ Enter); o foco fica no campo ou no próprio diálogo. */
function useListKeys(count: number, choose: (index: number) => void): { selected: number; setSelected(index: number): void; keyDown(event: React.KeyboardEvent): void; list: React.RefObject<HTMLDivElement | null> } {
  const [selected, setSelected] = useState(0), list = useRef<HTMLDivElement>(null)
  useEffect(() => { setSelected((value) => Math.min(value, Math.max(0, count - 1))) }, [count])
  useEffect(() => { list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [selected])
  const keyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(Math.min(selected + 1, count - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(Math.max(selected - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(selected) }
  }
  return { selected, setSelected, keyDown, list }
}

function Items({ items, selected, setSelected, choose, list }: { items: NavItem[]; selected: number; setSelected(index: number): void; choose(index: number): void; list: React.RefObject<HTMLDivElement | null> }): React.JSX.Element {
  const t = useT()
  return <div className="qopen-list" role="listbox" aria-label={t.files.editor.codeNav.results} ref={list}>
    {items.map((item, index) => <button key={`${item.path}:${item.line}:${index}`} type="button" role="option" aria-selected={index === selected} className={`qopen-item ${index === selected ? 'on' : ''}`} data-tip={`${item.path}:${item.line}`} onMouseEnter={() => setSelected(index)} onClick={() => choose(index)}>
      <KindMark kind={item.kind} /><span className="qopen-name">{item.title}</span>{item.detail && <span className="cnav-detail">{item.detail}</span>}<small>{item.relative}:{item.line}</small></button>)}
  </div>
}

/** Modo "Símbolos" do Ctrl+P (Ctrl+T): busca funções, classes e tipos no índice de código do projeto. */
export function SymbolSearch({ context, text, setText, open }: { context: { projectId: string; cardId: string | null }; text: string; setText(value: string): void; open(path: string, line: number): void }): React.JSX.Element {
  const t = useT(), [found, setFound] = useState<CodeSymbol[] | null>(null), [error, setError] = useState(''), query = text.trim()
  useEffect(() => {
    if (!query) { setFound(null); return }
    let alive = true
    const timer = window.setTimeout(() => { void window.gearmod.invoke('code-index:symbols', { ...context, query, limit: 60 }).then((result) => { if (alive) { setFound(result); setError('') } }).catch(() => { if (alive) setError(t.files.editor.codeNav.failed) }) }, 120)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [query, context.projectId, context.cardId])
  const items: NavItem[] = (found ?? []).map((hit) => ({ path: hit.path, relative: hit.relative, line: hit.line, title: hit.qname || hit.name, kind: hit.kind }))
  const choose = (index: number): void => { const item = items[index]; if (item) open(item.path, item.line) }
  const keys = useListKeys(items.length, choose)
  useEffect(() => { keys.setSelected(0) }, [query])
  return <>
    <input autoFocus className="in" placeholder={t.files.editor.codeNav.symbolPlaceholder} aria-label={t.files.editor.codeNav.symbolLabel} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={keys.keyDown} />
    {items.length > 0 ? <Items items={items} selected={keys.selected} setSelected={keys.setSelected} choose={choose} list={keys.list} />
      : <p className="qopen-note">{error || (!query ? t.files.editor.codeNav.symbolHint : found ? t.files.editor.codeNav.noSymbols : t.files.editor.codeNav.searching)}</p>}
  </>
}

/** Resultado do F12 (várias definições) e do Shift+F12 (quem usa), no mesmo formato do Ctrl+P. */
export function CodeNavDialog({ title, items, note, open, close }: { title: string; items: NavItem[]; note?: string | undefined; open(item: NavItem): void; close(): void }): React.JSX.Element {
  const t = useT(), box = useRef<HTMLDivElement>(null)
  const choose = (index: number): void => { const item = items[index]; if (item) { close(); open(item) } }
  const keys = useListKeys(items.length, choose)
  useEffect(() => { box.current?.focus() }, [])
  const keyDown = (event: React.KeyboardEvent): void => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } else keys.keyDown(event) }
  return <div className="qopen-back" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <div ref={box} tabIndex={-1} className="qopen" role="dialog" aria-modal="true" aria-label={title} onKeyDown={keyDown}>
      <div className="qopen-modes"><b className="cnav-title">{title}</b><button type="button" className="qopen-close" aria-label={t.files.editor.codeNav.close} onClick={close}>×</button></div>
      {items.length > 0 ? <Items items={items} selected={keys.selected} setSelected={keys.setSelected} choose={choose} list={keys.list} /> : <p className="qopen-note">{note}</p>}
    </div>
  </div>
}
