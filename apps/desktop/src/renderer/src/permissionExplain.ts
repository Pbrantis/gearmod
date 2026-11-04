import { tr } from './i18n'

/** Translates the command of a permission request into readable steps. It only describes: it never runs or decides anything. */
export type Risk = 'read' | 'write' | 'other'
export interface Step { tool: string; label: string; detail: string; risk: Risk; joinedBy: string }

/** Splits on `&&`, `||`, `;`, `|` and line breaks, respecting quotes. */
export function splitCommand(command: string): Array<{ text: string; joinedBy: string }> {
  const parts: Array<{ text: string; joinedBy: string }> = []
  let current = '', quote = '', joinedBy = ''
  const flush = (next: string): void => { if (current.trim()) parts.push({ text: current.trim(), joinedBy }); current = ''; joinedBy = next }
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!, pair = command.slice(i, i + 2)
    if (quote) { current += char; if (char === '\\' && quote === '"') { current += command[i + 1] ?? ''; i += 1 } else if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
    if (pair === '&&' || pair === '||') { flush(pair); i += 1; continue }
    if (char === ';' || char === '\n') { flush(';'); continue }
    if (char === '|') { flush('|'); continue }
    current += char
  }
  flush('')
  return parts
}

export function tokenize(segment: string): string[] {
  const words: string[] = []; let current = '', quote = '', has = false
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i]!
    if (quote) {
      if (char === '\\' && quote === '"' && i + 1 < segment.length) { current += segment[i + 1]; i += 1 } else if (char === quote) quote = ''; else current += char
      continue
    }
    if (char === '"' || char === "'") { quote = char; has = true; continue }
    if (/\s/.test(char)) { if (current || has) words.push(current); current = ''; has = false; continue }
    current += char
  }
  if (current || has) words.push(current)
  return words
}

