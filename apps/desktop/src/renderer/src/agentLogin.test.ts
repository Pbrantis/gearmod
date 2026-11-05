import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shouldInviteAgent, watchLogin } from './agentLogin'

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', globalThis) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('watchLogin', () => {
  it('checks on each tick and stops once the account connects', async () => {
    let calls = 0
    const connected = vi.fn()
    watchLogin({ probe: async () => ++calls >= 3, connected, interval: 1000 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(connected).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connected).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toBe(3); expect(connected).toHaveBeenCalledTimes(1)
  })

  it('treats a failed check as not connected yet and never runs two checks at once', async () => {
    let active = 0, peak = 0, calls = 0
    const connected = vi.fn()
    const watcher = watchLogin({ probe: async () => { active++; peak = Math.max(peak, active); calls++; await new Promise((resolve) => setTimeout(resolve, 2500)); active--; if (calls === 1) throw new Error('timeout'); return true }, connected, interval: 1000 })
    void watcher.checkNow()
    await vi.advanceTimersByTimeAsync(2600)
    expect(connected).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(peak).toBe(1); expect(connected).toHaveBeenCalledTimes(1)
  })

  it('does nothing after stop', async () => {
    const probe = vi.fn(async () => true), connected = vi.fn()
    watchLogin({ probe, connected, interval: 1000 }).stop()
    await vi.advanceTimersByTimeAsync(3000)
    expect(probe).not.toHaveBeenCalled(); expect(connected).not.toHaveBeenCalled()
  })
})

describe('shouldInviteAgent', () => {
  it('invites only on the first visit to a project when there is no agent', () => {
    expect(shouldInviteAgent({ projectId: 'p1', agentCount: 0, seen: [], busy: false })).toBe(true)
    expect(shouldInviteAgent({ projectId: 'p1', agentCount: 0, seen: ['p1'], busy: false })).toBe(false)
    expect(shouldInviteAgent({ projectId: 'p1', agentCount: 1, seen: [], busy: false })).toBe(false)
    expect(shouldInviteAgent({ projectId: 'p1', agentCount: 0, seen: [], busy: true })).toBe(false)
    expect(shouldInviteAgent({ projectId: undefined, agentCount: 0, seen: [], busy: false })).toBe(false)
  })
})
