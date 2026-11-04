import React, { useEffect, useRef, useState } from 'react'
import type { AgentPurpose, ChatMessage } from '@gearmod/contracts'
import thinkingGif from './assets/thinking.gif'
import { tr, useT } from './i18n'

/** GearMod mascot "thinking" (animated GIF): shows the agent is working. */
export function ThinkingMascot({ size = 22 }: { size?: number }): React.JSX.Element {
  return <img className="mascot" src={thinkingGif} width={size} height={size} alt="" draggable={false} />
}

/** What the agent is doing now, based on the last tool used in this turn (after my last message). */
export function activityVerb(messages: ChatMessage[]): string | null {
  const lastUser = messages.map((item) => item.role).lastIndexOf('user')
  const tool = messages.slice(lastUser + 1).filter((item) => item.role === 'tool').at(-1)
  if (!tool) return null
  const name = tool.body.split('\n')[0]!.split(' ')[0]!.toLowerCase()
  const t = tr().shell.thinking
  if (['read', 'grep', 'glob', 'ls'].includes(name)) return t.readingProject
  if (['bash', 'comando'].includes(name)) return t.runningCommand
  if (['write', 'edit', 'multiedit', 'alterou', 'gearmod_write_document'].includes(name)) return t.writing
  if (['websearch', 'webfetch'].includes(name)) return t.searching
  if (name.startsWith('gearmod_')) return t.updatingCard
  return null
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000)), minutes = Math.floor(total / 60), seconds = total % 60
  return minutes ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
}

/** "Atom + verb + time" line while the agent works (like Claude Code and Codex). */
export function ThinkingIndicator({ purpose, messages, since }: { purpose: AgentPurpose | 'free'; messages: ChatMessage[]; since: number }): React.JSX.Element {
  const t = useT(), [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(id) }, [])
  const list = t.shell.thinking.verbs[purpose], elapsed = now - since
  const verb = activityVerb(messages) ?? list[Math.floor(elapsed / 3500) % list.length]!
  return <div className="thinking" role="status" aria-live="polite" aria-label={`${verb}, ${formatElapsed(elapsed)}`}><ThinkingMascot /><span className="tverb">{verb}…</span><span className="tmeta">{formatElapsed(elapsed)}</span></div>
}

/** Start of the current work (for the timer): uses the run's start time when known, otherwise the moment it became busy. */
export function useBusySince(busy: boolean, startedAt?: string): number {
  const ref = useRef(Date.now())
  const was = useRef(false)
  if (busy && !was.current) ref.current = startedAt ? Date.parse(startedAt) || Date.now() : Date.now()
  was.current = busy
  return ref.current
}

/** Shows the text gradually (typing effect): follows what arrives from the agent, faster when it is far behind. */
export function useTypewriter(target: string): string {
  const [shown, setShown] = useState(''), state = useRef({ target, count: 0 })
  state.current.target = target
  if (state.current.count > target.length) state.current.count = 0
  useEffect(() => {
    const id = window.setInterval(() => {
      const current = state.current
      if (current.count >= current.target.length) return
      current.count = Math.min(current.target.length, current.count + Math.max(1, Math.ceil((current.target.length - current.count) / 10)))
      setShown(current.target.slice(0, current.count))
    }, 28)
    return () => window.clearInterval(id)
  }, [])
  return target ? shown.slice(0, target.length) : ''
}
