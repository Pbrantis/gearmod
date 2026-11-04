import React from 'react'
import { useT } from './i18n'

/** The five toast types in the app. Every toast goes through `toast.<type>(...)` and is drawn by this component. */
export type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'notify'

const icons: Record<ToastKind, React.JSX.Element> = {
  success: <svg viewBox="0 0 20 20"><path d="m5 10.5 3.2 3.2L15 6.8" /></svg>,
  error: <svg viewBox="0 0 20 20"><path d="m6.5 6.5 7 7M13.5 6.5l-7 7" /></svg>,
  info: <svg viewBox="0 0 20 20"><path d="M10 9.2v4.6M10 6.3h.01" /></svg>,
  warning: <svg viewBox="0 0 20 20"><path d="M10 6v5M10 14h.01" /></svg>,
  notify: <svg viewBox="0 0 20 20"><path d="M5.5 14.5h9l-1.2-1.6V9.2a3.3 3.3 0 0 0-6.6 0v3.7zM8.6 16.2a1.5 1.5 0 0 0 2.8 0" /></svg>
}

export interface ToastCardProps {
  kind: ToastKind; title: string; message?: string
  /** Where it came from (e.g. repository · branch), in small text below. */
  meta?: string
  /** Time in ms until it disappears on its own: shows the timer bar. 0 or empty: stays until closed. */
  duration?: number
  /** Pauses the timer bar (mouse over). */
  paused?: boolean
  onClose?(): void
  onHover?(inside: boolean): void
}

/** Standard toast card (success, error, info, warning or notification). It is the only toast visual in the app. */
export function ToastCard({ kind, title, message, meta, duration = 0, paused = false, onClose, onHover }: ToastCardProps): React.JSX.Element {
  const t = useT()
  return <div className={`ntoast ${kind} ${paused ? 'paused' : ''}`} role={kind === 'error' || kind === 'warning' ? 'alert' : 'status'} aria-label={`${t.shell.toast.kinds[kind]}: ${title}`} onMouseEnter={onHover ? () => onHover(true) : undefined} onMouseLeave={onHover ? () => onHover(false) : undefined}>
    <span className="ntoast-ico" aria-hidden="true">{icons[kind]}</span>
    <div className="ntoast-body">
      <b>{title}</b>
      {message && <p>{message}</p>}
      {meta && <small>{meta}</small>}
    </div>
    {onClose && <button type="button" className="ntoast-x" aria-label={t.shell.toast.closeToast} onClick={onClose}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" /></svg></button>}
    {duration > 0 && <i className="ntoast-time" style={{ animationDuration: `${duration}ms` }} aria-hidden="true" />}
  </div>
}
