import React, { useEffect, useRef, useState } from 'react'
import { rankPaths } from './editor/quickOpen'
import { useT } from './i18n'

interface Hit { path: string; relative: string; name: string; directory: boolean }
const maxHits = 8

/**
 * "@" no campo de mensagem: abre a lista de arquivos do projeto (ou da worktree do card), filtrada pelo que vem depois do "@".
 * Escolher troca o trecho por `@caminho/relativo ` no texto, que o agente entende como referência ao arquivo.
 */
export function useAtMention({ projectId, cardId, input, setInput }: { projectId: string; cardId: string | null; input: string; setInput(value: string): void }) {
  const t = useT()
  const area = useRef<HTMLTextAreaElement>(null), roots = useRef<string[]>([]), latest = useRef(0)
  const [caret, setCaret] = useState(0), [hits, setHits] = useState<Hit[]>([]), [index, setIndex] = useState(0), [closedAt, setClosedAt] = useState(-1)
  const found = /(^|\s)@([^\s@]*)$/.exec(input.slice(0, caret)), query = found ? found[2]! : null, start = found ? caret - found[2]!.length - 1 : -1
  const open = query !== null && closedAt !== start && hits.length > 0

  useEffect(() => { roots.current = [] }, [projectId, cardId])
  useEffect(() => {
    if (query === null) { setHits([]); if (closedAt !== -1) setClosedAt(-1); return }
    const ticket = ++latest.current
    const timer = window.setTimeout(() => {
      void (async () => {
        if (!roots.current.length) roots.current = (await window.gearmod.invoke('workspace:roots', { projectId, cardId })).filter((item) => item.primary).map((item) => item.path)
        const roots_ = roots.current, relativeOf = (path: string): string => { const root = roots_.find((item) => path.toLowerCase().startsWith(item.toLowerCase())); return (root ? path.slice(root.length) : path).split(String.fromCharCode(92)).join('/').replace(/^\/+/, '') }
        let next: Hit[]
        if (!query) {
          const entries = roots_[0] ? await window.gearmod.invoke('workspace:list', { projectId, cardId, path: roots_[0] }) : []
          next = entries.slice(0, maxHits).map((entry) => ({ path: entry.path, relative: relativeOf(entry.path), name: entry.name, directory: entry.directory }))
        } else {
          const { paths } = await window.gearmod.invoke('workspace:search', { projectId, cardId, query: query.slice(0, 200), fuzzy: true })
          const byRelative = new Map(paths.map((path) => [relativeOf(path), path]))
          next = rankPaths(query, [...byRelative.keys()]).slice(0, maxHits).map((item) => ({ path: byRelative.get(item.path) ?? item.path, relative: item.path, name: item.name, directory: false }))
        }
        if (ticket === latest.current) { setHits(next); setIndex(0) }
      })().catch(() => { if (ticket === latest.current) setHits([]) })
    }, query ? 120 : 0)
    return () => window.clearTimeout(timer)
  }, [projectId, cardId, query])

  const pick = (hit: Hit): void => {
    const text = `@${hit.relative}${hit.directory ? '/' : ' '}`, next = input.slice(0, start) + text + input.slice(caret), position = start + text.length
    setInput(next); setCaret(position)
    window.requestAnimationFrame(() => { const element = area.current; if (element) { element.focus(); element.setSelectionRange(position, position) } })
  }
  /** Devolve true quando a tecla foi da lista (setas, Enter/Tab para escolher, Esc para fechar): o chamador não deve enviar a mensagem. */
  const keyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.nativeEvent.isComposing) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex((value) => (value + (event.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length); return true }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); const hit = hits[index]; if (hit) pick(hit); return true }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setClosedAt(start); return true }
    return false
  }
  const menu = open ? <div className="atmenu" role="listbox" aria-label={t.chat.atMention.projectFiles} onMouseDown={(event) => event.preventDefault()}>
    {hits.map((hit, position) => <button type="button" role="option" aria-selected={position === index} key={hit.path} className={`atitem ${position === index ? 'on' : ''}`} data-tip={hit.relative} onMouseEnter={() => setIndex(position)} onClick={() => pick(hit)}>
      <svg viewBox="0 0 20 20" aria-hidden="true">{hit.directory ? <path d="M3 6a1.5 1.5 0 0 1 1.5-1.5H8l1.6 2H15.5A1.5 1.5 0 0 1 17 8v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" /> : <path d="M5.5 3h6L15 6.5v10a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5zM11 3v4h4" />}</svg>
      <span className="atname">{hit.name}</span><span className="atpath">{hit.relative.includes('/') ? hit.relative.slice(0, hit.relative.length - hit.name.length - 1) : ''}</span>
    </button>)}
  </div> : null
  return {
    menu, keyDown, ref: area,
    /** Chamar quando o texto ou o cursor mudam, para saber se há um "@" antes do cursor. */
    caret: (value: number): void => setCaret(value)
  }
}

