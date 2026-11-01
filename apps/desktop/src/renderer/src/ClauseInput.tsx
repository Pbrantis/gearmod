import React, { useMemo, useRef, useState } from 'react'

/** Campo livre de WHERE / ORDER BY com sugestões (colunas e palavras-chave) para a palavra sob o cursor. */
export function ClauseInput({ label, caption, value, onChange, onSubmit, suggestions, placeholder }: { label: string; caption: string; value: string; onChange(value: string): void; onSubmit(): void; suggestions: string[]; placeholder?: string }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null), [caret, setCaret] = useState(0), [open, setOpen] = useState(false), [index, setIndex] = useState(0)
  const token = /["\w.]*$/.exec(value.slice(0, caret))?.[0] ?? ''
  const matches = useMemo(() => {
    if (!token) return []
    const lower = token.replace(/^"/, '').toLowerCase()
    return suggestions.filter((item) => item.replace(/^"/, '').toLowerCase().startsWith(lower) && item.toLowerCase() !== token.toLowerCase()).slice(0, 8)
  }, [token, suggestions])
  const shown = open && matches.length > 0
  const accept = (item: string): void => {
    const start = caret - token.length, next = `${value.slice(0, start)}${item} ${value.slice(caret)}`, position = start + item.length + 1
    onChange(next); setOpen(false); setIndex(0)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(position, position); setCaret(position) })
  }
  return <div className="db-clause"><span className="db-clause-label">{caption}</span>
    <input ref={input} className="db-clause-input" spellCheck={false} autoComplete="off" aria-label={label} placeholder={placeholder} value={value} role="combobox" aria-expanded={shown} aria-autocomplete="list"
      onChange={(event) => { onChange(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); setOpen(true); setIndex(0) }}
      onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)} onBlur={() => setOpen(false)} onFocus={() => setOpen(true)}
      onKeyDown={(event) => {
        if (shown && event.key === 'ArrowDown') { event.preventDefault(); setIndex((index + 1) % matches.length) }
        else if (shown && event.key === 'ArrowUp') { event.preventDefault(); setIndex((index - 1 + matches.length) % matches.length) }
        else if (shown && (event.key === 'Tab' || event.key === 'Enter')) { event.preventDefault(); accept(matches[index] ?? matches[0]!) }
        else if (event.key === 'Escape' && shown) { event.stopPropagation(); setOpen(false) }
        else if (event.key === 'Enter') { event.preventDefault(); onSubmit() }
      }} />
    {shown && <div className="db-clause-list" role="listbox">{matches.map((item, i) => <button type="button" role="option" aria-selected={i === index} key={item} className={i === index ? 'on' : ''} onMouseDown={(event) => { event.preventDefault(); accept(item) }}>{item}</button>)}</div>}
  </div>
}
