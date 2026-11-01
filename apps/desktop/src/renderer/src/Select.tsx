import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingMenu } from './useFloatingMenu'
import { useEscape } from './useEscape'
import { useT } from './i18n'

export interface SelectOption { value: string; label: string; color?: string; icon?: React.ReactNode; sub?: string; disabled?: boolean }

/** Seleção customizada do protótipo (`.sel`): lista flutuante fixa que não empurra o layout. */
export function Select({ options, value, onChange, up = false, label, className = '', disabled = false }: { options: SelectOption[]; value: string; onChange(value: string): void; up?: boolean; label: string; className?: string; disabled?: boolean }): React.JSX.Element {
  const t = useT(), [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null)
  const box = useFloatingMenu(open, button, up)
  const current = options.find((item) => item.value === value) ?? options[0]
  useEffect(() => {
    if (!open) return
    const close = (event: Event): void => { if (!root.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  useEscape(() => setOpen(false), open)
  const item = (option: SelectOption): React.JSX.Element => <>{option.color && <span className="seldot" style={{ background: option.color }} />}{option.icon}<span>{option.label}</span></>
  return <div className={`sel ${className}`} ref={root}>
    <button type="button" ref={button} className="sel-btn" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><span className="l">{current && item(current)}</span><span className="chev">▾</span></button>
    {open && box && createPortal(<div ref={list} className="sel-list fx floating-select-list" role="listbox" aria-label={label} style={box} onClick={(event) => { event.preventDefault(); event.stopPropagation() }}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} key={option.value} disabled={option.disabled} data-tip={option.disabled ? t.shell.select.needsApproval : undefined} className={`sel-opt ${option.value === value ? 'on' : ''}`} onClick={() => { onChange(option.value); setOpen(false) }}>{item(option)}{option.sub && <small>{option.sub}</small>}</button>)}</div>, document.body)}
  </div>
}
