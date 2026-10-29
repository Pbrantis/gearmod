import React, { useEffect, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

type Pull = 'ff' | 'rebase'

/**
 * Push recusado porque a branch remota tem commits que a local não tem (caso típico: amend de um commit já publicado).
 * Em vez de só avisar o erro, deixa escolher: trazer o remoto (Pull / Pull com rebase) ou sobrescrevê-lo (Forçar push).
 */
export function PushRejectedDialog({ branch, cancel, pull, force }: { branch: string; cancel(): void; pull(mode: Pull): void; force(): void }): React.JSX.Element {
  const [confirmForce, setConfirmForce] = useState(false)
  useEffect(() => { if (confirmForce) return; const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); cancel() } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [cancel, confirmForce])
  if (confirmForce) return <ConfirmDialog eyebrow="Forçar push" title="Tem certeza de que deseja forçar o push?" text={`A branch remota${branch ? ` ${branch}` : ''} será substituída pela sua versão local. Commits que existem apenas no remoto podem ser perdidos. O Git recusará a operação se o remoto tiver mudado desde o último fetch.`} ok="Forçar push" danger cancel={() => setConfirmForce(false)} confirm={force} />
  return <div className="overlay top" role="alertdialog" aria-label="Push recusado" onMouseDown={(event) => { if (event.target === event.currentTarget) cancel() }}>
    <div className="modal pushrej">
      <header><div><div className="eyebrow">Push recusado</div><h2>O remoto está à frente de {branch ? <code>{branch}</code> : 'esta branch'}</h2></div></header>
      <p className="pr-text">O servidor tem commits que a sua branch não tem. Isso acontece quando outra pessoa publicou antes, ou quando você refez um commit já publicado (amend, rebase). Como quer resolver?</p>
      <div className="pr-options">
        <button type="button" className="pr-opt" onClick={() => pull('ff')}>
          <span className="pr-ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 3v10m0 0-4-4m4 4 4-4M4 17h12" /></svg></span>
          <span><b>Pull (avançar se der)</b><small>Traz os commits do remoto para a sua branch. Depois é só publicar de novo.</small></span>
        </button>
        <button type="button" className="pr-opt" onClick={() => pull('rebase')}>
          <span className="pr-ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M6 3v9a3 3 0 0 0 3 3h5m0 0-3-3m3 3-3 3M6 3 3.5 5.5M6 3l2.5 2.5" /></svg></span>
          <span><b>Pull com rebase</b><small>Reaplica os seus commits por cima do que veio do remoto, mantendo o histórico reto.</small></span>
        </button>
        <button type="button" className="pr-opt danger" onClick={() => setConfirmForce(true)}>
          <span className="pr-ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 17V7m0 0-4 4m4-4 4 4M4 3h12" /></svg></span>
          <span><b>Forçar push</b><small>Substitui a branch remota pela sua. Use depois de um amend. Descarta commits do remoto que você não tem, mas recusa se alguém publicou algo novo desde o seu último fetch.</small></span>
        </button>
      </div>
      <div className="actions"><button type="button" className="secondary" onClick={cancel}>Cancelar</button></div>
    </div>
  </div>
}
