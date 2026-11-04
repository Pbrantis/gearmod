import { useSyncExternalStore } from 'react'
import { toast } from './toasts'
import { tr } from './i18n'

/** A long-running process (install, skill review…) that keeps running even with the dialog closed. */
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
  /** Starts tracking a process (if one is already running with the same key, returns it). */
  begin(meta: { key?: string; title: string; detail?: string }): string {
    const key = meta.key ?? `task-${++counter}`
    const running = state.find((item) => item.key === key && item.state === 'running')
    if (running) return running.id
    const id = `bg-${++counter}`
    const created: BgTask = { id, key, title: meta.title, detail: meta.detail ?? '', state: 'running', startedAt: Date.now() }
    set([created, ...state.filter((item) => item.key !== key)].slice(0, 30))
    return id
  },
  end(id: string, error?: unknown): void {
    const task = state.find((item) => item.id === id)
    patch(id, error === undefined ? { state: 'done', endedAt: Date.now() } : { state: 'failed', endedAt: Date.now(), error: text(error) })
    if (task?.state !== 'running') return
    if (error === undefined) toast.success(tr().shell.tasks.completed(task.title), task.detail || undefined); else toast.error(tr().shell.tasks.failedTitle(task.title), text(error))
  },
  /** Runs the operation while tracking it; the result (or error) still reaches the caller. */
  track<T>(meta: { key?: string; title: string; detail?: string }, run: () => Promise<T>): { id: string; promise: Promise<T> } {
    const id = tasks.begin(meta)
    const promise = run().then((value) => { tasks.end(id); return value }, (reason: unknown) => { tasks.end(id, reason); throw reason })
    return { id, promise }
  },
  dismiss(id: string): void { set(state.filter((item) => item.id !== id)) },
  clearFinished(): void { set(state.filter((item) => item.state === 'running')) }
}

// A converted skill's review runs in the main process, with no dialog open: follow it through its toasts.
if (typeof window !== 'undefined' && window.gearmod) {
  const reviews = new Map<string, string>()
  window.gearmod.onRunEvent((event) => {
    const name = String(event.payload.name ?? '')
    if (event.eventType === 'skills/review-started') reviews.set(name, tasks.begin({ key: `skill-review:${name}`, title: tr().shell.tasks.reviewSkill(name), detail: tr().shell.tasks.reviewSkillDetail }))
    else if (event.eventType === 'skills/review-finished' && reviews.has(name)) { tasks.end(reviews.get(name)!); reviews.delete(name) }
    else if (event.eventType === 'skills/review-failed' && reviews.has(name)) { tasks.end(reviews.get(name)!, event.payload.error ?? tr().shell.tasks.reviewFailed); reviews.delete(name) }
  })
}

export const useTasks = (): BgTask[] => useSyncExternalStore(tasks.subscribe, tasks.snapshot)
