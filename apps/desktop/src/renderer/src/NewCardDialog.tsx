import React from 'react'
import { HandIcon, SparkIcon } from './icons'
import { useEscape } from './useEscape'
import { useT } from './i18n'

export function NewCardDialog({ close, plan, manual }: { close(): void; plan(): void; manual(): void }): React.JSX.Element {
  const { board: t, common } = useT()
  useEscape(close)
  return <div className="overlay" role="dialog" aria-label={t.newCard} onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}><div className="modal" style={{ width: 'min(520px,100%)' }}><header><div><div className="eyebrow">{t.newCard}</div><h2>{t.newCardDialog.title}</h2></div><button className="x" onClick={close} aria-label={common.close}>×</button></header>
    <div className="choices"><button type="button" className="choice" onClick={plan}><span className="cico plan"><SparkIcon /></span><b>{t.newCardDialog.planWithAgent}</b><small>{t.newCardDialog.planWithAgentHint}</small></button>
    <button type="button" className="choice" onClick={manual}><span className="cico"><HandIcon /></span><b>{t.newCardDialog.createManually}</b><small>{t.newCardDialog.createManuallyHint}</small></button></div></div></div>
}
