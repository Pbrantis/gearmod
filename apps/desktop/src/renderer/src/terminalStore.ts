import { useSyncExternalStore } from 'react'
import { plainError } from './NoticeDialog'
import { tr } from './i18n'
import { popoutParams } from './popout'

export interface TerminalTab { id: string; title: string; cwd: string; text: string; exited: boolean; shell: string; seq: number }
interface TerminalState { open: boolean; tabs: TerminalTab[]; active: string | null; context: { projectId: string; cardId: string | null } | null; error: string }

const maxText = 300_000
let state: TerminalState = { open: false, tabs: [], active: null, context: null, error: '' }
const listeners = new Set<() => void>()
const set = (next: Partial<TerminalState>): void => { state = { ...state, ...next }; listeners.forEach((listener) => listener()) }
const patchTab = (id: string, change: (tab: TerminalTab) => TerminalTab): void => set({ tabs: state.tabs.map((tab) => (tab.id === id ? change(tab) : tab)) })
const append = (tab: TerminalTab, data: string): TerminalTab => { const text = tab.text + data; return { ...tab, text: text.length > maxText ? text.slice(text.length - maxText) : text } }
let counter = 0
const handOffKey = 'gearmod.terminalHandOff'
const early = new Map<string, Array<{ data: string; seq: number }>>()

if (typeof window !== 'undefined' && window.gearmod) window.gearmod.onRunEvent((event) => {
  const id = String(event.payload.id ?? '')
  if (!state.tabs.some((tab) => tab.id === id)) { if (event.eventType === 'gearmod/terminal-data') { const buffered = early.get(id) ?? []; buffered.push({ data: String(event.payload.data ?? ''), seq: Number(event.payload.seq ?? 0) }); early.set(id, buffered.slice(-100)); if (early.size > 100) early.delete(early.keys().next().value!) } return }
  if (event.eventType === 'gearmod/terminal-data') patchTab(id, (tab) => Number(event.payload.seq ?? 0) <= tab.seq ? tab : { ...append(tab, String(event.payload.data ?? '')), seq: Number(event.payload.seq) })
  else if (event.eventType === 'gearmod/terminal-exit') patchTab(id, (tab) => ({ ...append(tab, `\n\x1b[2m${tr().files.terminal.exitMessage(String(event.payload.code ?? 0))}\x1b[0m\n`), exited: true }))
})

