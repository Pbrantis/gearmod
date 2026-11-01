import React from 'react'
import { ToastCard } from './ToastCard'
import { toast, useToasts } from './toasts'
import { useT } from './i18n'

/** Onde os avisos aparecem: canto inferior esquerdo, empilhados. Fica montado uma vez só, na raiz do app. */
export function ToastHost(): React.JSX.Element | null {
  const list = useToasts(), t = useT()
  if (!list.length) return null
  return <div className="toasthost" role="region" aria-label={t.shell.toast.containerLabel} aria-live="polite">
    {list.map((item) => <ToastCard key={item.id} kind={item.kind} title={item.title} message={item.message} meta={item.meta} duration={item.duration} paused={item.paused} onClose={() => toast.dismiss(item.id)} onHover={(inside) => toast.hold(item.id, inside)} />)}
  </div>
}
