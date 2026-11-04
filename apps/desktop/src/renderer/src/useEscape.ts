import { useEffect, useRef } from 'react'

// Stack of Esc listeners: only the last one to open (the top one) reacts, so the one behind it does not close too.
const stack: Array<{ close(): void }> = []
const onKey = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return
  const top = stack[stack.length - 1]
  if (!top) return
  event.stopImmediatePropagation(); top.close()
}

/** Closes the dialog or menu with Esc, stopping propagation. `enabled=false` does not listen (conditional dialog). Esc never confirms. */
export function useEscape(close: () => void, enabled = true): void {
  const entry = useRef({ close })
  entry.current.close = close
  useEffect(() => {
    if (!enabled) return
    const item = entry.current
    if (!stack.length) document.addEventListener('keydown', onKey, true)
    stack.push(item)
    return () => { stack.splice(stack.indexOf(item), 1); if (!stack.length) document.removeEventListener('keydown', onKey, true) }
  }, [enabled])
}
