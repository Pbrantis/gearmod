import React from 'react'
import { BranchIcon, WorktreeIcon } from '../icons'

/** Etiqueta com a branch (ou worktree) da raiz de um arquivo. */
export function GitContextChip({ root, title }: { root: { branch?: string | null; worktree?: boolean }; title?: string }): React.JSX.Element {
  const label = root.branch || (root.worktree ? 'Worktree' : 'Pasta principal')
  return <small className={`wf-branchchip ${root.worktree ? 'worktree' : ''}`} title={title ?? `${root.worktree ? 'Worktree' : 'Branch'}: ${label}`}>{root.worktree ? <WorktreeIcon /> : root.branch ? <BranchIcon /> : null}<span>{label}</span></small>
}
