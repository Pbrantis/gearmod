import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

const gap = 6, margin = 8, delayMs = 300

/**
 * Tooltip único do app para todo elemento com `data-tip`. Posiciona pelo retângulo real do elemento (em cima; embaixo se não couber)
 * e mantém o balão dentro da janela. Substitui os `::after` do CSS, que saíam no lugar errado conforme o elemento pai.
 */
export function TooltipLayer(): React.JSX.Element | null {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect }>(), [pos, setPos] = useState<{ left: number; top: number }>()
  const box = useRef<HTMLDivElement>(null), timer = useRef<number>(undefined), current = useRef<Element | null>(null)
  useEffect(() => {
    const hide = (): void => { window.clearTimeout(timer.current); current.current = null; setTip(undefined); setPos(undefined) }
    const show = (event: Event): void => {
      const target = (event.target as Element | null)?.closest?.('[data-tip]')
      if (!target || target === current.current) return
      const text = target.getAttribute('data-tip')
      hide()
      if (!text) return
      current.current = target
      timer.current = window.setTimeout(() => { if (current.current === target && target.isConnected) setTip({ text, rect: target.getBoundingClientRect() }) }, delayMs)
    }
    const leave = (event: Event): void => {
      const to = (event as PointerEvent | FocusEvent).relatedTarget as Element | null
      if (current.current && (!to || !current.current.contains(to))) hide()
    }
    document.addEventListener('pointerover', show); document.addEventListener('pointerout', leave)
    document.addEventListener('focusin', show); document.addEventListener('focusout', leave)
    document.addEventListener('pointerdown', hide, true); document.addEventListener('wheel', hide, { passive: true }); window.addEventListener('blur', hide)
    return () => {
      hide()
      document.removeEventListener('pointerover', show); document.removeEventListener('pointerout', leave)
      document.removeEventListener('focusin', show); document.removeEventListener('focusout', leave)
      document.removeEventListener('pointerdown', hide, true); document.removeEventListener('wheel', hide); window.removeEventListener('blur', hide)
    }
  }, [])
  // Mede o balão depois de renderizar e escolhe o lado que cabe, centralizado no elemento e preso dentro da janela.
  useLayoutEffect(() => {
    if (!tip || !box.current) return
    const { width, height } = box.current.getBoundingClientRect(), { rect } = tip
    const above = rect.top - gap - height, below = rect.bottom + gap
    const titlebar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--titlebar')) || 0
    const top = above >= titlebar + margin || below + height > window.innerHeight - margin ? Math.max(margin, above) : below
    const left = Math.min(Math.max(margin, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - margin)
    setPos({ left, top })
  }, [tip])
  if (!tip) return null
  return <div ref={box} className="tooltip" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}>{tip.text}</div>
}
