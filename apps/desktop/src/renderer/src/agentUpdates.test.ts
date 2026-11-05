import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PushedRunEvent } from '@gearmod/contracts'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

async function load(): Promise<{ emit(event: PushedRunEvent): void; invoke: ReturnType<typeof vi.fn>; updates: typeof import('./agentUpdates'); tasks: typeof import('./backgroundTasks').tasks }> {
  const listeners = new Set<(event: PushedRunEvent) => void>()
  const invoke = vi.fn(async () => ({ id: 'term-1' }))
  vi.stubGlobal('window', { setTimeout, clearTimeout, dispatchEvent: () => true, gearmod: { invoke, onRunEvent: (listener: (event: PushedRunEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener) } } })
  const updates = await import('./agentUpdates'), { tasks } = await import('./backgroundTasks')
  return { emit: (event) => [...listeners].forEach((listener) => listener(event)), invoke, updates, tasks }
}

describe('startAgentUpdate', () => {
  it('follows the update in the process list and finishes it when the command exits well', async () => {
    const { emit, invoke, updates, tasks } = await load()
    const first = await updates.startAgentUpdate('codex', 'Codex')
    expect(invoke).toHaveBeenCalledWith('profiles:update-terminal', { provider: 'codex' })
    expect(await updates.startAgentUpdate('codex', 'Codex')).toEqual(first)
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(tasks.snapshot().find((task) => task.id === first.taskId)?.state).toBe('running')
    emit({ runId: '', eventType: 'gearmod/terminal-exit', payload: { id: 'term-1', code: 0 } })
    expect(tasks.snapshot().find((task) => task.id === first.taskId)?.state).toBe('done')
  })

  it('marks the update as failed when the command ends with an error code', async () => {
    const { emit, updates, tasks } = await load()
    const update = await updates.startAgentUpdate('claude', 'Claude')
    emit({ runId: '', eventType: 'gearmod/terminal-exit', payload: { id: 'other', code: 0 } })
    expect(tasks.snapshot().find((task) => task.id === update.taskId)?.state).toBe('running')
    emit({ runId: '', eventType: 'gearmod/terminal-exit', payload: { id: 'term-1', code: 1 } })
    const task = tasks.snapshot().find((item) => item.id === update.taskId)
    expect(task?.state).toBe('failed'); expect(task?.error).toContain('1')
  })
})
