import React, { useEffect, useRef, useState } from 'react'
import { providerLabels, type AgentProfile } from '@gearmod/contracts'
import { useT } from './i18n'
import { useEscape } from './useEscape'
import { plainError } from './NoticeDialog'
import { TerminalBox } from './TerminalBox'
import { watchLogin } from './agentLogin'

/**
 * Connects the agent's account inside the app: runs the CLI login in a mini terminal (the browser opens by itself) and checks
 * from time to time whether the account connected. Once connected, closes and calls `connected`.
 */
export function AgentLoginDialog({ profile, close, connected }: { profile: AgentProfile; close(): void; connected(): void }): React.JSX.Element {
  const t = useT(), tl = t.settings.agentLogin
  const [terminalId, setTerminalId] = useState<string>(), [error, setError] = useState(''), [ended, setEnded] = useState(false), [minimized, setMinimized] = useState(true), [expanded, setExpanded] = useState(false), [attempt, setAttempt] = useState(0)
  const watcher = useRef<ReturnType<typeof watchLogin> | null>(null), current = useRef<string | undefined>(undefined), done = useRef(connected)
  done.current = connected
  const kill = (): void => { const id = current.current; current.current = undefined; if (id) void window.gearmod.invoke('terminal:kill', { id }).catch(() => undefined) }
  useEffect(() => {
    let alive = true
    setError(''); setEnded(false); setTerminalId(undefined)
    void window.gearmod.invoke('profiles:login-terminal', { profileId: profile.id }).then(({ id }) => { if (!alive) { void window.gearmod.invoke('terminal:kill', { id }).catch(() => undefined); return } current.current = id; setTerminalId(id) }).catch((reason) => { if (alive) setError(plainError(reason)) })
    const watch = watchLogin({ probe: async () => (await window.gearmod.invoke('profiles:probe', { profileId: profile.id })).authenticated, connected: () => { kill(); done.current() } })
    watcher.current = watch
    return () => { alive = false; watch.stop(); kill() }
  }, [profile.id, attempt])
  const cancel = (): void => { watcher.current?.stop(); kill(); close() }
  useEscape(cancel)
  const name = providerLabels[profile.provider]
  return <div className="overlay top" role="dialog" aria-label={tl.title(name)}><div className="modal" style={{ width: expanded ? 'min(860px,100%)' : 'min(560px,100%)' }}>
    <header><div><div className="eyebrow">{t.common.agent}</div><h2>{tl.title(name)}</h2></div><button className="x" onClick={cancel} aria-label={t.common.close}>×</button></header>
    <div className="stack">
      <p className="dialog-text">{ended ? tl.ended : tl.intro}</p>
      {!ended && !error && <div role="status" className="agent-login-wait"><span className="hint">{tl.waiting}</span><div className="bar" aria-hidden="true"><i /></div></div>}
      {terminalId && <TerminalBox id={terminalId} label={tl.terminal} minimized={minimized} setMinimized={setMinimized} expanded={expanded} setExpanded={setExpanded} exited={() => { setEnded(true); void watcher.current?.checkNow() }} />}
      {error && <p className="error" style={{ overflowWrap: 'anywhere' }}>{error}</p>}
    </div>
    <div className="actions"><button type="button" className="secondary" onClick={cancel}>{t.common.cancel}</button>{(ended || error) && <button type="button" onClick={() => { kill(); setAttempt(attempt + 1) }}>{tl.retry}</button>}</div>
  </div></div>
}
