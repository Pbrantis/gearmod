import React, { useCallback, useEffect, useState } from 'react'
import type { Card, Change, Collaboration, Question } from '@gearmod/contracts'
import { useEscape } from './useEscape'
import { plainError } from './NoticeDialog'
import { useT } from './i18n'

const mark = (prefix: string, n: number): string => `${prefix}${String(n).padStart(3, '0')}`

function ChangeItem({ change, busy, decide }: { change: Change; busy: boolean; decide(decision: 'accept' | 'reject' | 'suggest', note?: string): void }): React.JSX.Element {
  const t = useT(), role = t.shell.pending.roles
  const [suggesting, setSuggesting] = useState(false), [note, setNote] = useState('')
  return <div className="skill-row">
    <div className="skill-top"><div><b>{mark('M', change.number)} · {change.title}</b><small>{t.shell.pending.proposalFrom(role[change.proposerPurpose])}</small></div></div>
    <div className="pendbody"><p><b>{t.shell.pending.whatChanges}</b> {change.details}</p><p><b>{t.shell.pending.reason}</b> {change.reason}</p><p className="hint">{t.shell.pending.authorizeHint}</p></div>
    {suggesting ? <div className="convbox"><label className="f">{t.shell.pending.yourView}<textarea className="in" rows={3} value={note} placeholder={t.shell.pending.viewPlaceholder} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="actions" style={{ margin: 0 }}><button type="button" className="secondary" onClick={() => setSuggesting(false)}>{t.common.back}</button><button type="button" disabled={busy || !note.trim()} onClick={() => decide('suggest', note)}>{t.shell.pending.sendView}</button></div></div>
      : <div className="actions" style={{ margin: 0 }}><button type="button" className="danger" disabled={busy} onClick={() => decide('reject')}>{t.shell.pending.reject}</button><button type="button" className="secondary" disabled={busy} onClick={() => setSuggesting(true)}>{t.shell.pending.suggestOther}</button><button type="button" disabled={busy} onClick={() => decide('accept')}>{t.shell.pending.authorize}</button></div>}
  </div>
}

function SendItem({ change, busy, send }: { change: Change; busy: boolean; send(): void }): React.JSX.Element {
  const t = useT()
  return <div className="skill-row">
    <div className="skill-top"><div><b>{mark('M', change.number)} · {change.title}</b><small>{t.shell.pending.authorizedNotSent}</small></div></div>
    <div className="pendbody"><p><b>{t.shell.pending.whatChanges}</b> {change.details}</p><p className="hint">{t.shell.pending.sendHint}</p></div>
    <div className="actions" style={{ margin: 0 }}><button type="button" disabled={busy} onClick={send}>{t.shell.pending.sendToImplement}</button></div>
  </div>
}

function QuestionItem({ question, busy, answer }: { question: Question; busy: boolean; answer(text: string): void }): React.JSX.Element {
  const t = useT(), [text, setText] = useState('')
  return <div className="skill-row">
    <div className="skill-top"><div><b>{mark('D', question.number)} · {t.shell.pending.questionForYou}</b><small>{t.shell.pending.questionFrom(t.shell.pending.roles[question.askerPurpose])}</small></div></div>
    <div className="pendbody"><p><b>{t.shell.pending.originalQuestion}</b> {question.question}</p>{question.userQuestion && <p><b>{t.shell.pending.plannerAsks}</b> {question.userQuestion}</p>}</div>
    <label className="f">{t.shell.pending.yourAnswer}<textarea className="in" rows={3} value={text} onChange={(e) => setText(e.target.value)} /></label>
    <div className="actions" style={{ margin: 0 }}><button type="button" disabled={busy || !text.trim()} onClick={() => answer(text)}>{t.shell.pending.answerAndResume}</button></div>
  </div>
}

/** Pendências do card: mudanças propostas que esperam autorização (aceitar, recusar ou sugerir outra visão) e perguntas que só o usuário responde. */
export function PendingDialog({ card, close, changed }: { card: Card; close(): void; changed(): void }): React.JSX.Element {
  const t = useT(), [data, setData] = useState<Collaboration>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const load = useCallback(async () => { try { setData(await window.gearmod.invoke('collab:list', { cardId: card.id })) } catch (reason) { setError(plainError(reason)) } }, [card.id])
  useEffect(() => { void load() }, [load])
  useEscape(close)
  const run = async (action: () => Promise<Collaboration>): Promise<void> => { setBusy(true); setError(''); try { setData(await action()); changed() } catch (reason) { setError(plainError(reason)) } finally { setBusy(false) } }
  const toSend = data?.changes.filter((item) => (item.status === 'accepted' || item.status === 'applied') && !item.sentAt) ?? []
  const changes = data?.changes.filter((item) => item.status === 'pending') ?? [], questions = data?.questions.filter((item) => item.status === 'user') ?? []
  return <div className="overlay top" role="dialog" aria-label={t.shell.pending.authorizeChanges}><div className="modal" style={{ width: 'min(640px,100%)' }}>
    <header><div><div className="eyebrow">{t.shell.pending.authorizeChanges}</div><h2>{card.title || t.shell.pending.newCard}</h2></div><button className="x" onClick={close} aria-label={t.common.close}>×</button></header>
    <p style={{ marginBottom: 12, fontSize: 13 }}>{t.shell.pending.intro}</p>
    <div className="stack" style={{ gap: 10 }}>
      {changes.map((change) => <ChangeItem key={change.id} change={change} busy={busy} decide={(decision, note) => void run(() => window.gearmod.invoke('collab:decide-change', { changeId: change.id, decision, note }))} />)}
      {toSend.map((change) => <SendItem key={change.id} change={change} busy={busy} send={() => void run(() => window.gearmod.invoke('collab:send-change', { changeId: change.id }))} />)}
      {questions.map((question) => <QuestionItem key={question.id} question={question} busy={busy} answer={(text) => void run(() => window.gearmod.invoke('collab:answer-question', { questionId: question.id, answer: text }))} />)}
      {data && !changes.length && !questions.length && !toSend.length && <div className="emptyBox">{t.shell.pending.nothingWaiting}</div>}
    </div>
    {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}

  </div></div>
}
