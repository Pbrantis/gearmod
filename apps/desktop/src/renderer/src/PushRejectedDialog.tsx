import React, { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { useEscape } from './useEscape'
import { useT } from './i18n'

type Pull = 'ff' | 'rebase'

/**
 * Push recusado porque a branch remota tem commits que a local não tem (caso típico: amend de um commit já publicado).
 * Em vez de só avisar o erro, deixa escolher: trazer o remoto (Pull / Pull com rebase) ou sobrescrevê-lo (Forçar push).
 */
export function PushRejectedDialog({ branch, cancel, pull, force }: { branch: string; cancel(): void; pull(mode: Pull): void; force(): void }): React.JSX.Element {
  const { common, git: { pushRejected: t } } = useT()
  const [confirmForce, setConfirmForce] = useState(false)
  useEscape(cancel, !confirmForce)
  if (confirmForce) return <ConfirmDialog eyebrow={t.forceEyebrow} title={t.forceTitle} text={t.forceText(branch)} ok={t.forceOk} danger cancel={() => setConfirmForce(false)} confirm={force} />
  return <div className="overlay top" role="alertdialog" aria-label={t.aria} onMouseDown={(event) => { if (event.target === event.currentTarget) cancel() }}>
    <div className="modal pushrej">
      <header><div><div className="eyebrow">{t.eyebrow}</div><h2>{t.remoteAheadOf} {branch ? <code>{branch}</code> : t.thisBranch}</h2></div></header>
      <p className="pr-text">{t.text}</p>
      <div className="pr-options">
        <button type="button" className="pr-opt" onClick={() => pull('ff')}>
          <span className="pr-ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 3v10m0 0-4-4m4 4 4-4M4 17h12" /></svg></span>
          <span><b>{t.pullFfTitle}</b><small>{t.pullFfText}</small></span>
        </button>
        <button type="button" className="pr-opt" onClick={() => pull('rebase')}>
          <span className="pr-ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M6 3v9a3 3 0 0 0 3 3h5m0 0-3-3m3 3-3 3M6 3 3.5 5.5M6 3l2.5 2.5" /></svg></span>
          <span><b>{t.pullRebaseTitle}</b><small>{t.pullRebaseText}</small></span>
        </button>
        <button type="button" className="pr-opt danger" onClick={() => setConfirmForce(true)}>
          <span className="pr-ico" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 17V7m0 0-4 4m4-4 4 4M4 3h12" /></svg></span>
          <span><b>{t.forceOptionTitle}</b><small>{t.forceOptionText}</small></span>
        </button>
      </div>
      <div className="actions"><button type="button" className="secondary" onClick={cancel}>{common.cancel}</button></div>
    </div>
  </div>
}
