import React, { useEffect, useRef } from 'react'
import { ArchiveIcon, PlusIcon } from './icons'

/** Menu "···" do cabeçalho de uma coluna do quadro: adicionar card e arquivar todos os da coluna. */
export function ColumnMenu({ label, count, add, archiveAll }: { label: string; count: number; add(): void; archiveAll(): void }): React.JSX.Element {
  const [open, setOpen] = React.useState(false), box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  }, [open])
  return <span className="colmenu" ref={box}>
    <button type="button" className="colAdd tip" data-tip="Ações da coluna" aria-label={`Ações da coluna ${label}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>···</button>
    {open && <div className="popmenu colmenu-pop" role="menu" aria-label={`Ações da coluna ${label}`}>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); add() }}><PlusIcon />Adicionar card</button>
      <button type="button" role="menuitem" disabled={count === 0} onClick={() => { setOpen(false); archiveAll() }}><ArchiveIcon />Arquivar todos da coluna{count > 0 ? ` (${count})` : ''}</button>
    </div>}
  </span>
}
