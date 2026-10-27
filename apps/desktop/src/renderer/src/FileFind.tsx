import React, { useEffect, useRef, useState } from 'react'
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
export interface ReplaceControls { open: boolean; setOpen(value: boolean): void; text: string; setText(value: string): void; disabled: boolean; one(): void; all(): void }
export function FileFind({ input, query, setQuery, options, setOptions, count, index, error, previous, next, close, replace }: { input: React.RefObject<HTMLInputElement | null>; query: string; setQuery(value: string): void; options: FindOptions; setOptions(value: FindOptions): void; count: number; index: number; error: string; previous(): void; next(): void; close(): void; replace?: ReplaceControls }): React.JSX.Element {
  return <>
  <div className="wf-find" role="search" aria-label="Localizar no arquivo">
    {replace && <button type="button" className="wf-findnav" aria-label={replace.open ? 'Esconder substituir' : 'Mostrar substituir'} title="Substituir (Ctrl+H)" aria-expanded={replace.open} onClick={() => replace.setOpen(!replace.open)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d={replace.open ? 'm5 8 5 5 5-5' : 'm8 5 5 5-5 5'} /></svg></button>}
    <div className={`wf-findbox ${error ? 'invalid' : ''}`}><input ref={input} placeholder="Localizar no arquivo…" aria-label="Texto a procurar no arquivo" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (event.shiftKey) previous(); else next() } }} />
      <span className="wf-matchcount" role="status">{error || (query ? count ? `${index < 0 ? 0 : index + 1}/${count}` : 'Sem resultados' : '')}</span>
      {([['caseSensitive', 'Diferenciar maiúsculas e minúsculas', 'Aa'], ['wholeWord', 'Palavra inteira', 'ab'], ['regex', 'Expressão regular', '.*']] as const).map(([key, label, text]) => <button key={key} type="button" className={`wf-findopt ${options[key] ? 'on' : ''} ${key === 'wholeWord' ? 'whole-word' : ''}`} title={label} aria-label={label} aria-pressed={options[key]} onClick={() => setOptions({ ...options, [key]: !options[key] })}>{text}</button>)}
    </div>
    <button type="button" className="wf-findnav" aria-label="Ocorrência anterior" title="Anterior (Shift+Enter)" disabled={!count} onClick={previous}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16V4m-5 5 5-5 5 5" /></svg></button>
    <button type="button" className="wf-findnav" aria-label="Próxima ocorrência" title="Próxima (Enter)" disabled={!count} onClick={next}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12m-5-5 5 5 5-5" /></svg></button>
    <button type="button" className="wf-findnav close" aria-label="Fechar pesquisa" title="Fechar (Esc)" onClick={close}><CloseIcon /></button>
  </div>
  {replace?.open && <div className="wf-find wf-replace" role="group" aria-label="Substituir no arquivo">
    <div className="wf-findbox"><input placeholder="Substituir por…" aria-label="Texto de substituição" value={replace.text} disabled={replace.disabled} onChange={(event) => replace.setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); replace.one() } }} /></div>
    <button type="button" className="wf-findtext" disabled={replace.disabled || !count} title="Substituir a ocorrência atual (Enter)" onClick={replace.one}>Substituir</button>
    <button type="button" className="wf-findtext" disabled={replace.disabled || !count} title="Substituir todas as ocorrências" onClick={replace.all}>Substituir tudo</button>
  </div>}
  </>
}

/** Caixa "Ir para linha": `42` ou `42:7`; `submit` devolve `false` se o texto não for válido. */
export function GoToLine({ submit, close }: { submit(text: string): boolean; close(): void }): React.JSX.Element {
  const [text, setText] = useState(''), [invalid, setInvalid] = useState(false), field = useRef<HTMLInputElement>(null)
  useEffect(() => { field.current?.focus() }, [])
  return <div className="wf-find" role="dialog" aria-label="Ir para linha">
    <div className={`wf-findbox ${invalid ? 'invalid' : ''}`}><input ref={field} placeholder="Ir para linha (ex.: 42 ou 42:7)" aria-label="Linha de destino" value={text} onChange={(event) => { setText(event.target.value); setInvalid(false) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (submit(text)) close(); else setInvalid(true) } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }} /></div>
    <button type="button" className="wf-findnav close" aria-label="Fechar" title="Fechar (Esc)" onClick={close}><CloseIcon /></button>
  </div>
}
