import { useEffect, useRef } from 'react'

// Pilha de quem escuta Esc: só o último a abrir (o de cima) reage, para não fechar também o que está por trás.
const stack: Array<{ close(): void }> = []
const onKey = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return
  const top = stack[stack.length - 1]
  if (!top) return
  event.stopImmediatePropagation(); top.close()
}

/** Fecha o diálogo ou menu com Esc, parando a propagação. `enabled=false` não escuta (diálogo condicional). Esc nunca confirma. */
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
