import React, { useEffect, useRef, useState } from 'react'
import { answersMessage, splitQuestionBlocks, type QuestionBlock } from '@agentboard/contracts'
import { Markdown } from './markdown'

/** Quem hospeda o chat recebe as respostas já formatadas e as manda ao agente como mensagem normal. */
export const QuestionAnswerContext = React.createContext<((text: string) => void) | null>(null)

const other = '__outro__'

/**
 * Perguntas do agente com opções, uma por vez: escolher (ou marcar várias), "Outro" com texto livre, voltar e revisar.
 * Só quando todas têm resposta o botão final aparece e o contexto volta ao agente.
 */
function QuestionCard({ block, answer, busy }: { block: QuestionBlock; answer: (text: string) => void; busy: boolean }): React.JSX.Element {
  const total = block.perguntas.length
  const card = useRef<HTMLDivElement>(null), first = useRef(true)
  const [step, setStep] = useState(0), [picked, setPicked] = useState<string[][]>(() => block.perguntas.map(() => [])), [typed, setTyped] = useState<string[]>(() => block.perguntas.map(() => ''))
  const question = block.perguntas[step]!, current = picked[step]!, multiple = Boolean(question.multipla), last = step === total - 1
  const final = (index: number): string[] => { const text = typed[index]!.trim(); return picked[index]!.flatMap((label) => label === other ? (text ? [text] : []) : [label]) }
  const done = (index: number): boolean => final(index).length > 0
  const ready = block.perguntas.every((_, index) => done(index))
  const set = (labels: string[]): void => setPicked((all) => all.map((value, index) => index === step ? labels : value))
  const toggle = (label: string): void => {
    if (multiple) { set(current.includes(label) ? current.filter((item) => item !== label) : [...current, label]); return }
    set([label])
    // Escolha única avança sozinha; "Outro" espera o texto.
    if (label !== other && !last) window.setTimeout(() => setStep((value) => Math.min(total - 1, value + 1)), 180)
  }
  const submit = (): void => answer(answersMessage(block, block.perguntas.map((_, index) => final(index))))
  // Perguntas de alturas diferentes: ao ir para a próxima ou voltar, o cartão continua inteiro à vista, no fim da conversa.
  useEffect(() => { if (first.current) { first.current = false; return }; requestAnimationFrame(() => card.current?.scrollIntoView({ block: 'end' })) }, [step])
  return <div className="qcard" ref={card} role="group" aria-label="Perguntas do agente">
    <div className="q-top">
      <div className="q-steps">{block.perguntas.map((item, index) => <button type="button" key={index} className={`q-dot ${index === step ? 'on' : ''} ${done(index) ? 'ok' : ''}`} aria-label={`Pergunta ${index + 1}${item.cabecalho ? `: ${item.cabecalho}` : ''}`} aria-current={index === step} onClick={() => setStep(index)} />)}</div>
      <span className="q-count">{question.cabecalho ? `${question.cabecalho} · ` : ''}{step + 1} de {total}</span>
    </div>
    <p className="q-ask">{question.pergunta}</p>
    <div className="q-opts" role={multiple ? 'group' : 'radiogroup'}>
      {question.opcoes.map((option) => { const on = current.includes(option.rotulo); return <button type="button" key={option.rotulo} role={multiple ? 'checkbox' : 'radio'} aria-checked={on} className={`q-opt ${on ? 'on' : ''}`} onClick={() => toggle(option.rotulo)}>
        <span className={`q-mark ${multiple ? 'sq' : ''}`} aria-hidden="true" /><span className="q-lbl"><b>{option.rotulo}</b>{option.descricao && <small>{option.descricao}</small>}</span></button> })}
      <div className={`q-opt q-other ${current.includes(other) ? 'on' : ''}`}>
        <button type="button" role={multiple ? 'checkbox' : 'radio'} aria-checked={current.includes(other)} className="q-otherbtn" onClick={() => toggle(other)}><span className={`q-mark ${multiple ? 'sq' : ''}`} aria-hidden="true" /><span className="q-lbl"><b>Outro</b></span></button>
        {current.includes(other) && <input className="in q-input" autoFocus value={typed[step]} placeholder="Escreva a sua resposta" onChange={(e) => setTyped((all) => all.map((value, index) => index === step ? e.target.value : value))} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (!last && done(step)) setStep(step + 1) } }} />}
      </div>
    </div>
    <div className="q-nav">
      <button type="button" className="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>Voltar</button>
      <span className="q-spacer" />
      {last
        ? <button type="button" disabled={!ready || busy} title={busy ? 'Espere o agente terminar' : ready ? undefined : 'Responda todas as perguntas'} onClick={submit}>Enviar respostas</button>
        : <button type="button" disabled={!done(step)} onClick={() => setStep(step + 1)}>Próxima</button>}
    </div>
  </div>
}

/** Perguntas já respondidas (há mensagem sua depois): só o resumo, sem botões. */
function AnsweredQuestions({ block, answers }: { block: QuestionBlock; answers?: Map<string, string> }): React.JSX.Element {
  return <div className="qcard answered"><div className="q-top"><span className="q-count">Perguntas respondidas</span></div>
    <ul>{block.perguntas.map((item, index) => { const reply = answers?.get(item.pergunta); return <li key={index}>{item.pergunta}{reply && <b className="q-reply">{reply}</b>}</li> })}</ul></div>
}

/** Lê de volta a mensagem montada por `answersMessage`: pergunta → resposta. */
export function parseAnswers(body: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const part of body.split('\n\n')) { const [ask, reply] = part.split('\n→ '); if (ask && reply !== undefined) found.set(ask, reply) }
  return found
}

/** Respostas do usuário que cobrem todas as perguntas do primeiro bloco da mensagem do agente (senão, continua como mensagem normal). */
export function answersFor(agentBody: string, userBody: string): Map<string, string> | null {
  const part = splitQuestionBlocks(agentBody).find((item) => item.kind === 'questions')
  if (!part || part.kind !== 'questions') return null
  const answers = parseAnswers(userBody)
  return part.block.perguntas.every((item) => answers.has(item.pergunta)) ? answers : null
}

/** Mensagem do agente: Markdown normal e, no meio, os blocos de perguntas viram cartão interativo. `answered` = o usuário já respondeu depois. */
export function AgentMessage({ source, answered = false, live = false, busy = false, answers }: { source: string; answered?: boolean; live?: boolean; busy?: boolean; answers?: Map<string, string> }): React.JSX.Element {
  const answer = React.useContext(QuestionAnswerContext)
  return <>{splitQuestionBlocks(source).map((part, index) => part.kind === 'text'
    ? <Markdown key={index} source={part.text} />
    : live ? null : answered || answers || !answer ? <AnsweredQuestions key={index} block={part.block} answers={answers} /> : <QuestionCard key={index} block={part.block} answer={answer} busy={busy} />)}</>
}
