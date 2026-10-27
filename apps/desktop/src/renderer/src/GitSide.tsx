import React, { useEffect, useRef, useState } from 'react'
import type { GitGraph } from '@agentboard/contracts'

type Node<T> = { type: 'item'; item: T; label: string } | { type: 'folder'; name: string; entries: Array<{ item: T; label: string }> }
type LocalBranch = GitGraph['branches']['local'][number]
type RemoteBranch = GitGraph['branches']['remote'][number]
type Icons = Record<'branch' | 'cloud' | 'pc' | 'folder' | 'stash' | 'tree', React.JSX.Element>
const heightsKey = 'agentboard.gitSideHeights', openKey = 'agentboard.gitSideOpen'
const loadOpen = (): { shut: Record<string, boolean>; folders: Record<string, boolean> } => { try { const saved = JSON.parse(localStorage.getItem(openKey) ?? '{}') as { shut?: Record<string, boolean>; folders?: Record<string, boolean> }; return { shut: saved.shut ?? {}, folders: saved.folders ?? {} } } catch { return { shut: {}, folders: {} } } }
const loadHeights = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(heightsKey) ?? '{}') as Record<string, number> } catch { return {} } }
const syncArrow = (direction: 'up' | 'down'): React.JSX.Element => <svg viewBox="0 0 16 16" aria-hidden="true"><path d={direction === 'down' ? 'M8 3v8M4.5 7.5 8 11l3.5-3.5M3.5 13.5h9' : 'M8 13V5M4.5 8.5 8 5l3.5 3.5M3.5 2.5h9'} /></svg>
const withoutRemote = (name: string): string => name.replace(/^[^/]+\//, '')

/** Agrupa pelo primeiro trecho do nome (feature/x vira a pasta "feature"); sem barra fica solto. Mantém a ordem original. */
function group<T>(items: T[], nameOf: (item: T) => string): Array<Node<T>> {
  const out: Array<Node<T>> = [], folders = new Map<string, Extract<Node<T>, { type: 'folder' }>>()
  for (const item of items) {
    const name = nameOf(item), slash = name.indexOf('/')
    if (slash <= 0) { out.push({ type: 'item', item, label: name }); continue }
    const folder = name.slice(0, slash)
    let node = folders.get(folder)
    if (!node) { node = { type: 'folder', name: folder, entries: [] }; folders.set(folder, node); out.push(node) }
    node.entries.push({ item, label: name.slice(slash + 1) })
  }
  return out
}

/**
 * Lateral do Git: Local, Remoto, Worktrees e Stashes. Branches agrupadas por pasta (fechadas, menos a que tem a branch atual ou o card em foco),
 * seções que abrem/fecham e linhas entre elas que se arrastam para mudar a altura de cada uma.
 */
export function GitSide({ graph, focus, setFocus, title, icons, picked, onPick, onOpen, onMenu }: { graph?: GitGraph; focus: string | null; setFocus(id: string | null): void; title(cardId: string | null): string; icons: Icons; picked?: string; onPick(kind: 'local' | 'remote', name: string): void; onOpen(kind: 'local' | 'remote', name: string, current: boolean): void; onMenu(kind: 'local' | 'remote' | 'stash', name: string, event: React.MouseEvent): void }): React.JSX.Element {
  const saved = useRef(loadOpen()), [shut, setShut] = useState<Record<string, boolean>>(saved.current.shut), [folders, setFolders] = useState<Record<string, boolean>>(saved.current.folders), [heights, setHeights] = useState(loadHeights)
  useEffect(() => { try { localStorage.setItem(openKey, JSON.stringify({ shut, folders })) } catch { /* só vale nesta sessão */ } }, [shut, folders])
  const tree = useRef<HTMLDivElement>(null)
  const localNodes = group<LocalBranch>(graph?.branches.local ?? [], (branch) => branch.name), remoteNodes = group<RemoteBranch>(graph?.branches.remote ?? [], (branch) => withoutRemote(branch.name))
  const localActive = (branch: LocalBranch): boolean => picked === `local:${branch.name}` || (!picked && branch.head)
  const remoteActive = (branch: RemoteBranch): boolean => picked === `remote:${branch.name}`

  const folderRow = <T,>(scope: string, node: Extract<Node<T>, { type: 'folder' }>, active: (item: T) => boolean, row: (entry: { item: T; label: string }) => React.ReactNode): React.JSX.Element => {
    const key = `${scope}:${node.name}`, open = folders[key] ?? node.entries.some((entry) => active(entry.item))
    return <div className="gfolder" key={key}>
      <button type="button" className="gfold" aria-expanded={open} onClick={() => setFolders({ ...folders, [key]: !open })}><span className="gchev">{open ? '▾' : '▸'}</span>{icons.folder}<span className="gn">{node.name}</span><small>{node.entries.length}</small></button>
      {open && <div className="gfin">{node.entries.map(row)}</div>}
    </div>
  }
  const localRow = (entry: { item: LocalBranch; label: string }): React.JSX.Element => {
    const { item: branch, label } = entry
    return <button type="button" key={branch.name} title={branch.name} className={`gref ${picked === `local:${branch.name}` ? 'on' : ''}`} onClick={() => onPick('local', branch.name)} onDoubleClick={() => onOpen('local', branch.name, branch.head)} onContextMenu={(event) => onMenu('local', branch.name, event)}>{icons.branch}<span className="gwt"><span className="gn">{label}</span>{(branch.head || branch.cardId) && <small style={{ fontFamily: 'var(--sans)' }}>{branch.head ? 'pasta principal' : title(branch.cardId)}</small>}</span>{(branch.behind > 0 || branch.ahead > 0) && <span className="gsync tip" data-tip={branch.behind > 0 ? `${branch.behind} commit${branch.behind > 1 ? 's' : ''} para baixar do remoto` : `${branch.ahead} commit${branch.ahead > 1 ? 's' : ''} para enviar`}>{branch.behind > 0 && <b>{syncArrow('down')}{branch.behind}</b>}{branch.ahead > 0 && <b>{syncArrow('up')}{branch.ahead}</b>}</span>}</button>
  }
  const remoteRow = (entry: { item: RemoteBranch; label: string }): React.JSX.Element => <button type="button" key={entry.item.name} title={entry.item.name} className={`gref ${picked === `remote:${entry.item.name}` ? 'on' : ''}`} onClick={() => onPick('remote', entry.item.name)} onDoubleClick={() => onOpen('remote', entry.item.name, false)} onContextMenu={(event) => onMenu('remote', entry.item.name, event)}>{icons.branch}<span className="gwt"><span className="gn">{entry.label}</span>{entry.item.cardId && <small style={{ fontFamily: 'var(--sans)' }}>{title(entry.item.cardId)}</small>}</span></button>

  const sections: Array<{ key: string; label: string; icon: React.JSX.Element; count: number; body: React.ReactNode }> = [
    { key: 'local', label: 'Local', icon: icons.pc, count: graph?.branches.local.length ?? 0, body: localNodes.map((node) => node.type === 'item' ? localRow(node) : folderRow('local', node, localActive, (entry) => localRow(entry))) },
    { key: 'remote', label: 'Remoto', icon: icons.cloud, count: graph?.branches.remote.length ?? 0, body: remoteNodes.map((node) => node.type === 'item' ? remoteRow(node) : folderRow('remote', node, remoteActive, remoteRow)) },
    { key: 'wt', label: 'Worktrees dos cards', icon: icons.tree, count: graph?.worktrees.length ?? 0, body: <>{graph?.worktrees.map((wt) => <button type="button" key={wt.cardId} className={`gref ${focus === wt.cardId ? 'on' : ''}`} onClick={() => setFocus(focus === wt.cardId ? null : wt.cardId)}>{icons.folder}<span className="gwt"><span>{title(wt.cardId) || wt.title}</span><small>{wt.path}</small></span></button>)}{graph && !graph.worktrees.length && <div className="gempty" style={{ padding: 8 }}>Nenhum card mexeu neste repositório.</div>}</> },
    { key: 'stash', label: 'Stashes', icon: icons.stash, count: graph?.stashes.length ?? 0, body: <>{graph?.stashes.map((stash) => <button type="button" key={stash.ref} className="gref" title={stash.ref} onContextMenu={(event) => onMenu('stash', stash.ref, event)}><span className="gn" style={{ fontFamily: 'var(--sans)' }}>{stash.message}</span></button>)}{graph && !graph.stashes.length && <div className="gempty" style={{ padding: 8 }}>Nenhum stash.</div>}</> }
  ]
  // Ordem fixa: cada seção fica no seu lugar, aberta ou fechada; Local fica sempre aberta e as abertas dividem o espaço.
  const ordered = sections
  const isShut = (key: string): boolean => key !== 'local' && Boolean(shut[key])
  const openKeys = ordered.filter((section) => !isShut(section.key)).map((section) => section.key), lastOpen = openKeys[openKeys.length - 1]
  const dragTarget = (index: number): string | undefined => { const found = ordered.slice(0, index + 1).reverse().find((section) => !isShut(section.key)); return found && found.key !== lastOpen ? found.key : undefined }

  // A linha entre duas seções muda a altura da seção aberta logo acima; a última aberta preenche o resto.
  const drag = (index: number) => (event: React.PointerEvent<HTMLDivElement>): void => {
    const key = dragTarget(index), el = key ? tree.current?.querySelector<HTMLElement>(`[data-sec="${key}"]`) : null
    if (!key || !el) return
    event.preventDefault()
    const start = event.clientY, h0 = el.getBoundingClientRect().height
    const move = (ev: PointerEvent): void => setHeights((current) => ({ ...current, [key]: Math.max(60, Math.round(h0 + ev.clientY - start)) }))
    const up = (): void => {
      document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.body.classList.remove('gresizing-v')
      setHeights((current) => { try { localStorage.setItem(heightsKey, JSON.stringify(current)) } catch { /* só vale nesta sessão */ } return current })
    }
    document.body.classList.add('gresizing-v'); document.addEventListener('pointermove', move); document.addEventListener('pointerup', up)
  }
  // Aberta: parte de uma fatia igual do espaço (ou da altura que você arrastou) e encolhe se faltar lugar; o conteúdo rola dentro dela.
  const styleOf = (key: string): React.CSSProperties => isShut(key) ? { flex: 'none' } : key === lastOpen ? { flex: '1 1 0' } : heights[key] ? { flex: `0 1 ${heights[key]}px` } : { flex: '1 1 0' }

  if (!graph) return <aside className="gside"><div className="gtree gcol gskel-side" aria-busy="true" aria-label="Carregando branches">{[0, 1, 2, 3].map((section) => <div className="gskel-sec" key={section}><span className="gskel-bar head" />{Array.from({ length: section === 0 ? 5 : 3 }, (_, index) => <span className="gskel-bar" key={index} style={{ width: `${55 + ((index * 23 + section * 11) % 40)}%` }} />)}</div>)}</div></aside>
  return <aside className="gside"><div className="gtree gcol" ref={tree}>
    {ordered.map((section, index) => {
      const open = !isShut(section.key), locked = section.key === 'local', toggle = (): void => { if (!locked) setShut({ ...shut, [section.key]: open }) }
      return <React.Fragment key={section.key}>
        {index > 0 && <div className={`gsepline ${dragTarget(index - 1) ? 'can' : ''}`} role="separator" aria-orientation="horizontal" onPointerDown={drag(index - 1)} />}
        <div className={`gsec ${open ? 'open' : ''}`} data-sec={section.key} style={styleOf(section.key)}>
          <b role="button" tabIndex={0} aria-expanded={open} aria-disabled={locked || undefined} className={`gsech ${locked ? 'locked' : ''}`} onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}><span className="gchev">{locked ? '' : open ? '▾' : '▸'}</span><span className="gsico">{section.icon}</span>{section.label}<span>{section.count}</span></b>
          {open && <div className="gsecbody">{section.body}</div>}
        </div>
      </React.Fragment>
    })}
  </div></aside>
}
