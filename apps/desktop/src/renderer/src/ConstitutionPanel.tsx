import React, { useCallback, useEffect, useState } from 'react'
import type { ConstitutionProposal, ConstitutionState } from '@agentboard/contracts'
import { ConfirmDialog } from './ConfirmDialog'
import { Markdown } from './markdown'
import { CodeEditor } from './editor/CodeEditor'

const proseOptions = { wrap: true, tabSize: 2, indentWithTab: false, whitespace: false, guides: false, scrollPastEnd: false }
import { plainError } from './NoticeDialog'

const code = (proposal: ConstitutionProposal): string => `C${String(proposal.number).padStart(3, '0')}`
const when = (iso: string | null): string => iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : ''

/**
 * Aba Constituição do projeto: os princípios que todo card respeita (opcional). Mostra o texto, edita à mão, importa do Spec Kit,
 * abre o chat da Constituição e lista as mudanças que os agentes sugeriram nos outros chats.
 */
export function ConstitutionPanel({ projectId, openChat }: { projectId: string; openChat(prompt?: string): void }): React.JSX.Element {
  const [state, setState] = useState<ConstitutionState>(), [editing, setEditing] = useState<string | null>(null), [error, setError] = useState(''), [working, setWorking] = useState(false), [askImport, setAskImport] = useState(false), [viewing, setViewing] = useState(false)
  const load = useCallback(async () => { try { setState(await window.agentboard.invoke('constitution:get', { projectId })) } catch (reason) { setError(plainError(reason)) } }, [projectId])
  useEffect(() => { void load() }, [load])
  // O agente grava ou sugere mudanças enquanto a aba está aberta: recarrega quando avisa.
  useEffect(() => window.agentboard.onRunEvent((event) => { if (event.eventType === 'agentboard/card-updated' && event.payload.type === 'constitution') void load() }), [load])
  const act = async (call: () => Promise<ConstitutionState>): Promise<void> => {
    setWorking(true); setError('')
    try { setState(await call()); setEditing(null) } catch (reason) { setError(plainError(reason)) } finally { setWorking(false) }
  }
  const runImport = (): Promise<void> => act(() => window.agentboard.invoke('constitution:import', { projectId }))
  if (!state) return <div className="emptyBox">{error || 'Carregando…'}</div>
  const { constitution, proposals, importable } = state, pending = proposals.filter((item) => item.status === 'pending')
  const empty = !constitution.contentMd.trim()
  const lines = constitution.contentMd.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/), heading = lines.find((line) => /^#{1,3}\s/.test(line))?.replace(/^#+\s*/, '') ?? 'Constituição'
  const excerpt = lines.filter((line) => line.trim() && !/^[#|>\-*`]/.test(line.trim())).slice(0, 3).join(' ').replace(/[*_`]/g, '').slice(0, 240)
  const sections = lines.filter((line) => /^##\s/.test(line)).length
  const closeView = (): void => { setViewing(false); setEditing(null) }
  const importButton = importable && <button type="button" className="secondary" disabled={working} title={importable} onClick={() => (empty ? void runImport() : setAskImport(true))}>Importar do Spec Kit</button>

  return <div className="stack cons">
    {editing !== null && !viewing ? <>
      <CodeEditor variant="prose" className="in cons-edit" path="constituicao.md" value={editing} options={proseOptions} ariaLabel="Texto da Constituição" onChange={setEditing} />
      <div className="cons-actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancelar</button><button type="button" disabled={working} onClick={() => void act(() => window.agentboard.invoke('constitution:save', { projectId, contentMd: editing }))}>Salvar versão</button></div>
    </> : empty ? <div className="cons-empty">
      <b>Este projeto ainda não tem Constituição</b>
      <p>Ela é opcional e reúne os princípios que valem para todo card: o que não pode ser quebrado, seja qual for a tarefa. Os agentes avisam quando um pedido fere um princípio e sugerem o que deveria virar um.</p>
      <div className="cons-actions start"><button type="button" onClick={() => openChat('Crie a Constituição deste projeto a partir do código e do que já é regra nele.')}>Criar com o agente</button><button type="button" className="secondary" onClick={() => setEditing('')}>Escrever à mão</button>{importButton}</div>
    </div> : <>
      <div className="cons-card"><div className="cons-card-t"><b>{heading}</b><span className="ctxchip">Versão {constitution.version}</span></div>
        {excerpt && <p>{excerpt}{excerpt.length >= 240 ? '…' : ''}</p>}
        <div className="cons-card-f"><span className="hint">{sections > 0 ? `${sections} seções · ` : ''}atualizada em {when(constitution.updatedAt)} {constitution.updatedBy === 'agent' ? 'pelo agente' : 'por você'}</span><span className="ch-spacer" />
          <button type="button" className="mini secondary" onClick={() => openChat()}>Conversar com o agente</button><button type="button" className="mini" onClick={() => setViewing(true)}>Ver Constituição</button></div></div>
      {importButton && <div className="cons-actions start">{importButton}</div>}
    </>}
    {pending.length > 0 && <div className="stack" style={{ gap: 8 }}>
      <span className="sectitle">Mudanças sugeridas pelos agentes</span>
      {pending.map((proposal) => <div className="cons-prop" key={proposal.id}>
        <div className="cons-prop-t"><b>{code(proposal)} · {proposal.title}</b><span className="hint">{when(proposal.createdAt)}</span></div>
        <p>{proposal.details}</p><p className="hint">Motivo: {proposal.reason}</p>
        <div className="cons-actions start">
          <button type="button" className="mini" disabled={working} onClick={() => void act(() => window.agentboard.invoke('constitution:set-proposal', { proposalId: proposal.id, status: 'applied' })).then(() => openChat(`Aplique a mudança sugerida ${code(proposal)} (${proposal.title}) na Constituição. Mostre como fica e grave quando eu concordar.`))}>Levar ao chat</button>
          <button type="button" className="mini secondary" disabled={working} onClick={() => void act(() => window.agentboard.invoke('constitution:set-proposal', { proposalId: proposal.id, status: 'dismissed' }))}>Descartar</button>
        </div>
      </div>)}
    </div>}
    {viewing && <div className="overlay full" onMouseDown={(e) => { if (e.target === e.currentTarget && editing === null) closeView() }}><div className="modal wide cons-dialog" role="dialog" aria-label="Constituição">
      <header><div><div className="eyebrow">Constituição · Versão {constitution.version}</div><h2>{heading}</h2></div><div className="hdr-actions">{editing === null && <><button type="button" className="mini secondary" onClick={() => setEditing(constitution.contentMd)}>Editar</button><button type="button" className="mini" onClick={() => { closeView(); openChat() }}>Conversar com o agente</button></>}<button type="button" className="x" onClick={closeView} aria-label="Fechar">×</button></div></header>
      {editing !== null ? <><CodeEditor variant="prose" className="in cons-edit cons-dialog-edit" path="constituicao.md" value={editing} options={proseOptions} ariaLabel="Texto da Constituição" onChange={setEditing} />
        <div className="cons-actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancelar</button><button type="button" disabled={working} onClick={() => void act(() => window.agentboard.invoke('constitution:save', { projectId, contentMd: editing }))}>Salvar versão</button></div></>
        : <div className="cons-view md cons-dialog-view"><Markdown source={constitution.contentMd} /></div>}
      {error && <p className="error">{error}</p>}
    </div></div>}
    {error && !viewing && <p className="error">{error}</p>}
    {askImport && <ConfirmDialog eyebrow="Constituição" title="Importar do Spec Kit?" text="A Constituição atual é substituída pela do Spec Kit. A versão atual fica no histórico." ok="Importar" cancel={() => setAskImport(false)} confirm={() => { setAskImport(false); void runImport() }} />}
  </div>
}
