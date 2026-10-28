import { useSyncExternalStore } from 'react'
import type { ToastKind } from './ToastCard'

/** Aviso flutuante: sucesso, erro, informação, atenção ou notificação (algo que aconteceu por conta própria, como uma ação do agente). `duration` > 0: some sozinho depois desse tempo. */
export interface Toast { id: number; kind: ToastKind; title: string; message: string; meta: string; duration: number; paused: boolean }
export interface ToastOptions { meta?: string }

let state: Toast[] = []
const listeners = new Set<() => void>()
const clocks = new Map<number, { timer: number; startedAt: number; remaining: number }>()
let counter = 0
const set = (next: Toast[]): void => { state = next; listeners.forEach((listener) => listener()) }
const maxVisible = 4
// Todos somem sozinhos; erro, atenção e notificação ficam mais tempo, por serem mais importantes que um "deu certo". Com o mouse em cima o tempo para.
const lengths: Record<ToastKind, number> = { success: 5000, info: 4000, warning: 8000, notify: 6000, error: 10000 }

function arm(id: number, remaining: number): void {
  const timer = window.setTimeout(() => dismiss(id), remaining)
  clocks.set(id, { timer, startedAt: Date.now(), remaining })
}

function push(kind: Toast['kind'], title: string, message = '', options: ToastOptions = {}): number {
  const id = ++counter
  const dropped = state.length >= maxVisible ? state.slice(0, state.length - maxVisible + 1) : []
  dropped.forEach((item) => dismiss(item.id))
  set([...state.filter((item) => !dropped.includes(item)), { id, kind, title, message, meta: options.meta ?? '', duration: lengths[kind], paused: false }])
  // Some sozinho depois do tempo do tipo (a barra embaixo mostra); com o mouse em cima, pausa.
  if (lengths[kind]) arm(id, lengths[kind])
  return id
}

export function dismiss(id: number): void {
  const clock = clocks.get(id); if (clock) { window.clearTimeout(clock.timer); clocks.delete(id) }
  set(state.filter((item) => item.id !== id))
}

/** Com o mouse em cima, o tempo para (para dar tempo de ler); ao sair, continua de onde parou. */
function hold(id: number, paused: boolean): void {
  const clock = clocks.get(id)
  if (paused && clock) { window.clearTimeout(clock.timer); clock.remaining = Math.max(400, clock.remaining - (Date.now() - clock.startedAt)); clock.timer = 0 }
  else if (!paused && clock && !clock.timer) arm(id, clock.remaining)
  set(state.map((item) => (item.id === id ? { ...item, paused } : item)))
}

export const toast = {
  success: (title: string, message?: string, options?: ToastOptions): number => push('success', title, message, options),
  error: (title: string, message?: string, options?: ToastOptions): number => push('error', title, message, options),
  info: (title: string, message?: string, options?: ToastOptions): number => push('info', title, message, options),
  warning: (title: string, message?: string, options?: ToastOptions): number => push('warning', title, message, options),
  notify: (title: string, message?: string, options?: ToastOptions): number => push('notify', title, message, options),
  dismiss,
  hold,
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  snapshot: (): Toast[] => state
}

export const useToasts = (): Toast[] => useSyncExternalStore(toast.subscribe, toast.snapshot)
