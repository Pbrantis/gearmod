import { createHash } from 'node:crypto'

export type Candidate = { content: string; sha256: string } | null
export type MigrationCase = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'existing'
export function candidate(content: string | null): Candidate {
  return content === null ? null : { content, sha256: createHash('sha256').update(content, 'utf8').digest('hex') }
}

/** Preview only. Divergent repository files take precedence over single-source cases. */
export function constitutionMigrationPlan(candidates: { db: Candidate; native: Candidate; speckit: Candidate }, method: 'native' | 'speckit') {
  const { db, native, speckit } = candidates
  const divergentFiles = native && speckit && native.sha256 !== speckit.sha256
  let kind: MigrationCase
  if (divergentFiles) kind = db ? 'F' : 'G'
  else if (!db) kind = native || speckit ? 'existing' : 'A'
  else if (!native && !speckit) kind = 'B'
  else {
    const file = (method === 'native' ? native : speckit) ?? native ?? speckit
    if (file?.sha256 === db.sha256) kind = 'C'
    else kind = !native && speckit ? 'E' : 'D'
  }
  const action = ({ A: 'template', B: 'preview-write', C: 'already-migrated', D: 'conflict', E: 'conflict', F: 'reconcile', G: 'reconcile', existing: 'use-existing' } as const)[kind]
  return { kind, action, method, candidates }
}
