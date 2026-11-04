import React, { useEffect } from 'react'
import { useEscape } from './useEscape'
import { tr, useT } from './i18n'

/** Notice in front of everything (a single button): to explain why an action was not done, or what happened behind the scenes. */
export function NoticeDialog({ eyebrow, title, text, ok, close }: { eyebrow: string; title: string; text: string; ok?: string; close(): void }): React.JSX.Element {
  const t = useT()
  useEscape(close)
  useEffect(() => { const key = (event: KeyboardEvent): void => { if (event.key === 'Enter') { event.stopPropagation(); close() } }; document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true) }, [close])
  return <div className="overlay top" role="alertdialog" aria-label={title} style={{ zIndex: 90 }}><div className="modal" style={{ width: 'min(430px,100%)' }}><header><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div></header><p className="dialog-text">{text}</p><div className="actions"><button type="button" autoFocus onClick={close}>{ok ?? t.shell.notice.understood}</button></div></div></div>
}

/** Strips Electron's technical prefix from the main process error messages. */
export const plainError = (reason: unknown): string => {
  let message = String(reason)
  for (let index = 0; index < 3; index += 1) message = message.replace(/^Error:\s*/i, '').replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
  return zodText(message) ?? (message || tr().shell.notice.operationFailed)  // the `[[...]]` code stays: whoever needs it reads it with errorCodeOf and the screen strips it with withoutErrorCode
}

/** Contract validation error (Zod JSON list) becomes text: "field: what is missing", one per line. */
function zodText(message: string): string | undefined {
  // Zod formats the list with line breaks: "[\n  {".
  const start = message.search(/\[\s*\{/)
  if (start < 0) return undefined
  let issues: unknown
  try { issues = JSON.parse(message.slice(start)) } catch { return undefined }
  if (!Array.isArray(issues) || !issues.length || !issues.every((item) => item && typeof item === 'object' && 'code' in item && 'path' in item)) return undefined
  const n = tr().shell.notice
  const lines = (issues as Array<{ code: string; path: unknown[]; minimum?: number | bigint; maximum?: number | bigint; origin?: string }>).map((issue) => {
    const field = issue.path.filter((part) => typeof part === 'string').join(' › ')
    const what = issue.code === 'too_small' ? (Number(issue.minimum) <= 1 && issue.origin === 'string' ? n.fieldRequired : n.fieldTooShort(Number(issue.minimum))) : issue.code === 'too_big' ? n.fieldTooLong(Number(issue.maximum)) : issue.code === 'invalid_type' && issue.path.length ? n.fieldRequired : n.fieldInvalid
    return field ? `${field}: ${what}` : what
  })
  return `${n.invalidFields}\n${[...new Set(lines)].join('\n')}`
}
