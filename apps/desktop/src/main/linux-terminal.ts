import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { basename, delimiter, join } from 'node:path'
import { tm } from './i18n'

/** How each known terminal emulator receives the command to run (the flag before `sh -c <script>`; `null` = no flag). */
const TERMINAL_FLAGS: Record<string, string | null> = {
  'x-terminal-emulator': '-e',
  'gnome-terminal': '--',
  konsole: '-e',
  'xfce4-terminal': '-x',
  kitty: null,
  alacritty: '-e',
  xterm: '-e',
  'xdg-terminal-exec': null,
}

/** Lookup order after `$TERMINAL`. `xdg-terminal-exec` is not installed by most distros yet, so it comes last. */
export const TERMINAL_ORDER = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal', 'kitty', 'alacritty', 'xterm', 'xdg-terminal-exec']

export interface TerminalDeps {
  /** Full path of the executable (name looked up in PATH, or a path checked as is), or null when it does not exist. */
  findExecutable(name: string, env: NodeJS.ProcessEnv): string | null
  spawn(command: string, args: string[], env: NodeJS.ProcessEnv): void
}

const systemDeps: TerminalDeps = {
  findExecutable(name, env) {
    const candidates = name.includes('/') ? [name] : (env.PATH ?? '').split(delimiter).filter(Boolean).map((folder) => join(folder, name))
    for (const candidate of candidates) {
      try {
        if (!statSync(candidate).isFile()) continue
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch { /* next */ }
    }
    return null
  },
  spawn(command, args, env) {
    const child = spawn(command, args, { env, detached: true, stdio: 'ignore' })
    // A terminal that fails to start must not bring the app down; gnome-terminal's client also exits right away, so the child is not awaited.
    child.on('error', () => {})
    child.unref()
  },
}

/** Quotes one argument for POSIX sh, only when needed (so the manual command shown to the user stays readable). */
export function shellQuote(value: string): string {
  if (value !== '' && /^[\w@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** The command line as the user would type it in a terminal. */
export function commandLine(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(' ')
}

/** Script run by `sh -c`: the command, then a notice and a `read`, so the window stays open until the user closes it (like `cmd /k` on Windows). */
export function holdScript(command: string, args: string[]): string {
  return `${commandLine(command, args)}; echo; printf '%s\\n' ${shellQuote(tm().linuxTerminal.pressEnter)}; read _`
}

/** Arguments for the terminal emulator (identified by the executable name) to run `sh -c <script>`. Unknown terminals (e.g. a custom `$TERMINAL`) get `-e`, the most common flag. */
export function terminalArgs(terminal: string, script: string): string[] {
  const name = basename(terminal)
  const flag = Object.hasOwn(TERMINAL_FLAGS, name) ? TERMINAL_FLAGS[name]! : '-e'
  return [...(flag ? [flag] : []), 'sh', '-c', script]
}

/** Finds the terminal emulator: `$TERMINAL` first (skipped when it does not exist), then the known ones in {@link TERMINAL_ORDER}. */
export function findTerminal(env: NodeJS.ProcessEnv, deps: Pick<TerminalDeps, 'findExecutable'> = systemDeps): string | null {
  const preferred = env.TERMINAL?.trim()
  for (const name of [...(preferred ? [preferred] : []), ...TERMINAL_ORDER]) {
    const found = deps.findExecutable(name, env)
    if (found) return found
  }
  return null
}

/** Opens `command args` in a visible terminal window on Linux, with `env`. Without a terminal, throws a message (in the app language) with the command to run by hand. */
export function openInTerminal(command: string, args: string[], env: NodeJS.ProcessEnv = process.env, deps: TerminalDeps = systemDeps): void {
  const terminal = findTerminal(env, deps)
  if (!terminal) throw new Error(tm().linuxTerminal.notFound(commandLine(command, args)))
  deps.spawn(terminal, terminalArgs(terminal, holdScript(command, args)), env)
}
