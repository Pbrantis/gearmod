import { useSyncExternalStore } from 'react'

/** Um processo demorado (instalação, revisão de skill…) que continua rodando mesmo com o diálogo fechado. */
export interface BgTask { id: string; key: string; title: string; detail: string; state: 'running' | 'done' | 'failed'; startedAt: number; endedAt?: number; error?: string }

let state: BgTask[] = []
const listeners = new Set<() => void>()
let counter = 0
const set = (next: BgTask[]): void => { state = next; listeners.forEach((listener) => listener()) }
const patch = (id: string, change: Partial<BgTask>): void => set(state.map((item) => (item.id === id ? { ...item, ...change } : item)))
const text = (reason: unknown): string => String(reason instanceof Error ? reason.message : reason).replace(/^Error: /, '')

export const tasks = {
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  snapshot: (): BgTask[] => state,
  /** Começa a acompanhar um processo (se já houver um rodando com a mesma chave, devolve o dele). */
  begin(meta: { key?: string; title: string; detail?: string }): string {
    const key = meta.key ?? `task-${++counter}`
    const running = state.find((item) => item.key === key && item.state === 'running')
    if (running) return running.id
    const id = `bg-${++counter}`
    const created: BgTask = { id, key, title: meta.title, detail: meta.detail ?? '', state: 'running', startedAt: Date.now() }
    set([created, ...state.filter((item) => item.key !== key)].slice(0, 30))
    return id
  },
  end(id: string, error?: unknown): void { patch(id, error === undefined ? { state: 'done', endedAt: Date.now() } : { state: 'failed', endedAt: Date.now(), error: text(error) }) },
  /** Roda a operação acompanhando-a; o resultado (ou o erro) continua chegando a quem chamou. */
  track<T>(meta: { key?: string; title: string; detail?: string }, run: () => Promise<T>): { id: string; promise: Promise<T> } {
    const id = tasks.begin(meta)
    const promise = run().then((value) => { tasks.end(id); return value }, (reason: unknown) => { tasks.end(id, reason); throw reason })
    return { id, promise }
  },
  dismiss(id: string): void { set(state.filter((item) => item.id !== id)) },
  clearFinished(): void { set(state.filter((item) => item.state === 'running')) }
}

// A revisão de uma skill convertida roda no processo principal, sem nenhum diálogo aberto: acompanha pelos avisos dela.
if (typeof window !== 'undefined' && window.agentboard) {
  const reviews = new Map<string, string>()
  window.agentboard.onRunEvent((event) => {
    const name = String(event.payload.name ?? '')
    if (event.eventType === 'skills/review-started') reviews.set(name, tasks.begin({ key: `skill-review:${name}`, title: `Revisar a skill ${name}`, detail: 'Um agente confere se a conversão ficou completa' }))
    else if (event.eventType === 'skills/review-finished' && reviews.has(name)) { tasks.end(reviews.get(name)!); reviews.delete(name) }
    else if (event.eventType === 'skills/review-failed' && reviews.has(name)) { tasks.end(reviews.get(name)!, event.payload.error ?? 'A revisão falhou'); reviews.delete(name) }
  })
}

export const useTasks = (): BgTask[] => useSyncExternalStore(tasks.subscribe, tasks.snapshot)
