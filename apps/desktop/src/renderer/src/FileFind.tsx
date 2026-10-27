import React from 'react'
import { CloseIcon } from './icons'
export interface FindOptions { caseSensitive: boolean; wholeWord: boolean; regex: boolean }
export function fileMatches(content: string, query: string, options: FindOptions): { matches: Array<[number, number]>; error: string } {
  if (!query) return { matches: [], error: '' }
  try {
    const pattern = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(pattern, options.caseSensitive ? 'gu' : 'giu'), matches: Array<[number, number]> = []
    for (const match of content.matchAll(re)) {
      if (!match[0].length) continue
      const start = match.index, end = start + match[0].length
      if (options.wholeWord && (/[\p{L}\p{N}_]/u.test(content[start - 1] ?? '') || /[\p{L}\p{N}_]/u.test(content[end] ?? ''))) continue
      matches.push([start, end]); if (matches.length >= 10000) break
    }
    return { matches, error: '' }
  } catch { return { matches: [], error: 'Expressão regular inválida' } }
}
export function FileFind({ input, query, setQuery, options, setOptions, count, index, error, previous, next, close }: { input: React.RefObject<HTMLInputElement | null>; query: string; setQuery(value: string): void; options: FindOptions; setOptions(value: FindOptions): void; count: number; index: number; error: string; previous(): void; next(): void; close(): void }): React.JSX.Element {
  return <div className="wf-find" role="search" aria-label="Localizar no arquivo">
    <div className={`wf-findbox ${error ? 'invalid' : ''}`}><input ref={input} placeholder="Localizar no arquivo…" aria-label="Texto a procurar no arquivo" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (event.shiftKey) previous(); else next() } }} />
      <span className="wf-matchcount" role="status">{error || (query ? count ? `${index < 0 ? 0 : index + 1}/${count}` : 'Sem resultados' : '')}</span>
      {([['caseSensitive', 'Diferenciar maiúsculas e minúsculas', 'Aa'], ['wholeWord', 'Palavra inteira', 'ab'], ['regex', 'Expressão regular', '.*']] as const).map(([key, label, text]) => <button key={key} type="button" className={`wf-findopt ${options[key] ? 'on' : ''} ${key === 'wholeWord' ? 'whole-word' : ''}`} title={label} aria-label={label} aria-pressed={options[key]} onClick={() => setOptions({ ...options, [key]: !options[key] })}>{text}</button>)}
    </div>
    <button type="button" className="wf-findnav" aria-label="Ocorrência anterior" title="Anterior (Shift+Enter)" disabled={!count} onClick={previous}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4m-5 5 5-5 5 5" /></svg></button>
    <button type="button" className="wf-findnav" aria-label="Próxima ocorrência" title="Próxima (Enter)" disabled={!count} onClick={next}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12m-5-5 5 5 5-5" /></svg></button>
    <button type="button" className="wf-findnav close" aria-label="Fechar pesquisa" title="Fechar (Esc)" onClick={close}><CloseIcon /></button>
  </div>
}
