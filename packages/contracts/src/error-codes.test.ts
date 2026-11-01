import { describe, expect, it } from 'vitest'
import { errorCodeOf, withErrorCode, withoutErrorCode } from './error-codes'

describe('códigos de erro', () => {
  it('o código viaja como prefixo e sai do texto mostrado', () => {
    const text = withErrorCode('no-worktree', 'Worktree not created yet')
    expect(errorCodeOf(text)).toBe('no-worktree')
    expect(withoutErrorCode(text)).toBe('Worktree not created yet')
  })
  it('texto sem código, ou com código desconhecido, não é reconhecido', () => {
    expect(errorCodeOf('Worktree ainda não foi criada')).toBeNull()
    expect(errorCodeOf('[[outro-codigo]] x')).toBeNull()
    expect(withoutErrorCode('sem código')).toBe('sem código')
  })
})
