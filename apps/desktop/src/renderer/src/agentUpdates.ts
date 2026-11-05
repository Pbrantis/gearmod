import { tasks } from './backgroundTasks'
import { tr } from './i18n'

export type UpdatableProvider = 'codex' | 'claude' | 'gemini'
export interface RunningUpdate { terminalId: string; taskId: string }

/** Fired on `window` when an agent CLI update terminal exits, so whatever shows installed versions can probe again. */
export const agentUpdateFinishedEvent = 'gearmod:agent-update-finished'

const running = new Map<UpdatableProvider, RunningUpdate>()

/** Exit code of the update command → `undefined` when it worked, or the error text for the process list. */
export function updateOutcome(code: number): string | undefined { return code === 0 ? undefined : tr().settings.agentUpdate.exitCode(code) }

/**
 * Starts the agent CLI update in an app terminal and follows it in the process list (title bar), so the dialog can be closed
 * and the update goes on in the background. A second click while it runs returns the same update.
 */
export async function startAgentUpdate(provider: UpdatableProvider, name: string): Promise<RunningUpdate> {
  const current = running.get(provider)
  if (current) return current
  const { id } = await window.gearmod.invoke('profiles:update-terminal', { provider })
  const taskId = tasks.begin({ key: `agent-update:${provider}`, title: tr().settings.agentUpdate.taskTitle(name) })
  const entry = { terminalId: id, taskId }
  running.set(provider, entry)
  const stop = window.gearmod.onRunEvent((event) => {
    if (event.eventType !== 'gearmod/terminal-exit' || String(event.payload.id ?? '') !== id) return
    stop(); running.delete(provider)
    tasks.end(taskId, updateOutcome(Number(event.payload.code ?? 0)))
    window.dispatchEvent(new Event(agentUpdateFinishedEvent))  // the Settings gear dot checks the installed versions again
  })
  return entry
}
