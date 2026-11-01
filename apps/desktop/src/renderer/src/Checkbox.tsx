import React, { useEffect, useRef } from 'react'

/** Checkbox quadrado padrão do app. O label externo continua responsável pelo texto e pela área clicável. `indeterminate` mostra o traço de "alguns marcados". */
export function Checkbox({ checked, onChange, disabled = false, label, indeterminate = false }: { checked: boolean; onChange(value: boolean): void; disabled?: boolean; label?: string; indeterminate?: boolean }): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (input.current) input.current.indeterminate = indeterminate }, [indeterminate])
  return <span className="ckwrap"><input ref={input} type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span className="ck" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg></span></span>
}
