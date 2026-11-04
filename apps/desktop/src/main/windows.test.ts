import { describe, expect, it } from 'vitest'
import { oppositePlacement, placementBounds, popoutQuery } from './windows'

const area = { x: 0, y: 0, width: 2000, height: 1000 }

describe('windows', () => {
  it('splits the work area in half', () => {
    expect(placementBounds(area, 'left')).toEqual({ x: 0, y: 0, width: 1000, height: 1000 })
    expect(placementBounds(area, 'right')).toEqual({ x: 1000, y: 0, width: 1000, height: 1000 })
    expect(placementBounds(area, 'top')).toEqual({ x: 0, y: 0, width: 2000, height: 500 })
    expect(placementBounds(area, 'bottom')).toEqual({ x: 0, y: 500, width: 2000, height: 500 })
  })
  it('a new window fits on a small screen', () => {
    const small = placementBounds({ x: 0, y: 0, width: 800, height: 600 }, 'new')
    expect(small.width).toBe(800); expect(small.height).toBe(600)
  })
  it('returns the opposite half', () => {
    expect(oppositePlacement('left')).toBe('right'); expect(oppositePlacement('bottom')).toBe('top'); expect(oppositePlacement('new')).toBeNull()
  })
  it('fills the work area without moving the other window', () => {
    expect(placementBounds(area, 'fill')).toEqual(area); expect(oppositePlacement('fill')).toBeNull()
  })
  it('builds the query only with what exists', () => {
    expect(popoutQuery({ kind: 'chat', projectId: 'p', cardId: 'c' })).toEqual({ pop: 'chat', project: 'p', card: 'c' })
  })
  it('opens the database as a detachable project view', () => {
    expect(popoutQuery({ kind: 'db', projectId: 'p' })).toEqual({ pop: 'db', project: 'p' })
  })
  it('opens only the file preserving the card context and characters in the path', () => {
    const query = popoutQuery({ kind: 'file', projectId: 'p', cardId: 'c', path: 'C:/repo/docs/nota #1.md' })
    const parsed = new URLSearchParams(new URLSearchParams(query).toString())
    expect(parsed.get('pop')).toBe('file'); expect(parsed.get('card')).toBe('c'); expect(parsed.get('path')).toBe('C:/repo/docs/nota #1.md')
  })
  it('preserves the tabs when detaching the full explorer', () => {
    const query = popoutQuery({ kind: 'files', projectId: 'p', paths: ['C:/repo/a.ts', 'C:/repo/b #1.ts'], path: 'C:/repo/b #1.ts' })
    expect(query.pop).toBe('files'); expect(JSON.parse(query.paths!)).toEqual(['C:/repo/a.ts', 'C:/repo/b #1.ts'])
  })
})
