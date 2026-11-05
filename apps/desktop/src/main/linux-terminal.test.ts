import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { commandLine, findTerminal, holdScript, openInTerminal, shellQuote, terminalArgs, type TerminalDeps } from './linux-terminal'
import { tm } from './i18n'

function fakeDeps(installed: Record<string, string>): TerminalDeps & { calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> } {
  const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = []
  return {
    calls,
    findExecutable: (name) => installed[name] ?? null,
    spawn: (command, args, env) => { calls.push({ command, args, env }) },
  }
}

describe('findTerminal', () => {
  it('prefers $TERMINAL when it exists', () => {
    const deps = fakeDeps({ '/opt/wezterm': '/opt/wezterm', 'gnome-terminal': '/usr/bin/gnome-terminal' })
    expect(findTerminal({ TERMINAL: '/opt/wezterm' }, deps)).toBe('/opt/wezterm')
  })

  it('moves on to the known terminals when $TERMINAL does not exist', () => {
    const deps = fakeDeps({ xterm: '/usr/bin/xterm' })
    expect(findTerminal({ TERMINAL: '/nao/existe' }, deps)).toBe('/usr/bin/xterm')
  })

  it('follows the preference order', () => {
    const all = { 'x-terminal-emulator': '/usr/bin/x-terminal-emulator', 'gnome-terminal': '/usr/bin/gnome-terminal', konsole: '/usr/bin/konsole', 'xfce4-terminal': '/usr/bin/xfce4-terminal', kitty: '/usr/bin/kitty', alacritty: '/usr/bin/alacritty', xterm: '/usr/bin/xterm' }
    expect(findTerminal({}, fakeDeps(all))).toBe('/usr/bin/x-terminal-emulator')
    const withoutDefault: Record<string, string> = { ...all }
    delete withoutDefault['x-terminal-emulator']
    expect(findTerminal({}, fakeDeps(withoutDefault))).toBe('/usr/bin/gnome-terminal')
    expect(findTerminal({}, fakeDeps({ konsole: '/usr/bin/konsole', xterm: '/usr/bin/xterm' }))).toBe('/usr/bin/konsole')
    expect(findTerminal({}, fakeDeps({ kitty: '/usr/bin/kitty', alacritty: '/usr/bin/alacritty' }))).toBe('/usr/bin/kitty')
  })

  it('returns null when there is no terminal', () => {
    expect(findTerminal({ TERMINAL: 'nope' }, fakeDeps({}))).toBeNull()
  })
})

describe('terminalArgs', () => {
  it.each([
    ['/usr/bin/gnome-terminal', ['--']],
    ['/usr/bin/konsole', ['-e']],
    ['/usr/bin/xterm', ['-e']],
    ['/usr/bin/alacritty', ['-e']],
    ['/usr/bin/x-terminal-emulator', ['-e']],
    ['/usr/bin/xfce4-terminal', ['-x']],
    ['/usr/bin/kitty', []],
    ['/opt/unknown-term', ['-e']],
  ])('uses the right syntax for %s', (terminal, flag) => {
    expect(terminalArgs(terminal, 'echo ok')).toEqual([...flag, 'sh', '-c', 'echo ok'])
  })
})

describe('quoting', () => {
  it('leaves simple arguments alone and quotes the rest safely', () => {
    expect(shellQuote('@anthropic-ai/claude-code@latest')).toBe('@anthropic-ai/claude-code@latest')
    expect(shellQuote('/home/me/My Apps/claude')).toBe(`'/home/me/My Apps/claude'`)
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`)
    expect(shellQuote('$(rm -rf ~)')).toBe(`'$(rm -rf ~)'`)
    expect(shellQuote('')).toBe(`''`)
    expect(commandLine('npm', ['install', '-g', 'x y'])).toBe(`npm install -g 'x y'`)
  })

  it('wraps the command so the window stays open with the notice', () => {
    const script = holdScript('claude', ['auth', 'login'])
    expect(script.startsWith('claude auth login; ')).toBe(true)
    expect(script.endsWith('; read _')).toBe(true)
    expect(script).toContain(tm().linuxTerminal.pressEnter)
  })

  // Runs the generated script in a real sh: only exists on Linux/macOS.
  it.skipIf(process.platform === 'win32')('keeps arguments with spaces and quotes intact in a real shell', () => {
    const output = execFileSync('sh', ['-c', holdScript('printf', ['[%s]', 'a b', `it's`, '$HOME'])], { input: '\n', encoding: 'utf8' })
    expect(output.startsWith(`[a b][it's][$HOME]`)).toBe(true)
  })
})

describe('openInTerminal', () => {
  it('spawns the terminal with sh -c and the given env', () => {
    const deps = fakeDeps({ 'gnome-terminal': '/usr/bin/gnome-terminal' })
    const env = { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/tmp/profile' }
    openInTerminal('claude', ['auth', 'login'], env, deps)
    expect(deps.calls).toEqual([{ command: '/usr/bin/gnome-terminal', args: ['--', 'sh', '-c', holdScript('claude', ['auth', 'login'])], env }])
  })

  it('throws a message with the command to run by hand when there is no terminal', () => {
    const deps = fakeDeps({})
    expect(() => openInTerminal('npm', ['install', '-g', '@openai/codex@latest'], {}, deps)).toThrow(tm().linuxTerminal.notFound('npm install -g @openai/codex@latest'))
    expect(deps.calls).toEqual([])
  })
})
