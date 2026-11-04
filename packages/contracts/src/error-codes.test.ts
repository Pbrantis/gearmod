import { describe, expect, it } from 'vitest'
import { errorCodeOf, withErrorCode, withoutErrorCode } from './error-codes'

describe('error codes', () => {
  it('the code travels as a prefix and is removed from the displayed text', () => {
    const text = withErrorCode('no-worktree', 'Worktree not created yet')
    expect(errorCodeOf(text)).toBe('no-worktree')
    expect(withoutErrorCode(text)).toBe('Worktree not created yet')
  })
  it('text without a code, or with an unknown code, is not recognized', () => {
    expect(errorCodeOf('Worktree ainda não foi criada')).toBeNull()
    expect(errorCodeOf('[[outro-codigo]] x')).toBeNull()
    expect(withoutErrorCode('sem código')).toBe('sem código')
  })
})
