import type { PushedRunEvent } from '@gearmod/contracts'
import type { MutableRefObject } from 'react'

/** What a chat screen keeps about the run it is showing: its id and the last saved event already in the live text. */
export interface LiveRunRefs { runId: MutableRefObject<string | undefined>; seen: MutableRefObject<number> }

/**
 * Reconnects the chat to its run still in progress (left the chat and came back): adopts the run and shows the text streamed so far.
 * Returns whether there was a run. Deltas that arrive while this loads are already in the saved text; `seen` lets the listener skip them.
 */
export async function adoptLiveRun(chatId: string, refs: LiveRunRefs, setLive: (text: string) => void): Promise<boolean> {
  const live = await window.gearmod.invoke('runs:live', { chatId }).catch(() => null)
  if (!live) return false
  // The run may have changed while this loaded (another one started and already streams): keep that one.
  if (refs.runId.current && refs.runId.current !== live.runId && refs.seen.current < 0) return false
  refs.runId.current = live.runId; refs.seen.current = live.seq; setLive(live.text)
  return true
}

/** A new run starts: nothing from it has been seen yet. */
export function resetLiveRun(refs: LiveRunRefs, runId?: string): void { refs.runId.current = runId; refs.seen.current = -1 }

/** Text delta of the run being shown, or null if it is not one or was already in the reloaded text. */
export function liveDelta(event: PushedRunEvent, refs: LiveRunRefs): string | null {
  if (event.eventType !== 'item/agentMessage/delta' || event.runId !== refs.runId.current) return null
  if (typeof event.seq === 'number' && event.seq <= refs.seen.current) return null
  return String(event.payload.delta ?? '')
}
