export type PopKind = 'board' | 'git' | 'chat' | 'file' | 'terminal'
export interface PopParams { kind: PopKind; projectId: string; cardId: string | null; chatId: string | null; terminalId: string | null; purpose: string | null; path: string | null }

/** Esta janela é uma extra (aberta por "Abrir em nova janela")? Os parâmetros vêm da URL que o processo principal montou. */
export function popoutParams(search: string = typeof location === 'undefined' ? '' : location.search): PopParams | null {
  const params = new URLSearchParams(search), kind = params.get('pop'), projectId = params.get('project')
  if (!projectId || !['board', 'git', 'chat', 'file', 'terminal'].includes(kind ?? '')) return null
  return { kind: kind as PopKind, projectId, cardId: params.get('card'), chatId: params.get('chat'), terminalId: params.get('terminal'), purpose: params.get('purpose'), path: params.get('path') }
}

export const pop = popoutParams()
