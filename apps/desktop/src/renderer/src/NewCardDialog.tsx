import React, { useEffect } from 'react'
import { HandIcon, SparkIcon } from './icons'

export function NewCardDialog({ close, plan, manual }: { close(): void; plan(): void; manual(): void }): React.JSX.Element {
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key) }, [close])
  return <div className="overlay" role="dialog" aria-label="Novo card" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}><div className="modal" style={{ width: 'min(520px,100%)' }}><header><div><div className="eyebrow">Novo card</div><h2>Como você quer criar?</h2></div><button className="x" onClick={close} aria-label="Fechar">×</button></header>
    <div className="choices"><button type="button" className="choice" onClick={plan}><span className="cico plan"><SparkIcon /></span><b>Planejar com agente</b><small>Converse com o agente sobre o contexto do projeto. Ele faz as perguntas e monta o card.</small></button>
    <button type="button" className="choice" onClick={manual}><span className="cico"><HandIcon /></span><b>Criar na mão</b><small>Descreva tudo no próprio card, sem precisar de um agente.</small></button></div></div></div>
}
