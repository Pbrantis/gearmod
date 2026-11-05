import React, { useEffect, useState } from 'react'
import { agentColorPalette, branchPrefixOf, type CardTypeDef, type Project } from '@gearmod/contracts'
import { ConfirmDialog } from './ConfirmDialog'
import { TrashIcon } from './icons'
import { plainError } from './NoticeDialog'
import { useT } from './i18n'

/** Card type to display: the one registered in the project or, if it left the list, the id with a neutral color. */
export function cardTypeView(types: readonly CardTypeDef[], id: string): { name: string; color: string | null } {
  const found = types.find((item) => item.id === id)
  return found ? { name: found.name, color: found.color } : { name: id, color: null }
}

/** Type badge (`.pill`) in the registered color; unknown type gets the badge's neutral color. */
export function CardTypePill({ types, type }: { types: readonly CardTypeDef[]; type: string }): React.JSX.Element {
  const view = cardTypeView(types, type)
  return <span className={`pill cardtype-pill ${view.color ? 'tc' : ''}`} data-tip={view.name} style={view.color ? { '--tc': view.color } as React.CSSProperties : undefined}>{view.name}</span>
}

/** Type options for the selectors (with the color); keeps the card's current type even if it left the list. */
export function cardTypeOptions(types: readonly CardTypeDef[], current?: string): Array<{ value: string; label: string; color?: string }> {
  const options = types.map((item) => ({ value: item.id, label: item.name, color: item.color }))
  return current && !types.some((item) => item.id === current) ? [...options, { value: current, label: current }] : options
}

const slug = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
function newId(name: string, taken: readonly CardTypeDef[]): string {
  const base = slug(name) || 'tipo'
  let id = base, n = 2
  while (taken.some((item) => item.id === id)) id = `${base}-${n++}`
  return id
}

/** Key of the palette open for the type that is still being created. */
const newTypeKey = '__new__'

/**
 * Editor for the card type list (name + color). Each change is saved immediately (`save`). Removing a type in use asks for confirmation:
 * the cards remain, they just show up with a neutral color and the id as the name.
 */
export function CardTypesEditor({ types, save, usage, disabled = false }: { types: CardTypeDef[]; save(types: CardTypeDef[]): Promise<void>; usage(): Promise<Record<string, number>>; disabled?: boolean }): React.JSX.Element {
  const t = useT().settings.cardTypes
  const [error, setError] = useState(''), [palette, setPalette] = useState<string>(), [adding, setAdding] = useState<string | null>(null), [newColor, setNewColor] = useState(''), [removing, setRemoving] = useState<{ type: CardTypeDef; count: number }>()
  const [names, setNames] = useState<Record<string, string>>({})
  const forget = (id: string): void => setNames((all) => { const next = { ...all }; delete next[id]; return next })
  const persist = async (next: CardTypeDef[]): Promise<boolean> => { try { setError(''); await save(next); return true } catch (reason) { setError(plainError(reason)); return false } }
  const nameTaken = (name: string, except?: string): boolean => types.some((item) => item.id !== except && item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())
  const rename = (type: CardTypeDef): void => {
    const value = (names[type.id] ?? type.name).trim()
    forget(type.id)
    if (!value || value === type.name) return
    if (nameTaken(value, type.id)) { setError(t.duplicate); return }
    void persist(types.map((item) => item.id === type.id ? { ...item, name: value.slice(0, 40) } : item))
  }
  const recolor = (type: CardTypeDef, color: string): void => { setPalette(undefined); if (color.toLowerCase() !== type.color.toLowerCase()) void persist(types.map((item) => item.id === type.id ? { ...item, color } : item)) }
  const freeColor = (): string => { const used = new Set(types.map((item) => item.color.toLowerCase())); return agentColorPalette.find((item) => !used.has(item.toLowerCase())) ?? agentColorPalette[types.length % agentColorPalette.length]! }
  const startAdding = (): void => { setAdding(''); setNewColor(freeColor()); setPalette(undefined) }
  const add = (): void => {
    const name = (adding ?? '').trim()
    setAdding(null); setPalette(undefined)
    if (!name) return
    if (nameTaken(name)) { setError(t.duplicate); return }
    void persist([...types, { id: newId(name, types), name: name.slice(0, 40), color: newColor || freeColor() }])
  }
  const askRemove = async (type: CardTypeDef): Promise<void> => {
    if (types.length <= 1) { setError(t.lastOne); return }
    let count = 0
    try { count = (await usage())[type.id] ?? 0 } catch { /* no count: confirms anyway */ count = -1 }
    if (count === 0) void persist(types.filter((item) => item.id !== type.id))
    else setRemoving({ type, count })
  }
  const setPrefix = (type: CardTypeDef, raw: string): void => {
    const value = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 40)
    if ((value || undefined) === type.branchPrefix) return
    void persist(types.map((item) => item.id === type.id ? (value ? { ...item, branchPrefix: value } : (({ branchPrefix: _drop, ...rest }) => rest)(item)) : item))
  }
  return <div className="cardtypes">
    <div className="cardtypes-row cardtypes-head" aria-hidden="true"><span>{t.color}</span><span>{t.name}</span><span>{t.branchPrefix}</span><span /></div>
    <ul className="cardtypes-list">{types.map((type) => <li key={type.id} className="cardtypes-row">
      <button type="button" className="cardtypes-swatch tip" disabled={disabled} data-tip={t.color} aria-label={t.colorOf(type.name)} aria-expanded={palette === type.id} style={{ background: type.color }} onClick={() => setPalette(palette === type.id ? undefined : type.id)} />
      <input className="in cardtypes-name" disabled={disabled} aria-label={t.name} maxLength={40} value={names[type.id] ?? type.name} onChange={(event) => setNames({ ...names, [type.id]: event.target.value })} onBlur={() => rename(type)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.stopPropagation(); forget(type.id) } }} />
      <input key={`${type.id}:${type.branchPrefix ?? ''}`} className="in cardtypes-prefix tip" disabled={disabled} data-tip={t.branchPrefixTip} aria-label={t.branchPrefix} maxLength={40} spellCheck={false} placeholder={branchPrefixOf(undefined, type.id)} defaultValue={type.branchPrefix ?? ''} onBlur={(event) => setPrefix(type, event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      <button type="button" className="ibtn tip cardtypes-x" disabled={disabled || types.length <= 1} data-tip={types.length <= 1 ? t.lastOne : t.remove} aria-label={t.removeOf(type.name)} onClick={() => void askRemove(type)}><TrashIcon /></button>
      {palette === type.id && <div className="cardtypes-palette" role="listbox" aria-label={t.colorOf(type.name)}>{agentColorPalette.map((color) => <button type="button" role="option" aria-selected={color.toLowerCase() === type.color.toLowerCase()} key={color} className={color.toLowerCase() === type.color.toLowerCase() ? 'on' : ''} style={{ background: color }} aria-label={color} onClick={() => recolor(type, color)} />)}<label className="cardtypes-custom tip" data-tip={t.customColor}><input type="color" aria-label={t.customColor} value={type.color} onChange={(event) => recolor(type, event.target.value)} /></label></div>}
    </li>)}
      {adding !== null && <li className="cardtypes-row" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) add() }}>
        {/* New type: the color can be chosen before saving; saves with Enter or when focus leaves the row. */}
        <button type="button" className="cardtypes-swatch tip" data-tip={t.color} aria-label={t.colorOf(adding || t.newName)} aria-expanded={palette === newTypeKey} style={{ background: newColor }} onClick={() => setPalette(palette === newTypeKey ? undefined : newTypeKey)} />
        <input className="in cardtypes-name" autoFocus aria-label={t.name} maxLength={40} placeholder={t.newName} value={adding} onChange={(event) => setAdding(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add(); if (event.key === 'Escape') { event.stopPropagation(); setAdding(null); setPalette(undefined) } }} />
        {palette === newTypeKey && <div className="cardtypes-palette" role="listbox" aria-label={t.color}>{agentColorPalette.map((color) => <button type="button" role="option" aria-selected={color.toLowerCase() === newColor.toLowerCase()} key={color} className={color.toLowerCase() === newColor.toLowerCase() ? 'on' : ''} style={{ background: color }} aria-label={color} onClick={() => setNewColor(color)} />)}<label className="cardtypes-custom tip" data-tip={t.customColor}><input type="color" aria-label={t.customColor} value={newColor} onChange={(event) => setNewColor(event.target.value)} /></label></div>}
      </li>}
    </ul>
    <button type="button" className="addfull cardtypes-add" disabled={disabled || types.length >= 30} onClick={startAdding}>{t.add}</button>
    {error && <p className="error">{error}</p>}
    {removing && <ConfirmDialog eyebrow={t.title} title={t.removeTitle(removing.type.name)} text={removing.count < 0 ? t.removeUnknownText : t.removeText(removing.count)} ok={t.removeOk} danger cancel={() => setRemoving(undefined)} confirm={() => { const target = removing.type; setRemoving(undefined); void persist(types.filter((item) => item.id !== target.id)) }} />}
  </div>
}

