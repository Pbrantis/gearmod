/**
 * Checks from time to time whether the agent's account connected, while the login runs in the app terminal.
 * One check at a time; `checkNow` asks for one right away (e.g. when the login program ends). Stops by itself once connected.
 */
export function watchLogin(options: { probe(): Promise<boolean>; connected(): void; interval?: number }): { checkNow(): Promise<void>; stop(): void } {
  let stopped = false, running = false, again = false
  const check = async (): Promise<void> => {
    if (stopped) return
    if (running) { again = true; return }
    running = true
    try {
      // A failed check (CLI busy, timeout) is just one more attempt: the next one runs on the next tick.
      const ok = await options.probe().catch(() => false)
      if (ok && !stopped) { stopped = true; window.clearInterval(timer); options.connected() }
    } finally {
      running = false
      if (again && !stopped) { again = false; void check() }
    }
  }
  const timer = window.setInterval(() => { void check() }, options.interval ?? 3000)
  return { checkNow: check, stop: () => { stopped = true; window.clearInterval(timer) } }
}

const seenKey = 'gearmod.agentInviteSeen'

/** First visit to a project with no agent registered: invites the user to add one (once per project). */
export function shouldInviteAgent(input: { projectId: string | undefined; agentCount: number; seen: readonly string[]; busy: boolean }): boolean {
  return Boolean(input.projectId) && input.agentCount === 0 && !input.busy && !input.seen.includes(input.projectId!)
}

export function readInviteSeen(): string[] {
  try { const value = JSON.parse(localStorage.getItem(seenKey) ?? '[]') as unknown; return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] }
}

export function markInviteSeen(projectId: string): void {
  try { localStorage.setItem(seenKey, JSON.stringify([...readInviteSeen().filter((item) => item !== projectId), projectId].slice(-200))) } catch { /* no storage: may invite again next time */ }
}
