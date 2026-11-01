import { describe, expect, it } from 'vitest'
import { candidate, constitutionMigrationPlan } from './constitution-migration-plan'

describe('constitution migration preview', () => {
  const db = candidate('db'), same = candidate('db'), other = candidate('other'), third = candidate('third')
  it.each([
    ['A', null, null, null], ['B', db, null, null], ['C', db, same, null],
    ['D', db, other, null], ['E', db, null, other], ['F', db, other, third],
    ['G', null, other, third], ['existing', null, other, null]
  ] as const)('classifies %s', (kind, d, native, speckit) => {
    expect(constitutionMigrationPlan({ db: d, native, speckit }, 'native').kind).toBe(kind)
  })
  it('hashes exact content including line endings', () => {
    expect(candidate('a\r\n')?.sha256).not.toBe(candidate('a\n')?.sha256)
  })
})
