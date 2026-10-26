import { useEffect, useRef, type RefObject } from 'react'

/**
 * Mantém a lista rolada até o fim enquanto o conteúdo cresce (texto do agente chegando, ações, perguntas que mudam de altura).
 * Se a pessoa rola para cima para ler, para de acompanhar; ao voltar perto do fim, volta a acompanhar.
 */
export function useStickToBottom(log: RefObject<HTMLElement | null>): void {
  const stick = useRef(true), bound = useRef<HTMLElement | null>(null), cleanup = useRef<(() => void) | null>(null)
  // Roda a cada render porque a lista pode montar depois (troca de chat/visão); só reata quando o elemento muda.
  useEffect(() => {
    const el = log.current
    if (el === bound.current) return
    cleanup.current?.(); bound.current = el; cleanup.current = null
    if (!el) return
    const toEnd = (): void => { if (stick.current) el.scrollTop = el.scrollHeight }
    const onScroll = (): void => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }
    const mutations = new MutationObserver(() => requestAnimationFrame(toEnd))
    mutations.observe(el, { childList: true, subtree: true, characterData: true })
    const resize = new ResizeObserver(() => requestAnimationFrame(toEnd))
    resize.observe(el)
    el.addEventListener('scroll', onScroll, { passive: true })
    stick.current = true; toEnd()
    cleanup.current = () => { mutations.disconnect(); resize.disconnect(); el.removeEventListener('scroll', onScroll) }
  })
  useEffect(() => () => cleanup.current?.(), [])
}
