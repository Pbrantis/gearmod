import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Checkbox } from './Checkbox'
import type { SelectOption } from './Select'
import { useFloatingMenu } from './useFloatingMenu'
import { useEscape } from './useEscape'

/**
 * Seleção múltipla com o mesmo visual do `Select`: cada opção tem uma caixinha e a lista fica aberta enquanto se marca.
 * `empty` é o texto mostrado quando nada está marcado.
 */
export function MultiSelect({ options, value, onChange, label, empty, up = false, disabled = false }: { options: SelectOption[]; value: string[]; onChange(value: string[]): void; label: string; empty: string; up?: boolean; disabled?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null)
  const box = useFloatingMenu(open, button, up)
  useEffect(() => {
    if (!open) return
    const close = (event: Event): void => { if (!root.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  useEscape(() => setOpen(false), open)
  const chosen = options.filter((option) => value.includes(option.value))
  const toggle = (option: string): void => onChange(value.includes(option) ? value.filter((item) => item !== option) : options.map((item) => item.value).filter((item) => item === option || value.includes(item)))
  return <div className="sel" ref={root}>
    <button type="button" ref={button} className="sel-btn" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><span className="l">{chosen.length ? chosen.map((item) => item.label).join(' + ') : empty}</span><span className="chev">▾</span></button>
    {open && box && createPortal(<div ref={list} className="sel-list fx floating-select-list" role="listbox" aria-label={label} aria-multiselectable="true" style={box} onClick={(event) => { event.preventDefault(); event.stopPropagation() }}>{options.map((option) => {
      const on = value.includes(option.value)
      return <button type="button" role="option" aria-selected={on} key={option.value} disabled={option.disabled} className={`sel-opt multi ${on ? 'on' : ''}`} onClick={() => toggle(option.value)}><Checkbox checked={on} label={option.label} onChange={() => toggle(option.value)} /><span>{option.label}</span>{option.sub && <small>{option.sub}</small>}</button>
    })}</div>, document.body)}
  </div>
}
