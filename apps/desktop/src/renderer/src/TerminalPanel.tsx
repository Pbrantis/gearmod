import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { terminal, useTerminal, type TerminalTab } from './terminalStore'
import { WindowLayoutMenu, type LayoutPosition } from './WindowLayoutMenu'
import { CloseIcon, ExpandIcon, CollapseIcon } from './icons'
import { pop } from './popout'

function Screen({ tab, visible }: { tab: TerminalTab; visible: boolean }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null), screen = useRef<Terminal | null>(null), consumed = useRef(''), fit = useRef<FitAddon | null>(null)
  useEffect(() => {
    if (!box.current) return
    const xterm = new Terminal({ cursorBlink: true, fontFamily: 'Consolas, monospace', fontSize: 13, scrollback: 10000, theme: { background: '#101211', foreground: '#dce3df', cursor: '#8fb8d6', selectionBackground: '#34527399' } }), addon = new FitAddon()
    xterm.loadAddon(addon); xterm.open(box.current); screen.current = xterm; fit.current = addon; consumed.current = ''
    xterm.attachCustomKeyEventHandler((event) => !(event.ctrlKey && (event.shiftKey && event.code === 'KeyF' || event.code === 'Backquote' || event.key === '^')))
    const input = xterm.onData((data) => { void window.agentboard.invoke('terminal:write', { id: tab.id, data }).catch(() => undefined) })
    const resize = (): void => { if (!box.current?.clientWidth || !box.current?.clientHeight) return; addon.fit(); void window.agentboard.invoke('terminal:resize', { id: tab.id, cols: Math.max(2, xterm.cols), rows: Math.max(2, xterm.rows) }).catch(() => undefined) }
    const observer = new ResizeObserver(resize); observer.observe(box.current); resize()
    return () => { observer.disconnect(); input.dispose(); xterm.dispose(); screen.current = null; fit.current = null }
  }, [tab.id])
  useEffect(() => { if (!screen.current) return; if (tab.text.startsWith(consumed.current)) screen.current.write(tab.text.slice(consumed.current.length)); else { screen.current.reset(); screen.current.write(tab.text) } consumed.current = tab.text }, [tab.text])
  useEffect(() => { if (visible) window.setTimeout(() => { fit.current?.fit(); screen.current?.focus() }, 0) }, [visible])
  return <div ref={box} className="term-emulator" style={{ display: visible ? undefined : 'none' }} aria-label={`${tab.shell} interativo`} />
}

export function TerminalPanel({ standalone = false }: { standalone?: boolean } = {}): React.JSX.Element | null {
  const { open, tabs, active, error, context } = useTerminal(), [position, setPosition] = useState<LayoutPosition>('bottom'), [expanded, setExpanded] = useState(false), [height, setHeight] = useState(300), [dragging, setDragging] = useState(false)
  const current = tabs.find((tab) => tab.id === active)
  useEffect(() => { if (standalone && pop?.terminalId) { terminal.setContext({ projectId: pop.projectId, cardId: pop.cardId }); void terminal.attach(pop.terminalId) } }, [standalone])
  const detach = async (): Promise<void> => { if (!current || !context) return; try { await window.agentboard.invoke('windows:open', { kind: 'terminal', projectId: context.projectId, cardId: context.cardId ?? undefined, terminalId: current.id, placement: 'new' }); terminal.setOpen(false) } catch { /* a sessão permanece aberta */ } }
  if (!open && !standalone) return null
  const size = position === 'top' || position === 'bottom' ? { height } : { width: Math.max(420, Math.round(window.innerWidth * .48)) }
  const fill = (): void => { if (standalone) void window.agentboard.invoke('windows:place', { placement: expanded ? 'new' : 'fill' }); setExpanded(!expanded) }
  return <section className={`term terminalpty ${standalone ? 'standalone' : expanded ? 'expanded' : position} ${dragging ? 'dragging' : ''}`} style={standalone || expanded ? undefined : size} aria-label="Terminal PowerShell">
    {!standalone && !expanded && (position === 'top' || position === 'bottom') && <div className="term-grip" role="separator" aria-label="Ajustar altura do terminal" onPointerDown={(event) => { event.preventDefault(); setDragging(true); const move = (e: PointerEvent): void => setHeight(Math.max(180, Math.min(window.innerHeight - 100, position === 'bottom' ? window.innerHeight - e.clientY : e.clientY - 36))); const up = (): void => { setDragging(false); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up) }; document.addEventListener('pointermove', move); document.addEventListener('pointerup', up) }} />}
    <div className="term-tabs"><span className="powershell-icon" aria-hidden="true">›_</span><div className="term-tablist">{tabs.map((tab) => <span key={tab.id} className={`term-tab ${tab.id === active ? 'on' : ''}`}><button type="button" onClick={() => terminal.select(tab.id)} title={tab.cwd}>{tab.title}{tab.exited ? ' · encerrado' : ''}</button><button type="button" className="x" aria-label={`Fechar ${tab.title}`} onClick={() => terminal.close(tab.id)}>×</button></span>)}</div>
      <button type="button" className="ibtn" title="Novo PowerShell" aria-label="Novo terminal" onClick={() => void terminal.newTab()}>+</button><span className="term-cwd" title={current?.cwd}>{current?.cwd}</span>
      {current && <button type="button" className="term-link" onClick={() => terminal.clear(current.id)}>Limpar</button>}
      <WindowLayoutMenu move={(value) => { if (standalone) void window.agentboard.invoke('windows:place', { placement: value }); else { setPosition(value); setExpanded(false) } }} fill={fill} center={() => { if (standalone) void window.agentboard.invoke('windows:place', { placement: 'new' }); else { setPosition('bottom'); setExpanded(false); setHeight(300) } }} detach={!standalone ? () => void detach() : undefined} detachDisabled={!current} />
      <button type="button" className="ibtn" aria-label={expanded ? 'Restaurar terminal' : 'Expandir terminal'} onClick={fill}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button><button type="button" className="ibtn" aria-label="Ocultar terminal" onClick={() => { if (standalone) window.close(); else terminal.setOpen(false) }}><CloseIcon /></button>
    </div>
    {error && <p className="term-error">{error}</p>}{tabs.map((tab) => <Screen key={tab.id} tab={tab} visible={active === tab.id} />)}
    {!current && <div className="term-empty"><button type="button" onClick={() => void terminal.newTab()}>Abrir PowerShell</button></div>}
  </section>
}
