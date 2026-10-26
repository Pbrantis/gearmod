import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Checkbox } from './Checkbox'
import type { SelectOption } from './Select'

/**
 * Seleção múltipla com o mesmo visual do `Select`: cada opção tem uma caixinha e a lista fica aberta enquanto se marca.
 * `empty` é o texto mostrado quando nada está marcado.
 */
export function MultiSelect({ options, value, onChange, label, empty, up = false, disabled = false }: { options: SelectOption[]; value: string[]; onChange(value: string[]): void; label: string; empty: string; up?: boolean; disabled?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false), [box, setBox] = useState<React.CSSProperties>()
  const button = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const rect = button.current.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom - 16, above = rect.top - 16, flip = up || (below < 160 && above > below)
    const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 16), left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setBox({ position: 'fixed', left, width, right: 'auto', ...(flip ? { bottom: window.innerHeight - rect.top + 5, top: 'auto' } : { top: rect.bottom + 5 }), maxHeight: Math.min(320, flip ? above : below) })
  }, [open, up])
  useEffect(() => {
    if (!open) return
    const close = (event: Event): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    const resize = (): void => setOpen(false)
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key, true); window.addEventListener('resize', resize)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', resize) }
  }, [open])
  const chosen = options.filter((option) => value.includes(option.value))
  const toggle = (option: string): void => onChange(value.includes(option) ? value.filter((item) => item !== option) : options.map((item) => item.value).filter((item) => item === option || value.includes(item)))
  return <div className="sel" ref={root}>
    <button type="button" ref={button} className="sel-btn" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><span className="l">{chosen.length ? chosen.map((item) => item.label).join(' + ') : empty}</span><span className="chev">▾</span></button>
    {open && <div className="sel-list fx" role="listbox" aria-multiselectable="true" style={box} onClick={(event) => event.preventDefault()}>{options.map((option) => {
      const on = value.includes(option.value)
      return <button type="button" role="option" aria-selected={on} key={option.value} disabled={option.disabled} className={`sel-opt multi ${on ? 'on' : ''}`} onClick={() => toggle(option.value)}><Checkbox checked={on} label={option.label} onChange={() => toggle(option.value)} /><span>{option.label}</span>{option.sub && <small>{option.sub}</small>}</button>
    })}</div>}
  </div>
}
