import React, { useEffect, useRef } from 'react'
import { ArchiveIcon, PlusIcon } from './icons'
import { useEscape } from './useEscape'
import { useT } from './i18n'

/** "···" menu in a board column header: add card and archive all of the column's cards. */
export function ColumnMenu({ label, count, add, archiveAll }: { label: string; count: number; add(): void; archiveAll(): void }): React.JSX.Element {
  const t = useT().board
  const [open, setOpen] = React.useState(false), box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useEscape(() => setOpen(false), open)
  return <span className="colmenu" ref={box}>
    <button type="button" className="colAdd tip" data-tip={t.columnMenu.actions} aria-label={t.columnMenu.actionsOf(label)} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>···</button>
    {open && <div className="popmenu colmenu-pop" role="menu" aria-label={t.columnMenu.actionsOf(label)}>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); add() }}><PlusIcon />{t.columnMenu.addCard}</button>
      <button type="button" role="menuitem" disabled={count === 0} onClick={() => { setOpen(false); archiveAll() }}><ArchiveIcon />{t.columnMenu.archiveAll(count)}</button>
    </div>}
  </span>
}