export interface InputToken { start: number; end: number; kind: 'file' | 'skill'; word: string }

/** Trechos do texto que valem como bloco: `@arquivo` e `/skill` (só as skills conhecidas), sempre começando uma palavra. */
export function inputTokens(text: string, skillNames: string[]): InputToken[] {
  const found: InputToken[] = []
  for (const match of text.matchAll(/(^|\s)(@[^\s@]+|\/[^\s/]+)(?=\s|$)/g)) {
    const word = match[2]!, start = (match.index ?? 0) + match[1]!.length
    if (word.startsWith('@')) found.push({ start, end: start + word.length, kind: 'file', word })
    else if (skillNames.includes(word.slice(1))) found.push({ start, end: start + word.length, kind: 'skill', word })
  }
  return found
}

/**
 * Backspace (ou Delete) dentro de um bloco `@arquivo` ou `/skill` apaga o bloco inteiro, com o espaço que vem depois.
 * Devolve o novo texto e a posição do cursor, ou `null` quando a tecla não é de um bloco (o chamador segue normal).
 */
export function dropToken(event: React.KeyboardEvent<HTMLTextAreaElement>, text: string, skillNames: string[]): { text: string; at: number; token: InputToken } | null {
  if ((event.key !== 'Backspace' && event.key !== 'Delete') || event.nativeEvent.isComposing || event.shiftKey || event.altKey || event.metaKey) return null
  const { selectionStart, selectionEnd } = event.currentTarget
  if (selectionStart !== selectionEnd) return null
  const caret = selectionStart, back = event.key === 'Backspace'
  const token = inputTokens(text, skillNames).find((item) => back ? caret > item.start && caret <= item.end : caret >= item.start && caret < item.end)
  if (!token) return null
  const stop = token.end + (text[token.end] === ' ' ? 1 : 0)
  return { text: text.slice(0, token.start) + text.slice(stop), at: token.start, token }
}

/** Camada atrás do textarea (texto transparente): repete o texto e pinta os blocos `@arquivo` e `/skill` em outra cor. */
export function InputMirror({ text, skillNames, area }: { text: string; skillNames: string[]; area: React.RefObject<HTMLTextAreaElement | null> }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = area.current; if (!element) return
    const sync = (): void => { if (box.current) box.current.scrollTop = element.scrollTop }
    element.addEventListener('scroll', sync); sync()
    return () => element.removeEventListener('scroll', sync)
  }, [area, text])
  const parts: React.ReactNode[] = []
  let at = 0
  for (const token of inputTokens(text, skillNames)) {
    if (token.start > at) parts.push(text.slice(at, token.start))
    parts.push(<b key={token.start} className={`hltoken ${token.kind}`}>{token.word}</b>)
    at = token.end
  }
  parts.push(text.slice(at), '\u200b')
  return <div ref={box} className="hlmirror" aria-hidden="true">{parts}</div>
}
