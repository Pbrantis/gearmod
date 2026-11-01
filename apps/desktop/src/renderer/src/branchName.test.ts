import { describe, expect, it } from 'vitest'
import { branchNameProblem } from './branchName'

describe('branchNameProblem', () => {
  it('aceita nomes comuns', () => {
    for (const name of ['main', 'feature/minha-branch', 'fix/ação-1', 'v1.2.3', 'release/2026.10']) expect(branchNameProblem(name)).toBeNull()
  })
  it('recusa o que o Git recusa', () => {
    expect(branchNameProblem('minha branch')).toBe('spaces')
    expect(branchNameProblem('a:b')).toBe('chars')
    expect(branchNameProblem('a\\b')).toBe('chars')
    expect(branchNameProblem('a~1')).toBe('chars')
    expect(branchNameProblem('a..b')).toBe('sequence')
    expect(branchNameProblem('a@{b')).toBe('sequence')
    expect(branchNameProblem('@')).toBe('sequence')
    expect(branchNameProblem('-x')).toBe('edges')
    expect(branchNameProblem('x/')).toBe('edges')
    expect(branchNameProblem('x.')).toBe('edges')
    expect(branchNameProblem('a//b')).toBe('edges')
    expect(branchNameProblem('a/.b')).toBe('edges')
    expect(branchNameProblem('a/b.lock')).toBe('lock')
  })
})
