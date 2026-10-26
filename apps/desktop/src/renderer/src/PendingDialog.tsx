import React, { useCallback, useEffect, useState } from 'react'
import type { Card, Change, Collaboration, Question } from '@agentboard/contracts'

const role = { planning: 'planejador', execution: 'desenvolvedor', test: 'testador' } as const
const mark = (prefix: string, n: number): string => `${prefix}${String(n).padStart(3, '0')}`

function ChangeItem({ change, busy, decide }: { change: Change; busy: boolean; decide(decision: 'accept' | 'reject' | 'suggest', note?: string): void }): React.JSX.Element {
  const [suggesting, setSuggesting] = useState(false), [note, setNote] = useState('')
  return <div className="skill-row">
    <div className="skill-top"><div><b>{mark('M', change.number)} · {change.title}</b><small>Proposta do {role[change.proposerPurpose]}</small></div></div>
    <div className="pendbody"><p><b>O que muda:</b> {change.details}</p><p><b>Motivo:</b> {change.reason}</p><p className="hint">Ao autorizar, o planejador atualiza os documentos e o app manda o desenvolvedor, no chat de implementação, trabalhar nesta mudança.</p></div>
    {suggesting ? <div className="convbox"><label className="f">Qual é a sua visão?<textarea className="in" rows={3} value={note} placeholder="Explique como você prefere resolver isso" onChange={(e) => setNote(e.target.value)} /></label>
      <div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setSuggesting(false)}>Voltar</button><button type="button" disabled={busy || !note.trim()} onClick={() => decide('suggest', note)}>Enviar visão ao planejador</button></div></div>
      : <div className="actions" style={{ margin: 0 }}><button type="button" className="danger" disabled={busy} onClick={() => decide('reject')}>Recusar</button><button type="button" className="secondary" disabled={busy} onClick={() => setSuggesting(true)}>Sugerir outra visão</button><button type="button" disabled={busy} onClick={() => decide('accept')}>Autorizar</button></div>}
  </div>
}

function SendItem({ change, busy, send }: { change: Change; busy: boolean; send(): void }): React.JSX.Element {
  return <div className="skill-row">
    <div className="skill-top"><div><b>{mark('M', change.number)} · {change.title}</b><small>Autorizada, ainda não foi para o desenvolvedor</small></div></div>
    <div className="pendbody"><p><b>O que muda:</b> {change.details}</p><p className="hint">O app manda sozinho quando o planejador termina de atualizar os documentos. Se ainda não foi, mande agora para o desenvolvedor trabalhar nela.</p></div>
    <div className="actions" style={{ margin: 0 }}><button type="button" disabled={busy} onClick={send}>Mandar implementar</button></div>
  </div>
}

function QuestionItem({ question, busy, answer }: { question: Question; busy: boolean; answer(text: string): void }): React.JSX.Element {
  const [text, setText] = useState('')
  return <div className="skill-row">
    <div className="skill-top"><div><b>{mark('D', question.number)} · Pergunta para você</b><small>Dúvida do {role[question.askerPurpose]}, que o planejador não conseguiu decidir sozinho</small></div></div>
    <div className="pendbody"><p><b>Dúvida original:</b> {question.question}</p>{question.userQuestion && <p><b>O planejador pergunta:</b> {question.userQuestion}</p>}</div>
    <label className="f">Sua resposta<textarea className="in" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>
    <div className="actions" style={{ margin: 0 }}><button type="button" disabled={busy || !text.trim()} onClick={() => answer(text)}>Responder e retomar</button></div>
  </div>
}

/** Pendências do card: mudanças propostas que esperam autorização (aceitar, recusar ou sugerir outra visão) e perguntas que só o usuário responde. */
export function PendingDialog({ card, close, changed }: { card: Card; close(): void; changed(): void }): React.JSX.Element {
  const [data, setData] = useState<Collaboration>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const load = useCallback(async () => { try { setData(await window.agentboard.invoke('collab:list', { cardId: card.id })) } catch (reason) { setError(String(reason)) } }, [card.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close])
  const run = async (action: () => Promise<Collaboration>): Promise<void> => { setBusy(true); setError(''); try { setData(await action()); changed() } catch (reason) { setError(String(reason).replace(/^Error: /, '')) } finally { setBusy(false) } }
  const toSend = data?.changes.filter((item) => (item.status === 'accepted' || item.status === 'applied') && !item.sentAt) ?? []
  const changes = data?.changes.filter((item) => item.status === 'pending') ?? [], questions = data?.questions.filter((item) => item.status === 'user') ?? []
  return <div className="overlay top"><div className="modal" style={{ width: 'min(640px,100%)' }}>
    <header><div><div className="eyebrow">Autorizar mudanças</div><h2>{card.title || 'Novo card'}</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    <p style={{ marginBottom: 12, fontSize: 13 }}>Os documentos do card são o contrato entre as etapas. O agente não altera nada além deles sem a sua autorização: ao autorizar, o planejador atualiza os documentos e só então o desenvolvimento continua.</p>
    <div className="stack" style={{ gap: 10 }}>
      {changes.map((change) => <ChangeItem key={change.id} change={change} busy={busy} decide={(decision, note) => void run(() => window.agentboard.invoke('collab:decide-change', { changeId: change.id, decision, note }))} />)}
      {toSend.map((change) => <SendItem key={change.id} change={change} busy={busy} send={() => void run(() => window.agentboard.invoke('collab:send-change', { changeId: change.id }))} />)}
      {questions.map((question) => <QuestionItem key={question.id} question={question} busy={busy} answer={(text) => void run(() => window.agentboard.invoke('collab:answer-question', { questionId: question.id, answer: text }))} />)}
      {data && !changes.length && !questions.length && !toSend.length && <div className="emptyBox">Nada esperando por você neste card.</div>}
    </div>
    {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}
    <div className="actions"><button className="secondary" onClick={close}>Fechar</button></div>
  </div></div>
}
