import type { DbActor, PgSession } from './pg-driver'
import type { DbConnection } from './connections'
import { tm } from '../i18n'

/** Uma abertura por id, mesmo quando vários painéis solicitam a conexão ao mesmo tempo. */
export class ConnectionManager {
  private readonly sessions = new Map<string, Promise<PgSession>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly states = new Map<string, 'connecting' | 'ready' | 'lost' | 'error'>()
  constructor(private readonly connections: { get(id: string): DbConnection; password(id: string): Promise<string | null> }, private readonly driver: { open(config: DbConnection, password: string | null, actor: DbActor): Promise<PgSession> }, private readonly idleMs = 600_000, private readonly reconnectDelayMs = 1000) {}
  open(id: string, actor: DbActor = { type: 'user' }): Promise<PgSession> {
    if (actor.type !== 'user') return Promise.reject(new Error(tm().db.agentAccessUnavailable))
    this.clearReconnect(id)
    const existing = this.sessions.get(id)
    if (existing) { this.touch(id); return existing }
    this.states.set(id, 'connecting')
    let promise!: Promise<PgSession>
    promise = (async () => { const config = this.connections.get(id), password = await this.connections.password(id); const session = await this.driver.open(config, password, actor); session.onLost?.(() => { if (this.sessions.get(id) === promise) { this.states.set(id, 'lost'); this.sessions.delete(id); this.clearTimer(id); void session.close().catch(() => undefined); this.scheduleReconnect(id) } }); if (this.sessions.get(id) === promise && this.states.get(id) !== 'lost') this.states.set(id, 'ready'); return session })()
    this.sessions.set(id, promise)
    void promise.catch(() => { if (this.sessions.get(id) === promise) { this.sessions.delete(id); this.clearTimer(id); this.states.set(id, 'error') } })
    this.touch(id)
    return promise
  }
  touch(id: string): void {
    this.clearTimer(id)
    if (!this.sessions.has(id)) return
    const timer = setTimeout(() => { void this.close(id) }, this.idleMs); timer.unref(); this.timers.set(id, timer)
  }
  active(id: string): Promise<PgSession> | undefined { return this.sessions.get(id) }
  state(id: string): 'disconnected' | 'connecting' | 'ready' | 'lost' | 'error' { return this.states.get(id) ?? 'disconnected' }
  async close(id: string): Promise<void> {
    this.clearReconnect(id)
    const pending = this.sessions.get(id); if (!pending) { this.states.delete(id); this.clearTimer(id); return }
    this.sessions.delete(id); this.clearTimer(id); this.states.delete(id)
    try { await (await pending).close() } catch { /* uma abertura que falhou já não tem sessão */ }
  }
  async closeAll(): Promise<void> { await Promise.all([...new Set([...this.sessions.keys(), ...this.reconnectTimers.keys()])].map((id) => this.close(id))) }
  private clearTimer(id: string): void { const timer = this.timers.get(id); if (timer) clearTimeout(timer); this.timers.delete(id) }
  private clearReconnect(id: string): void { const timer = this.reconnectTimers.get(id); if (timer) clearTimeout(timer); this.reconnectTimers.delete(id) }
  private scheduleReconnect(id: string): void {
    this.clearReconnect(id)
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(id)
      if (this.states.get(id) !== 'lost' || this.sessions.has(id)) return
      void this.open(id).catch(() => { if (!this.sessions.has(id) && this.states.get(id) === 'error') this.states.set(id, 'lost') })
    }, this.reconnectDelayMs)
    timer.unref(); this.reconnectTimers.set(id, timer)
  }
}
