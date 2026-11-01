import { expect, it, vi } from 'vitest'
import { ConnectionManager } from './connection-manager'
import type { DbConnection } from './connections'
import type { PgSession } from './pg-driver'
it('abre uma única sessão por conexão e recusa agente sem reutilizá-la', async () => {
  const session = { close: vi.fn(async () => undefined) } as unknown as PgSession
  const config = { id: 'x' } as DbConnection
  const driver = { open: vi.fn(async () => session) }
  const manager = new ConnectionManager({ get: () => config, password: async () => null }, driver)
  const [a, b] = await Promise.all([manager.open('x'), manager.open('x')])
  expect(a).toBe(b); expect(driver.open).toHaveBeenCalledTimes(1)
  await expect(manager.open('x', { type: 'agent', cardId: 'card' })).rejects.toThrow('agente')
  await manager.closeAll(); expect(session.close).toHaveBeenCalledTimes(1)
})
it('informa perda e abre nova sessão na reconexão', async () => {
  let lost: (() => void) | undefined
  const session = { close: vi.fn(async () => undefined), onLost: (callback: () => void) => { lost = callback } } as unknown as PgSession
  const driver = { open: vi.fn(async () => session) }, config = { id: 'x' } as DbConnection
  const manager = new ConnectionManager({ get: () => config, password: async () => null }, driver)
  await manager.open('x'); expect(manager.state('x')).toBe('ready')
  lost?.(); expect(manager.state('x')).toBe('lost')
  await manager.open('x'); expect(manager.state('x')).toBe('ready'); expect(driver.open).toHaveBeenCalledTimes(2)
  await manager.closeAll()
})
it('reconecta uma vez após espera, sem executar consultas novamente', async () => {
  vi.useFakeTimers()
  try {
    let lost: (() => void) | undefined
    const first = { close: vi.fn(async () => undefined), onLost: (callback: () => void) => { lost = callback } } as unknown as PgSession
    const second = { close: vi.fn(async () => undefined), onLost: vi.fn() } as unknown as PgSession
    const driver = { open: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) }
    const manager = new ConnectionManager({ get: () => ({ id: 'x' } as DbConnection), password: async () => null }, driver, 600_000, 1000)
    await manager.open('x'); lost?.()
    expect(manager.state('x')).toBe('lost')
    await vi.advanceTimersByTimeAsync(999); expect(driver.open).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1); expect(driver.open).toHaveBeenCalledTimes(2); expect(manager.state('x')).toBe('ready')
    await vi.advanceTimersByTimeAsync(2000); expect(driver.open).toHaveBeenCalledTimes(2)
    await manager.closeAll()
  } finally { vi.useRealTimers() }
})
it('deixa a conexão perdida após tentativa automática falhar e respeita fechamento explícito', async () => {
  vi.useFakeTimers()
  try {
    let lost: (() => void) | undefined
    const first = { close: vi.fn(async () => undefined), onLost: (callback: () => void) => { lost = callback } } as unknown as PgSession
    const driver = { open: vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('offline')) }
    const manager = new ConnectionManager({ get: () => ({ id: 'x' } as DbConnection), password: async () => null }, driver, 600_000, 1000)
    await manager.open('x'); lost?.(); await vi.advanceTimersByTimeAsync(1000)
    expect(driver.open).toHaveBeenCalledTimes(2); expect(manager.state('x')).toBe('lost')
    await vi.advanceTimersByTimeAsync(3000); expect(driver.open).toHaveBeenCalledTimes(2)
    await manager.close('x'); expect(manager.state('x')).toBe('disconnected')
    const another = { close: vi.fn(async () => undefined), onLost: (callback: () => void) => { lost = callback } } as unknown as PgSession
    driver.open.mockResolvedValueOnce(another)
    await manager.open('x'); lost?.(); await manager.close('x'); await vi.advanceTimersByTimeAsync(1000)
    expect(driver.open).toHaveBeenCalledTimes(3); expect(manager.state('x')).toBe('disconnected')
    await manager.closeAll()
  } finally { vi.useRealTimers() }
})
