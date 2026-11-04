import { describe, expect, it } from 'vitest'
import { nextSqlNumber, sqlTab, closeTab, defaultLayout, dropConnections, findTab, moveTab, openTab, panesOf, parseLayout, placeTab, tableTab, type WsNode } from './DbLayout'

describe('window layout', () => {
  const base = (): WsNode => defaultLayout([tableTab(1, 'a'), tableTab(2, 'b')])
  it('splits the pane when the tab is dropped on the edge', () => {
    const root = base(), paneId = panesOf(root)[0]!.id
    const next = moveTab(root, 't-1', paneId, 'bottom')
    expect(next.type).toBe('split'); if (next.type !== 'split') return
    expect(next.dir).toBe('col'); expect(next.children).toHaveLength(2)
    expect(panesOf(next).map((pane) => pane.tabs.length).sort()).toEqual([1, 2])
  })
  it('does not split when the tab is the only one in the pane', () => {
    const only = defaultLayout(), pane = panesOf(only)[0]!
    expect(moveTab(only, pane.tabs[0]!.id, pane.id, 'right')).toMatchObject({ type: 'pane' })
  })
  it('removes the empty pane and collapses the split when the last tab is closed', () => {
    const root = base(), paneId = panesOf(root)[0]!.id, split = moveTab(root, 't-1', paneId, 'right')
    const closed = closeTab(split, 't-1')
    expect(closed.type).toBe('pane'); expect(findTab(closed, 't-1')).toBeUndefined()
  })
  it('merges the tab into another pane by the center and reopens without duplicating', () => {
    const root = base(), paneId = panesOf(root)[0]!.id, split = moveTab(root, 't-1', paneId, 'right')
    const target = panesOf(split).find((pane) => pane.tabs.some((tab) => tab.id === 't-2'))!
    const merged = moveTab(split, 't-1', target.id, 'center')
    expect(merged.type).toBe('pane')
    expect(panesOf(openTab(merged, tableTab(1, 'a')))[0]!.tabs.filter((tab) => tab.id === 't-1')).toHaveLength(1)
  })
  it('validates saved layout', () => {
    const saved = JSON.parse(JSON.stringify(moveTab(base(), 't-2', panesOf(base())[0]!.id, 'left')))
    expect(parseLayout(saved)).toBeDefined()
    expect(parseLayout({ type: 'split', id: 'x', dir: 'row', sizes: [1], children: [] })).toBeUndefined()
    expect(parseLayout('lixo')).toBeUndefined()
  })
  it('reorders tabs by dropping one before another, and moves a tab from one pane to the other', () => {
    const root = base(), pane = panesOf(root)[0]!
    const order = (node: WsNode, index = 0): string[] => panesOf(node)[index]!.tabs.map((tab) => tab.id)
    expect(order(placeTab(root, 't-2', pane.id, pane.tabs[0]!.id))).toEqual(['t-2', pane.tabs[0]!.id, 't-1'])
    expect(order(placeTab(root, pane.tabs[0]!.id, pane.id))).toEqual(['t-1', 't-2', pane.tabs[0]!.id])
    const split = moveTab(root, 't-1', pane.id, 'right'), [left, right] = panesOf(split)
    const joined = placeTab(split, 't-1', left!.id, 't-2')
    expect(panesOf(joined)).toHaveLength(1); expect(order(joined)).toEqual([pane.tabs[0]!.id, 't-1', 't-2'])
    expect(right!.tabs[0]!.id).toBe('t-1')
  })
  it('keeps the database of each tab and closes the tabs of a removed database', () => {
    const root = defaultLayout([tableTab(1, 'a', 'db-a'), tableTab(1, 'a', 'db-b')])
    expect(findTab(root, 't-db-a-1')?.tab.connectionId).toBe('db-a'); expect(findTab(root, 't-db-b-1')).toBeDefined()
    const dropped = dropConnections(root, ['db-a'])
    expect(findTab(dropped, 't-db-a-1')).toBeUndefined(); expect(findTab(dropped, 't-db-b-1')).toBeDefined()
    const kept = parseLayout(JSON.parse(JSON.stringify(root)))!
    expect(findTab(kept, 't-db-b-1')?.tab.connectionId).toBe('db-b')
  })
  it('numbers the next SQL console from the tabs that already exist', () => {
    expect(nextSqlNumber(defaultLayout())).toBe(2)
    const base = defaultLayout(), two = openTab(base, sqlTab(2), panesOf(base)[0]!.id)
    expect(nextSqlNumber(openTab(two, sqlTab(7), panesOf(two)[0]!.id))).toBe(8)
  })
})