export const terminal = {
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  snapshot: (): TerminalState => state,
  /** Working folder of new terminals: the open chat's card (worktree) or the project. */
  setContext(context: TerminalState['context']): void { set({ context }) },
  setOpen(open: boolean): void { set({ open }) },
  select(id: string): void { set({ active: id }) },
  /** `quiet`: only adds the tab (coming from another window), without opening the panel or switching the active tab. */
  async attach(id: string, options?: { quiet?: boolean }): Promise<void> {
    const quiet = Boolean(options?.quiet)
    try {
      const info = await window.gearmod.invoke('terminal:info', { id }), queued = early.get(id) ?? []; early.delete(id)
      let tab: TerminalTab = { ...info, title: info.shell }
      queued.filter((chunk) => chunk.seq > info.seq).forEach((chunk) => { tab = { ...append(tab, chunk.data), seq: chunk.seq } })
      if (quiet && state.tabs.some((item) => item.id === id)) return
      set({ tabs: [...state.tabs.filter((item) => item.id !== id), tab], ...(quiet ? { active: state.active ?? id } : { active: id, open: true }), error: '' })
    } catch (reason) { if (!quiet) set({ error: plainError(reason), open: true }) }
  },
  /** Detached terminal window closing: the tabs open in it (including those created with "+") go back to the main window; the process keeps running. */
  handOff(): void {
    const ids = state.tabs.filter((tab) => !tab.exited).map((tab) => tab.id)
    if (!ids.length) return
    const message = JSON.stringify({ ids, at: Date.now() })
    try { localStorage.setItem(handOffKey, message) } catch { /* no storage: try the channel only */ }
    try { const channel = new BroadcastChannel(handOffKey); channel.postMessage(message); channel.close() } catch { /* channel unavailable */ }
  },
  async openPath(context: { projectId: string; cardId: string | null; path: string }): Promise<string | null> { try { const { id } = await window.gearmod.invoke('workspace:terminal', context); await terminal.attach(id); return id } catch (reason) { set({ error: plainError(reason), open: true }); return null } },
  /** Opens a new terminal tab in the folder and types only the first command; the user answers the CLI's questions there. */
  async runIn(context: { projectId: string; cardId: string | null; path: string }, command: string): Promise<boolean> {
    const id = await terminal.openPath(context)
    if (!id) return false
    set({ open: true, active: id }); await terminal.send(id, command); return true
  },
  async newTab(): Promise<string | null> {
    // With no open project (empty context), the terminal opens in the user's folder, like a regular terminal.
    const context = state.context ?? { projectId: null, cardId: null }
    try {
      const { id, cwd, shell } = await window.gearmod.invoke('terminal:open', context)
      counter += 1
      const chunks = early.get(id) ?? []; early.delete(id)
      set({ tabs: [...state.tabs, { id, title: `${shell} ${counter}`, shell, cwd, text: chunks.map((chunk) => chunk.data).join(''), seq: chunks.at(-1)?.seq ?? 0, exited: false }], active: id, open: true, error: '' })
      return id
    } catch (reason) { set({ error: plainError(reason), open: true }); return null }
  },
  async send(id: string, line: string): Promise<void> {
    const tab = state.tabs.find((item) => item.id === id)
    if (!tab || tab.exited) return
    try { await window.gearmod.invoke('terminal:write', { id, data: `${line}\r` }) } catch (reason) { patchTab(id, (item) => append(item, `${plainError(reason)}\n`)) }
  },
  /** Play button of a chat code block: runs in the active tab (opens one if there is none or if it has already finished). */
  async run(command: string): Promise<void> {
    let id = state.active && state.tabs.some((tab) => tab.id === state.active && !tab.exited) ? state.active : null
    set({ open: true })
    if (!id) id = await terminal.newTab()
    if (id) for (const line of command.split(/\r?\n/).filter((item) => item.trim())) await terminal.send(id, line)
  },
  /** Whether the tab's process is still running (closing it then stops what runs there, so the screen confirms first). */
  running: (id: string): boolean => state.tabs.some((tab) => tab.id === id && !tab.exited),
  /** Closes the tab and kills its process. The screen asks for confirmation before, when `running`. */
  close(id: string): void {
    void window.gearmod.invoke('terminal:kill', { id }).catch(() => undefined)
    const tabs = state.tabs.filter((tab) => tab.id !== id)
    set({ tabs, active: state.active === id ? tabs.at(-1)?.id ?? null : state.active, open: tabs.length > 0 && state.open })
  },
  clear(id: string): void { patchTab(id, (tab) => ({ ...tab, text: '' })) }
}

// Only the main window gets the tabs back (extra ones have `?pop=` in the URL).
if (typeof window !== 'undefined' && window.gearmod && !popoutParams()) {
  const receive = (raw: unknown): void => {
    try { const parsed = JSON.parse(String(raw)) as { ids?: unknown }; if (Array.isArray(parsed.ids)) for (const id of parsed.ids) if (typeof id === 'string' && !state.tabs.some((tab) => tab.id === id)) void terminal.attach(id, { quiet: true }) } catch { /* invalid message */ }
  }
  window.addEventListener('storage', (event) => { if (event.key === handOffKey && event.newValue) receive(event.newValue) })
  try { new BroadcastChannel(handOffKey).onmessage = (event) => receive(event.data) } catch { /* channel unavailable: the storage event remains */ }
}

export const useTerminal =(): TerminalState => useSyncExternalStore(terminal.subscribe, terminal.snapshot)
