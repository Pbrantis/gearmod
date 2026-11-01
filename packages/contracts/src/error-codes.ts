/**
 * Códigos estáveis para erros que a tela precisa reconhecer. O texto continua traduzido; o código vai como prefixo `[[codigo]] `,
 * que a tela lê com `errorCodeOf` e tira com `withoutErrorCode`. Assim traduzir o texto no main não quebra a tela.
 */
export const errorCodes = ['git-push-rejected', 'no-worktree'] as const
export type ErrorCode = (typeof errorCodes)[number]

const marker = /^\[\[([a-z-]+)\]\] ?/

export const withErrorCode = (code: ErrorCode, message: string): string => `[[${code}]] ${message}`
export function errorCodeOf(text: string): ErrorCode | null {
  const code = marker.exec(text)?.[1]
  return (errorCodes as readonly string[]).includes(code ?? '') ? code as ErrorCode : null
}
export const withoutErrorCode = (text: string): string => text.replace(marker, '')
