import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem<K extends string = string> { key: K; label: string; danger?: boolean; off?: string }
export type BranchAction = 'checkout' | 'pull' | 'pull-rebase' | 'push' | 'rebase-onto' | 'merge' | 'create' | 'delete' | 'copy'
export type CommitMenuAction = 'checkout' | 'cherry-pick' | 'revert' | 'reset-soft' | 'reset-mixed' | 'reset-hard' | 'branch' | 'tag' | 'copy'
export type StashMenuAction = 'apply' | 'pop' | 'drop'

/** Menu do botão direito do Git (branches, commits, stashes): lista de ações com setas, Enter e Esc. */
export function GitMenu<K extends string>({ x, y, title, label, items, run, close }: { x: number; y: number; title: string; label: string; items: Array<MenuItem<K>>; run(key: K): void; close(): void }): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null), [pos, setPos] = useState({ left: x, top: y }), [active, setActive] = useState(0)
  const go = (item: MenuItem<K>): void => { if (!item.off) run(item.key) }
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect(); if (!box) return
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)) })
  }, [x, y])
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return }
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => (value + 1) % items.length); return }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => (value + items.length - 1) % items.length); return }
      if (event.key === 'Enter') { event.preventDefault(); go(items[active]!) }
    }
    const away = (event: MouseEvent): void => { if (!root.current?.contains(event.target as Node)) close() }
    document.addEventListener('keydown', key, true); document.addEventListener('mousedown', away); window.addEventListener('blur', close); window.addEventListener('resize', close)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', away); window.removeEventListener('blur', close); window.removeEventListener('resize', close) }
  })
  return <div className="ctxmenu" ref={root} role="menu" aria-label={label} style={pos} onContextMenu={(event) => event.preventDefault()}>
    <div className="ctxtitle" title={title}>{title}</div>
    {items.map((item, index) => <React.Fragment key={item.key}>
      {item.danger && <div className="ctxsep" />}
      <button type="button" role="menuitem" disabled={Boolean(item.off)} className={`ctxitem ${item.danger ? 'danger' : ''} ${index === active ? 'on' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => go(item)}><span>{item.label}</span>{item.off && <kbd>{item.off}</kbd>}</button>
    </React.Fragment>)}
  </div>
}

/** Ações de uma branch (como no GitKraken): trocar, puxar, enviar, rebase, merge, criar a partir dela e apagar. */
export function branchItems(kind: 'local' | 'remote', head: boolean, current: string | null): Array<MenuItem<BranchAction>> {
  const local = kind === 'local', other = head ? 'é a branch atual' : current ? undefined : 'sem branch atual'
  return [
    { key: 'checkout', label: head ? 'Já está nesta branch' : 'Fazer checkout', off: head ? 'atual' : undefined },
    ...(local ? [
      { key: 'pull', label: 'Pull (só avança)' } as MenuItem<BranchAction>,
      { key: 'pull-rebase', label: 'Pull com rebase', off: head ? undefined : 'faça checkout antes' } as MenuItem<BranchAction>,
      { key: 'push', label: 'Push' } as MenuItem<BranchAction>
    ] : []),
    { key: 'rebase-onto', label: `Rebase ${current ?? 'a atual'} em cima desta`, off: other },
    { key: 'merge', label: `Merge desta em ${current ?? 'a atual'}`, off: other },
    { key: 'create', label: 'Criar branch a partir daqui' },
    ...(local ? [{ key: 'delete', label: 'Apagar branch', danger: true, off: head ? 'é a branch atual' : undefined } as MenuItem<BranchAction>] : []),
    { key: 'copy', label: 'Copiar o nome' }
  ]
}

/** Ações de um commit: levar ou desfazer na branch atual, mover a branch (reset), criar branch ou tag ali. */
export function commitItems(current: string | null): Array<MenuItem<CommitMenuAction>> {
  const none = current ? undefined : 'sem branch atual'
  return [
    { key: 'checkout', label: 'Abrir este commit (HEAD solto)' },
    { key: 'cherry-pick', label: `Cherry-pick em ${current ?? 'a atual'}`, off: none },
    { key: 'revert', label: `Reverter em ${current ?? 'a atual'}`, off: none },
    { key: 'branch', label: 'Criar branch aqui' },
    { key: 'tag', label: 'Criar tag aqui' },
    { key: 'reset-soft', label: 'Reset soft até aqui (mantém tudo preparado)', off: none },
    { key: 'reset-mixed', label: 'Reset mixed até aqui (mantém os arquivos)', off: none },
    { key: 'reset-hard', label: 'Reset hard até aqui (descarta alterações)', danger: true, off: none },
    { key: 'copy', label: 'Copiar o SHA' }
  ]
}

export const stashItems: Array<MenuItem<StashMenuAction>> = [
  { key: 'apply', label: 'Aplicar (mantém o stash)' },
  { key: 'pop', label: 'Aplicar e remover (pop)' },
  { key: 'drop', label: 'Apagar stash', danger: true }
]
