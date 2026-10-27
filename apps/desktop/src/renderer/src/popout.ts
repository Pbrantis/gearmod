export type PopKind = 'board' | 'chats' | 'git' | 'chat' | 'files' | 'file' | 'terminal'
export interface PopParams { kind: PopKind; projectId: string; cardId: string | null; chatId: string | null; terminalId: string | null; purpose: string | null; path: string | null; paths: string[] }

/** Esta janela é uma extra (aberta por "Abrir em nova janela")? Os parâmetros vêm da URL que o processo principal montou. */
export function popoutParams(search: string = typeof location === 'undefined' ? '' : location.search): PopParams | null {
  const params = new URLSearchParams(search), kind = params.get('pop'), projectId = params.get('project')
  if (!projectId || !['board', 'chats', 'git', 'chat', 'files', 'file', 'terminal'].includes(kind ?? '')) return null
  let paths: string[] = []
  try { const parsed: unknown = JSON.parse(params.get('paths') ?? '[]'); if (Array.isArray(parsed)) paths = parsed.filter((item): item is string => typeof item === 'string').slice(0, 50) } catch { /* uma URL antiga não tem a lista de abas */ }
  return { kind: kind as PopKind, projectId, cardId: params.get('card'), chatId: params.get('chat'), terminalId: params.get('terminal'), purpose: params.get('purpose'), path: params.get('path'), paths }
}

export const pop = popoutParams()
