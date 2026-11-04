import { useEffect, useRef, type RefObject } from 'react'

/**
 * Keeps the list scrolled to the end while the content grows (agent text arriving, actions, questions that change height).
 * If the user scrolls up to read, it stops following; when they return near the end, it follows again.
 */
export function useStickToBottom(log: RefObject<HTMLElement | null>): void {
  const stick = useRef(true), bound = useRef<HTMLElement | null>(null), cleanup = useRef<(() => void) | null>(null)
  // Runs on every render because the list may mount later (chat/view switch); only reattaches when the element changes.
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
