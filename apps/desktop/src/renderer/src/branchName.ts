/** Por que o Git recusaria este nome de branch/tag (regras do `git check-ref-format`); `null` quando o nome serve. */
export type BranchNameProblem = 'spaces' | 'chars' | 'sequence' | 'edges' | 'lock'

export function branchNameProblem(name: string): BranchNameProblem | null {
  if (!name) return null
  if (/\s/.test(name)) return 'spaces'
  // eslint-disable-next-line no-control-regex
  if (/[~^:?*[\\\u0000-\u001f\u007f]/.test(name)) return 'chars'
  if (name === '@' || name.includes('..') || name.includes('@{')) return 'sequence'
  if (/^[-/]/.test(name) || /[/.]$/.test(name) || name.includes('//') || name.split('/').some((part) => part.startsWith('.'))) return 'edges'
  if (name.split('/').some((part) => part.endsWith('.lock'))) return 'lock'
  return null
}
