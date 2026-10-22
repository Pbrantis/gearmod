/** Nome curto da worktree (última pasta do caminho, funciona com / e \\). */
export const worktreeName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
