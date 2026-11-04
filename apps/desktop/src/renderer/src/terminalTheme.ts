import type { ITheme } from '@xterm/xterm'

/** Reads a CSS variable from the app (`--surface`...) and returns `fallback` if it does not exist or is not a simple hex color. */
const read = (name: string, fallback: string): string => { const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback }

/** Terminal colors following the app theme (light or dark): background, text and accent come from the CSS variables; the ANSI palette changes to read well on light. */
export function terminalTheme(): { theme: ITheme; search: { match: string; active: string } } {
  const light = document.documentElement.dataset.theme === 'light'
  const base: ITheme = light
    ? { background: read('--surface', '#ffffff'), foreground: read('--text', '#1f2328'), cursor: read('--accent', '#0b6aa8'), selectionBackground: '#0b6aa855', black: '#1f2328', red: '#c62828', green: '#1a7f37', yellow: '#8a6500', blue: '#0b6aa8', magenta: '#8e24aa', cyan: '#007a87', white: '#6e7781', brightBlack: '#57606a', brightRed: '#d84343', brightGreen: '#2a9a47', brightYellow: '#a37a00', brightBlue: '#1f80c4', brightMagenta: '#a73bc4', brightCyan: '#1596a3', brightWhite: '#8c959f' }
    : { background: read('--surface', '#101211'), foreground: read('--text', '#dce3df'), cursor: read('--accent', '#8fb8d6'), selectionBackground: '#34527399' }
  return { theme: base, search: light ? { match: '#f2d87a', active: '#e0a030' } : { match: '#6b5a22', active: '#a87d12' } }
}
