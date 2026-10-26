import { useSyncExternalStore } from 'react'

export interface TerminalTab { id: string; title: string; cwd: string; text: string; exited: boolean; shell: string; seq: number }
interface TerminalState { open: boolean; tabs: TerminalTab[]; active: string | null; context: { projectId: string; cardId: string | null } | null; error: string }

const maxText = 300_000
let state: TerminalState = { open: false, tabs: [], active: null, context: null, error: '' }
const listeners = new Set<() => void>()
const set = (next: Partial<TerminalState>): void => { state = { ...state, ...next }; listeners.forEach((listener) => listener()) }
const patchTab = (id: string, change: (tab: TerminalTab) => TerminalTab): void => set({ tabs: state.tabs.map((tab) => (tab.id === id ? change(tab) : tab)) })
const append = (tab: TerminalTab, data: string): TerminalTab => { const text = tab.text + data; return { ...tab, text: text.length > maxText ? text.slice(text.length - maxText) : text } }
let counter = 0
const early = new Map<string, Array<{ data: string; seq: number }>>()

if (typeof window !== 'undefined' && window.agentboard) window.agentboard.onRunEvent((event) => {
  const id = String(event.payload.id ?? '')
  if (!state.tabs.some((tab) => tab.id === id)) { if (event.eventType === 'agentboard/terminal-data') { const buffered = early.get(id) ?? []; buffered.push({ data: String(event.payload.data ?? ''), seq: Number(event.payload.seq ?? 0) }); early.set(id, buffered.slice(-100)); if (early.size > 100) early.delete(early.keys().next().value!) } return }
  if (event.eventType === 'agentboard/terminal-data') patchTab(id, (tab) => Number(event.payload.seq ?? 0) <= tab.seq ? tab : { ...append(tab, String(event.payload.data ?? '')), seq: Number(event.payload.seq) })
  else if (event.eventType === 'agentboard/terminal-exit') patchTab(id, (tab) => ({ ...append(tab, `\n\x1b[2m[encerrado, código ${String(event.payload.code ?? 0)}]\x1b[0m\n`), exited: true }))
})

export const terminal = {
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } },
  snapshot: (): TerminalState => state,
  /** Pasta de trabalho dos terminais novos: o card do chat aberto (worktree) ou o projeto. */
  setContext(context: TerminalState['context']): void { set({ context }) },
  setOpen(open: boolean): void { set({ open }) },
  select(id: string): void { set({ active: id }) },
  async attach(id: string): Promise<void> {
    try {
      const info = await window.agentboard.invoke('terminal:info', { id }), queued = early.get(id) ?? []; early.delete(id)
      let tab: TerminalTab = { ...info, title: info.shell }
      queued.filter((chunk) => chunk.seq > info.seq).forEach((chunk) => { tab = { ...append(tab, chunk.data), seq: chunk.seq } })
      set({ tabs: [...state.tabs.filter((item) => item.id !== id), tab], active: id, open: true, error: '' })
    } catch (reason) { set({ error: String(reason), open: true }) }
  },
  async openPath(context: { projectId: string; cardId: string | null; path: string }): Promise<void> { try { const { id } = await window.agentboard.invoke('workspace:terminal', context); await terminal.attach(id) } catch (reason) { set({ error: String(reason), open: true }) } },
  async newTab(): Promise<string | null> {
    const context = state.context
    if (!context) { set({ error: 'Abra um projeto para usar o terminal.', open: true }); return null }
    try {
      const { id, cwd, shell } = await window.agentboard.invoke('terminal:open', context)
      counter += 1
      const chunks = early.get(id) ?? []; early.delete(id)
      set({ tabs: [...state.tabs, { id, title: `${shell} ${counter}`, shell, cwd, text: chunks.map((chunk) => chunk.data).join(''), seq: chunks.at(-1)?.seq ?? 0, exited: false }], active: id, open: true, error: '' })
      return id
    } catch (reason) { set({ error: String(reason).replace(/^Error: /, ''), open: true }); return null }
  },
  async send(id: string, line: string): Promise<void> {
    const tab = state.tabs.find((item) => item.id === id)
    if (!tab || tab.exited) return
    try { await window.agentboard.invoke('terminal:write', { id, data: `${line}\r` }) } catch (reason) { patchTab(id, (item) => append(item, `${String(reason)}\n`)) }
  },
  /** Botão de play de um bloco de código do chat: roda na aba ativa (abre uma, se não houver ou se ela já terminou). */
  async run(command: string): Promise<void> {
    let id = state.active && state.tabs.some((tab) => tab.id === state.active && !tab.exited) ? state.active : null
    set({ open: true })
    if (!id) id = await terminal.newTab()
    if (id) for (const line of command.split(/\r?\n/).filter((item) => item.trim())) await terminal.send(id, line)
  },
  close(id: string): void {
    void window.agentboard.invoke('terminal:kill', { id }).catch(() => undefined)
    const tabs = state.tabs.filter((tab) => tab.id !== id)
    set({ tabs, active: state.active === id ? tabs.at(-1)?.id ?? null : state.active, open: tabs.length > 0 && state.open })
  },
  clear(id: string): void { patchTab(id, (tab) => ({ ...tab, text: '' })) }
}

export const useTerminal = (): TerminalState => useSyncExternalStore(terminal.subscribe, terminal.snapshot)
