import type { LayoutPosition } from './WindowLayoutMenu'

/** The side closest to the point where the header was dropped, relative to the window size. */
export function nearestDockEdge(x: number, y: number, width: number, height: number): LayoutPosition {
  const points: Array<[LayoutPosition, number]> = [['left', x / width], ['right', (width - x) / width], ['top', y / height], ['bottom', (height - y) / height]]
  return points.reduce((best, item) => item[1] < best[1] ? item : best)[0]
}
