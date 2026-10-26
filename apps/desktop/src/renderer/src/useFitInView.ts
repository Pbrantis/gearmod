import { useLayoutEffect, type RefObject } from 'react'

/** Mantém um menu flutuante dentro da janela: se passar de uma borda, desloca só o que sobra (a posição original é refeita a cada renderização). */
export function useFitInView(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useLayoutEffect(() => {
    const element = ref.current
    if (!active || !element) return
    element.style.translate = ''
    const box = element.getBoundingClientRect(), margin = 8
    let dx = 0, dy = 0
    if (box.right > window.innerWidth - margin) dx = window.innerWidth - margin - box.right
    if (box.left + dx < margin) dx = margin - box.left
    if (box.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - box.bottom
    if (box.top + dy < margin) dy = margin - box.top
    if (dx || dy) element.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`
  })
}
