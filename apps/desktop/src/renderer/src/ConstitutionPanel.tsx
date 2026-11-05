import React, { useCallback, useEffect, useState } from 'react'
import type { ConstitutionProposal, ConstitutionState } from '@gearmod/contracts'
import { Markdown } from './markdown'
import { CodeEditor } from './editor/CodeEditor'

const proseOptions = { wrap: true, tabSize: 2, indentWithTab: false, whitespace: false, guides: false, scrollPastEnd: false }
import { plainError } from './NoticeDialog'
import { useEscape } from './useEscape'
import { dateLocale, useT } from './i18n'

const code = (proposal: ConstitutionProposal): string => `C${String(proposal.number).padStart(3, '0')}`
const when = (iso: string | null): string => iso ? new Date(iso).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short', year: 'numeric' }) : ''

/**
 * Project Constitution tab: the principles every card respects (optional). Shows the text, edits by hand,
 * opens the Constitution chat and lists the changes the agents suggested in the other chats.
 */
export function ConstitutionPanel({ projectId, reloadKey = 0, openChat, onOpenReference }: { projectId: string; /** Changes when the Constitution's location changes: reads the file again. */ reloadKey?: number; openChat(prompt?: string): void; onOpenReference?(): void }): React.JSX.Element {
  const { board: tb, common } = useT(), t = tb.constitution
  const [state, setState] = useState<ConstitutionState>(), [editing, setEditing] = useState<string | null>(null), [error, setError] = useState(''), [working, setWorking] = useState(false), [viewing, setViewing] = useState(false)
  const load = useCallback(async () => { try { setState(await window.gearmod.invoke('constitution:get', { projectId })) } catch (reason) { setError(plainError(reason)) } }, [projectId])
  useEffect(() => { void load() }, [load, reloadKey])
  // The agent writes or suggests changes while the tab is open: reloads when it signals.
  useEffect(() => window.gearmod.onRunEvent((event) => { if (event.eventType === 'gearmod/card-updated' && event.payload.type === 'constitution') void load() }), [load])
  const act = async (call: () => Promise<ConstitutionState>): Promise<void> => {
    setWorking(true); setError('')
    try { setState(await call()); setEditing(null) } catch (reason) { setError(plainError(reason)) } finally { setWorking(false) }
  }
  const closeView = (): void => { setViewing(false); setEditing(null) }
  useEscape(closeView, viewing && editing === null)
  if (!state) return <div className="emptyBox">{error || common.loading}</div>
  const { constitution, proposals, importable } = state, pending = proposals.filter((item) => item.status === 'pending')
  const empty = !constitution.contentMd.trim()
  const lines = constitution.contentMd.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/), heading = lines.find((line) => /^#{1,3}\s/.test(line))?.replace(/^#+\s*/, '') ?? t.defaultHeading
  const excerpt = lines.filter((line) => line.trim() && !/^[#|>\-*`]/.test(line.trim())).slice(0, 3).join(' ').replace(/[*_`]/g, '').slice(0, 240)
  const sections = lines.filter((line) => /^##\s/.test(line)).length

  return <div className="stack cons">
    {editing !== null && !viewing ? <>
      <CodeEditor variant="prose" className="in cons-edit" path="constituicao.md" value={editing} options={proseOptions} ariaLabel={t.textLabel} onChange={setEditing} />
      <div className="cons-actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>{common.cancel}</button><button type="button" disabled={working} onClick={() => void act(() => window.gearmod.invoke('constitution:save', { projectId, contentMd: editing }))}>{t.saveVersion}</button></div>
    </> : empty ? <div className="cons-empty">
      <b>{t.noneYet}</b>
      <p>{t.noneHint}</p>
      <div className="cons-actions start"><button type="button" onClick={() => openChat('Crie a Constituição deste projeto a partir do código e do que já é regra nele.')}>{t.createWithAgent}</button></div>
    </div> : <>
      <div className="cons-card"><div className="cons-card-t"><b>{heading}</b><span className="ctxchip">{t.version(constitution.version)}</span></div>
        {excerpt && <p>{excerpt}{excerpt.length >= 240 ? '…' : ''}</p>}
        <div className="cons-card-f"><span className="hint">{t.updatedLine(sections, when(constitution.updatedAt), constitution.updatedBy === 'agent')}</span><span className="ch-spacer" />
          <button type="button" className="mini secondary" onClick={() => openChat()}>{t.chatWithAgent}</button><button type="button" className="mini" onClick={() => setViewing(true)}>{t.viewConstitution}</button></div></div>
    </>}
    {pending.length > 0 && <div className="stack" style={{ gap: 8 }}>
      <span className="sectitle">{t.suggestedChanges}</span>
      {pending.map((proposal) => <div className="cons-prop" key={proposal.id}>
        <div className="cons-prop-t"><b>{code(proposal)} · {proposal.title}</b><span className="hint">{when(proposal.createdAt)}</span></div>
        <p>{proposal.details}</p><p className="hint">{t.reason(proposal.reason)}</p>
        <div className="cons-actions start">
          <button type="button" className="mini" disabled={working} onClick={() => void act(() => window.gearmod.invoke('constitution:set-proposal', { proposalId: proposal.id, status: 'applied' })).then(() => openChat(`Aplique a mudança sugerida ${code(proposal)} (${proposal.title}) na Constituição. Mostre como fica e grave quando eu concordar.`))}>{t.takeToChat}</button>
          <button type="button" className="mini secondary" disabled={working} onClick={() => void act(() => window.gearmod.invoke('constitution:set-proposal', { proposalId: proposal.id, status: 'dismissed' }))}>{t.discard}</button>
        </div>
      </div>)}
    </div>}
    {viewing && <div className="overlay full" onMouseDown={(e) => { if (e.target === e.currentTarget && editing === null) closeView() }}><div className="modal wide cons-dialog" role="dialog" aria-label={t.title}>
      <header><div><div className="eyebrow">{t.dialogEyebrow(constitution.version)}</div><h2>{heading}</h2></div><div className="hdr-actions">{editing === null && <><button type="button" className="mini secondary" onClick={() => { closeView(); openChat() }}>{common.edit}</button><button type="button" className="mini" onClick={() => { closeView(); openChat() }}>{t.chatWithAgent}</button></>}<button type="button" className="x" onClick={closeView} aria-label={common.close}>×</button></div></header>
      {editing !== null ? <><CodeEditor variant="prose" className="in cons-edit cons-dialog-edit" path="constituicao.md" value={editing} options={proseOptions} ariaLabel={t.textLabel} onChange={setEditing} />
        <div className="cons-actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>{common.cancel}</button><button type="button" disabled={working} onClick={() => void act(() => window.gearmod.invoke('constitution:save', { projectId, contentMd: editing }))}>{t.saveVersion}</button></div></>
        : <div className="cons-view md cons-dialog-view"><Markdown source={constitution.contentMd} base={{ projectId, cardId: null, path: importable ?? '' }} onOpenReference={() => { closeView(); onOpenReference?.() }} /></div>}
      {error && <p className="error">{error}</p>}
    </div></div>}
    {error && !viewing && <p className="error">{error}</p>}
  </div>
}
