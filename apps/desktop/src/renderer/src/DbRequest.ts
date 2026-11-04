import { useEffect, useRef, useState } from 'react'

/** One query at a time in each window: starting another cancels the previous one, and closing the window cancels the pending one. */
export function useDbRequest(connectionId: string): { busy: boolean; requestId: string | undefined; error: string; setError(value: string): void; start(): string; finish(id: string): void; current(id: string): boolean; cancel(): void } {
  const active = useRef<string | undefined>(undefined), [busy, setBusy] = useState(false), [requestId, setRequestId] = useState<string>(), [error, setError] = useState('')
  const abort = (id: string | undefined): void => { if (id) void window.gearmod.invoke('db:cancel', { connectionId, requestId: id }).catch(() => undefined) }
  const start = (): string => { abort(active.current); const id = crypto.randomUUID(); active.current = id; setRequestId(id); setBusy(true); setError(''); return id }
  const finish = (id: string): void => { if (active.current === id) { active.current = undefined; setBusy(false); setRequestId(undefined) } }
  useEffect(() => () => abort(active.current), [])
  return { busy, requestId, error, setError, start, finish, current: (id) => active.current === id, cancel: () => abort(active.current) }
}
