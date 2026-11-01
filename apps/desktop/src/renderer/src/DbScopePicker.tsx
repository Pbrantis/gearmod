import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Checkbox } from './Checkbox'
import { useEscape } from './useEscape'
import { useT } from './i18n'

export type ScopeItem = { key: string; label: string; note?: string; checked: boolean; system?: boolean }

/** Lista com caixas de seleção para escolher o que aparece na árvore (bancos de um servidor ou esquemas de um banco). Aplica ao clicar fora ou com Enter; Esc cancela. */
export function DbScopePicker({ x, y, title, items, apply, close }: { x: number; y: number; title: string; items: ScopeItem[]; apply(keys: string[]): void; close(): void }): React.JSX.Element {
  const t = useT()
  const root = useRef<HTMLDivElement>(null), [pos, setPos] = useState({ left: x, top: y })
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(items.filter((item) => item.checked).map((item) => item.key)))
  const done = useRef(false)
  const commit = (): void => { if (done.current) return; done.current = true; apply(items.filter((item) => chosen.has(item.key)).map((item) => item.key)) }
  const commitRef = useRef(commit); commitRef.current = commit
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect(); if (!box) return
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) })
    root.current?.focus()
  }, [x, y])
  useEscape(() => { done.current = true; close() })
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') { event.preventDefault(); commitRef.current() }
    }
    const away = (event: MouseEvent): void => { if (!root.current?.contains(event.target as Node)) commitRef.current() }
    document.addEventListener('keydown', key, true); document.addEventListener('mousedown', away); window.addEventListener('resize', close)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', away); window.removeEventListener('resize', close) }
  }, [close])
  const all = items.length > 0 && items.every((item) => chosen.has(item.key)), some = items.some((item) => chosen.has(item.key))
  const toggle = (itemKey: string): void => setChosen((current) => { const next = new Set(current); if (!next.delete(itemKey)) next.add(itemKey); return next })
  return <div className="db-scopebox" ref={root} role="dialog" tabIndex={-1} aria-label={title} style={pos}>
    <div className="db-scope-head"><strong>{title}</strong><span>{t.database.scope.count(chosen.size, items.length)}</span></div>
    <div className="db-scope-list">
      <label className="db-scope-row all"><Checkbox checked={all} indeterminate={some && !all} onChange={() => setChosen(all ? new Set() : new Set(items.map((item) => item.key)))} /><span>{t.common.all}</span></label>
      {items.map((item) => <label key={item.key} className={`db-scope-row${item.system ? ' system' : ''}`}><Checkbox checked={chosen.has(item.key)} onChange={() => toggle(item.key)} /><span>{item.label}</span>{item.note && <em>{item.note}</em>}</label>)}
    </div>
    <div className="db-scope-foot">{t.database.scope.footer}</div>
  </div>
}