/** Long paths from the card's worktree and the user's folder become short and recognizable. */
export function shortPath(value: string): string {
  const slashes = value.replace(/\\/g, '/')
  const worktree = /^.*?\/data\/wt\/[0-9a-f]{6,}\/([^/]+)(\/.*)?$/i.exec(slashes)
  if (worktree) return `worktree/${worktree[1]}${worktree[2] ?? ''}`
  return slashes.replace(/^[A-Za-z]:\/Users\/[^/]+\//, '~/').replace(/^\/(?:home|Users)\/[^/]+\//, '~/')
}

const readOnlyGit = new Set(['status', 'log', 'diff', 'show', 'branch', 'rev-parse', 'ls-files', 'blame', 'remote', 'config', 'describe', 'tag'])
const gitLabel = (sub: string): string | undefined => (tr().chat.explain.git as Record<string, string>)[sub]

const pathsOf = (args: string[]): string[] => args.filter((arg) => arg && !arg.startsWith('-')).map(shortPath)

function explain(segment: string, joinedBy: string): Step {
  const words = tokenize(segment), tool = (words[0] ?? '').replace(/^.*[\\/]/, '').toLowerCase(), args = words.slice(1)
  const x = tr().chat.explain
  const flags = args.filter((arg) => arg.startsWith('-')), rest = args.filter((arg) => !arg.startsWith('-'))
  const redirect = />/.test(segment.replace(/["'][^"']*["']/g, '').replace(/\d?>>?\s*\/dev\/null/g, '').replace(/\d?>&\d/g, ''))
  const make = (label: string, detail: string, risk: Risk): Step => ({ tool: tool || segment, label: redirect && risk !== 'write' ? x.withRedirect(label) : label, detail, risk: redirect ? 'write' : risk, joinedBy })
  switch (tool) {
    case 'cd': case 'pushd': return make(x.enterFolder, shortPath(rest[0] ?? ''), 'read')
    case 'sed': {
      if (flags.some((flag) => /^-[a-z]*i/.test(flag) || flag.startsWith('--in-place'))) return make(x.sedInPlace, pathsOf(rest.slice(1)).join(', ') || rest.join(' '), 'write')
      const range = /^(\d+)(?:,(\d+))?p$/.exec(rest[0] ?? '')
      return make(range ? x.readLines(range[1]!, range[2]) : x.sedFilter, pathsOf(range ? rest.slice(1) : rest.slice(1)).join(', '), 'read')
    }
    case 'grep': case 'rg': case 'egrep': case 'fgrep': case 'ag': { const [pattern, ...targets] = rest; return make(x.searchText, x.searchDetail(pattern ?? '', targets.map(shortPath).join(', '), flags.includes('-v')), 'read') }
    case 'head': case 'tail': { const count = flags.map((flag) => /^-n?(\d+)$/.exec(flag)?.[1]).find(Boolean) ?? (flags.includes('-n') ? rest[0] : undefined); return make((tool === 'head' ? x.showStart : x.showEnd)(count), pathsOf(count && flags.includes('-n') ? rest.slice(1) : rest).join(', '), 'read') }
    case 'cat': case 'type': case 'less': case 'more': case 'bat': return make(x.readFile, pathsOf(rest).join(', '), 'read')
    case 'ls': case 'dir': case 'tree': return make(x.listFolder, pathsOf(rest).join(', ') || x.currentFolder, 'read')
    case 'find': return flags.some((flag) => flag === '-delete') || args.includes('-delete') || args.includes('-exec') ? make(x.findAct, args.map(shortPath).join(' '), 'write') : make(x.findFiles, args.map(shortPath).join(' '), 'read')
    case 'wc': case 'sort': case 'uniq': case 'cut': case 'awk': case 'tr': case 'xargs': return make(x.processOutput, segment, tool === 'xargs' ? 'other' : 'read')
    case 'echo': case 'printf': return make(x.printText, rest.join(' '), 'read')
    case 'pwd': case 'which': case 'where': case 'whoami': return make(x.queryEnv, segment, 'read')
    case 'rm': case 'del': case 'rmdir': case 'rd': return make(x.remove, pathsOf(rest).join(', '), 'write')
    case 'mv': case 'move': case 'ren': return make(x.moveRename, pathsOf(rest).join(' → '), 'write')
    case 'cp': case 'copy': case 'xcopy': return make(x.copy, pathsOf(rest).join(' → '), 'write')
    case 'mkdir': case 'md': return make(x.createFolder, pathsOf(rest).join(', '), 'write')
    case 'touch': case 'tee': return make(x.createOrWrite, pathsOf(rest).join(', '), 'write')
    case 'git': {
      const sub = rest[0] ?? '', label = gitLabel(sub) ?? `git ${sub}`
      const risk: Risk = readOnlyGit.has(sub) && !(sub === 'branch' && flags.some((flag) => /^-(d|D|m|M)$/.test(flag))) ? 'read' : 'write'
      return make(label, rest.slice(1).map(shortPath).join(' '), risk)
    }
    case 'npm': case 'pnpm': case 'yarn': case 'npx': case 'bun': {
      const sub = rest[0] ?? ''
      if (['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'ci'].includes(sub)) return make(x.installDeps, segment, 'write')
      return make(sub === 'test' || sub === 'run' || sub === 'exec' || tool === 'npx' ? x.run(rest.slice(sub === 'run' ? 1 : 0).join(' ') || x.scriptWord) : x.executeSub(tool, sub), '', 'other')
    }
    case 'node': case 'python': case 'python3': case 'py': case 'pytest': case 'tsc': case 'vitest': case 'jest': case 'go': case 'cargo': case 'dotnet': case 'make': case 'powershell': case 'pwsh': case 'bash': case 'sh': case 'cmd':
      return make(x.execute(tool), args.map(shortPath).join(' '), 'other')
    default: return make(x.execute(tool || x.commandWord), args.map(shortPath).join(' '), 'other')
  }
}

export function explainCommand(command: string): { steps: Step[]; risk: Risk } {
  const steps = splitCommand(command).map((part) => explain(part.text, part.joinedBy))
  const risk: Risk = steps.some((step) => step.risk === 'write') ? 'write' : steps.length && steps.every((step) => step.risk === 'read') ? 'read' : 'other'
  return { steps, risk }
}

export const riskLabel = (risk: Risk): string => tr().chat.explain.risk[risk]
