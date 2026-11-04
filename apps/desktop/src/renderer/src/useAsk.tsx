import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

export interface AskOptions { eyebrow: string; title: string; text: string; ok: string; danger?: boolean }

/** Async confirmation with the app's `ConfirmDialog`: `if (!(await ask({...}))) return`. Render `dialog` somewhere in the component. */
export function useAsk(): { ask(options: AskOptions): Promise<boolean>; dialog: React.ReactNode } {
  const [pending, setPending] = useState<AskOptions & { resolve(value: boolean): void }>()
  const current = useRef<typeof pending>(undefined)
  current.current = pending
  const ask = useCallback((options: AskOptions): Promise<boolean> => new Promise((resolve) => { current.current?.resolve(false); setPending({ ...options, resolve }) }), [])
  useEffect(() => () => current.current?.resolve(false), [])
  const answer = (value: boolean): void => { pending?.resolve(value); setPending(undefined) }
  const cancel = useCallback(() => { current.current?.resolve(false); setPending(undefined) }, [])
  return { ask, dialog: pending ? <ConfirmDialog eyebrow={pending.eyebrow} title={pending.title} text={pending.text} ok={pending.ok} danger={pending.danger ?? false} cancel={cancel} confirm={() => answer(true)} /> : null }
}
