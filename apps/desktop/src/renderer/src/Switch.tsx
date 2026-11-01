import React from 'react'

/** Interruptor padrão do app (`label.autosave > input[role=switch] + span.sw`). */
export function Switch({ checked, onChange, disabled = false, children, className = '', tip, style }: { checked: boolean; onChange(value: boolean): void; disabled?: boolean; children?: React.ReactNode; className?: string; tip?: string; style?: React.CSSProperties }): React.JSX.Element {
  return <label className={`autosave${className ? ` ${className}` : ''}`} data-tip={tip} style={style}><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className="sw" aria-hidden="true" />{children}</label>
}
