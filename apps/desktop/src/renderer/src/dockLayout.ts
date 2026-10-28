import type { LayoutPosition } from './WindowLayoutMenu'

/** O lado mais próximo do ponto onde o cabeçalho foi solto, em proporção ao tamanho da janela. */
export function nearestDockEdge(x: number, y: number, width: number, height: number): LayoutPosition {
  const points: Array<[LayoutPosition, number]> = [['left', x / width], ['right', (width - x) / width], ['top', y / height], ['bottom', (height - y) / height]]
  return points.reduce((best, item) => item[1] < best[1] ? item : best)[0]
}
