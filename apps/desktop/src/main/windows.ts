export type WindowPlacement = 'new' | 'left' | 'right' | 'top' | 'bottom' | 'fill' | 'second'
export interface Bounds { x: number; y: number; width: number; height: number }

/** Metade da área útil da tela para onde a janela vai (esquerda, direita, em cima, embaixo); `new` é uma janela solta, deslocada um pouco. */
export function placementBounds(area: Bounds, placement: WindowPlacement): Bounds {
  const halfW = Math.floor(area.width / 2), halfH = Math.floor(area.height / 2)
  switch (placement) {
    case 'fill': return { ...area }
    case 'left': return { x: area.x, y: area.y, width: halfW, height: area.height }
    case 'right': return { x: area.x + halfW, y: area.y, width: area.width - halfW, height: area.height }
    case 'top': return { x: area.x, y: area.y, width: area.width, height: halfH }
    case 'bottom': return { x: area.x, y: area.y + halfH, width: area.width, height: area.height - halfH }
    default: { const width = Math.min(900, area.width), height = Math.min(700, area.height); return { x: area.x + Math.floor((area.width - width) / 2) + 24, y: area.y + Math.floor((area.height - height) / 2) + 24, width, height } }
  }
}

/** A outra metade, para a janela que abriu poder dividir a tela com a nova. */
export const oppositePlacement = (placement: WindowPlacement): WindowPlacement | null => placement === 'left' ? 'right' : placement === 'right' ? 'left' : placement === 'top' ? 'bottom' : placement === 'bottom' ? 'top' : null

export interface PopoutTarget { kind: 'board' | 'chats' | 'git' | 'db' | 'chat' | 'files' | 'file' | 'terminal'; projectId: string; cardId?: string | undefined; chatId?: string | undefined; terminalId?: string | undefined; path?: string | undefined; paths?: string[] | undefined; purpose?: string | undefined }

/** Parâmetros que o renderer lê (`?pop=chat&project=…`) para montar só aquela parte do app. */
export function popoutQuery(target: PopoutTarget): Record<string, string> {
  const query: Record<string, string> = { pop: target.kind, project: target.projectId }
  if (target.cardId) query.card = target.cardId
  if (target.chatId) query.chat = target.chatId
  if (target.purpose) query.purpose = target.purpose
  if (target.path) query.path = target.path
  if (target.paths?.length) query.paths = JSON.stringify(target.paths)
  if (target.terminalId) query.terminal = target.terminalId
  return query
}
