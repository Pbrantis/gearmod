import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface SelectOption { value: string; label: string; color?: string; icon?: React.ReactNode; sub?: string; disabled?: boolean }

/** Seleção customizada do protótipo (`.sel`): lista flutuante fixa que não empurra o layout. */
export function Select({ options, value, onChange, up = false, label, className = '', disabled = false }: { options: SelectOption[]; value: string; onChange(value: string): void; up?: boolean; label: string; className?: string; disabled?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false), [box, setBox] = useState<React.CSSProperties>()
  const button = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null)
  const current = options.find((item) => item.value === value) ?? options[0]
  useLayoutEffect(() => {
    if (!open || !button.current) return
    const rect = button.current.getBoundingClientRect()
    // Sem espaço embaixo (menos de ~200px) e mais espaço em cima: a lista abre para cima.
    const below = window.innerHeight - rect.bottom - 16, above = rect.top - 16, flip = up || (below < 200 && above > below)
    const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 16), left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    setBox({ position: 'fixed', left, width, right: 'auto', ...(flip ? { bottom: window.innerHeight - rect.top + 5, top: 'auto' } : { top: rect.bottom + 5 }), maxHeight: Math.min(320, flip ? above : below) })
  }, [open, up])
  useEffect(() => {
    if (!open) return
    const close = (event: Event): void => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', key, true); window.addEventListener('resize', () => setOpen(false))
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key, true) }
  }, [open])
  const item = (option: SelectOption): React.JSX.Element => <>{option.color && <span className="seldot" style={{ background: option.color }} />}{option.icon}<span>{option.label}</span></>
  return <div className={`sel ${className}`} ref={root}>
    <button type="button" ref={button} className="sel-btn" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><span className="l">{current && item(current)}</span><span className="chev">▾</span></button>
    {open && <div className="sel-list fx" role="listbox" style={box} onClick={(event) => event.preventDefault()}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value} disabled={option.disabled} title={option.disabled ? 'Precisa da tela de aprovação (em breve)' : undefined} className={`sel-opt ${option.value === value ? 'on' : ''}`} onClick={() => { onChange(option.value); setOpen(false) }}>{item(option)}{option.sub && <small>{option.sub}</small>}</button>)}</div>}
  </div>
}
