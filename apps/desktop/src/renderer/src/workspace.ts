/** Short worktree name (last folder of the path, works with / and \\). */
export const worktreeName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
