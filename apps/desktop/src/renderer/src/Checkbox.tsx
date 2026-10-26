import React from 'react'

/** Checkbox quadrado padrão do app. O label externo continua responsável pelo texto e pela área clicável. */
export function Checkbox({ checked, onChange, disabled = false, label }: { checked: boolean; onChange(value: boolean): void; disabled?: boolean; label?: string }): React.JSX.Element {
  return <span className="ckwrap"><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className="ck" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg></span></span>
}