/** Settings › General: the default list of types (projects without their own list, including new ones). */
export function DefaultCardTypes(): React.JSX.Element {
  const t = useT().settings.cardTypes
  const [types, setTypes] = useState<CardTypeDef[]>()
  useEffect(() => { void window.gearmod.invoke('card-types:get-default', undefined).then(setTypes).catch(() => setTypes([])) }, [])
  return <div className="f"><span>{t.title}</span><p className="hint" style={{ margin: 0 }}>{t.defaultHint}</p>
    {types && <CardTypesEditor types={types} save={async (next) => { setTypes(await window.gearmod.invoke('card-types:set-default', { types: next })); window.dispatchEvent(new Event('gearmod:board-changed')) }} usage={() => window.gearmod.invoke('card-types:usage', {})} />}</div>
}

/** Configure project › General: project types. Changing the list creates the project's own list; "Back to default list" discards it. */
export function ProjectCardTypes({ project }: { project: Project }): React.JSX.Element {
  const t = useT().settings.cardTypes
  const [state, setState] = useState({ types: project.cardTypes, custom: project.customCardTypes }), [error, setError] = useState('')
  const apply = (next: Project): void => { setState({ types: next.cardTypes, custom: next.customCardTypes }); window.dispatchEvent(new Event('gearmod:board-changed')) }
  const reset = async (): Promise<void> => { try { setError(''); apply(await window.gearmod.invoke('projects:set-card-types', { projectId: project.id, types: null })) } catch (reason) { setError(plainError(reason)) } }
  return <div className="stack" style={{ gap: 8 }}><span className="sectitle">{t.title}</span>
    <small className="hint">{t.projectHint} {state.custom ? t.customList : t.usingDefault}</small>
    <CardTypesEditor types={state.types} save={async (next) => apply(await window.gearmod.invoke('projects:set-card-types', { projectId: project.id, types: next }))} usage={() => window.gearmod.invoke('card-types:usage', { projectId: project.id })} />
    {state.custom && <button type="button" className="mini secondary" style={{ justifySelf: 'start' }} onClick={() => void reset()}>{t.useDefault}</button>}
    {error && <p className="error">{error}</p>}
  </div>
}
