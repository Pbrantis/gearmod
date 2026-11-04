import type { IpcOutput } from '@gearmod/contracts'
import { detectEol, normalizeEol, type Eol } from './position'
import type { EditorViewState } from './CodeEditor'
import type { EditorView } from '@codemirror/view'

/** `content` and `saved` use `\n` (what the editor understands); `disk` is the file's exact text, the basis of `expected` on save, and `eol` is the line ending to restore. */
export type Document = IpcOutput<'workspace:read'> & { saved: string; disk: string; eol: Eol; preview: boolean; error: string; diffView?: boolean; locked?: boolean; versions?: IpcOutput<'workspace:versions'>
  /** Changed on disk with a pending edit (new disk version), was deleted, transient reload notice and open comparison ("before" text and title). */
  transient?: boolean; conflict?: { content: string; disk: string; eol: Eol }; deleted?: boolean; notice?: string; compare?: { before: string; title: string; split: boolean } }
export const fromDisk = (file: IpcOutput<'workspace:read'>): Pick<Document, keyof IpcOutput<'workspace:read'> | 'saved' | 'disk' | 'eol'> => ({ ...file, content: normalizeEol(file.content), saved: normalizeEol(file.content), disk: file.content, eol: detectEol(file.content) })
const viewStatesKey = 'gearmod.fileViewStates'
let viewStates: Record<string, EditorViewState> | undefined
/** Cursor and scroll per file (the 100 most recent), to reopen at the same spot. Reads the saved format without breaking if it comes incomplete. */
export const readViewState = (path: string): EditorViewState | undefined => { if (!viewStates) { try { viewStates = JSON.parse(localStorage.getItem(viewStatesKey) ?? '{}') as Record<string, EditorViewState> } catch { viewStates = {} } } const saved = viewStates[path]; return saved && Number.isFinite(saved.anchor) && Number.isFinite(saved.head) ? { anchor: saved.anchor, head: saved.head, scrollTop: Number(saved.scrollTop) || 0 } : undefined }
export const writeViewState = (path: string, state: EditorViewState): void => { readViewState(path); const next = { ...viewStates }; delete next[path]; next[path] = state; viewStates = Object.fromEntries(Object.entries(next).slice(-100)); try { localStorage.setItem(viewStatesKey, JSON.stringify(viewStates)) } catch { /* only valid for this session */ } }
export const cursorInfo = (state: EditorView['state']): { line: number; column: number; selected: number; ranges: number } => { const main = state.selection.main, line = state.doc.lineAt(main.head); return { line: line.number, column: main.head - line.from + 1, selected: state.selection.ranges.reduce((sum, range) => sum + range.to - range.from, 0), ranges: state.selection.ranges.length } }
export const nameOf = (path: string): string => path.split(/[\\/]/).at(-1) ?? path
export const isMarkdown = (path: string): boolean => /\.(md|mdx|markdown)$/i.test(path)
export const isHtml = (path: string): boolean => /\.html?$/i.test(path)
export const slashed = (value: string): string => value.replace(/\\/g, '/').toLowerCase()
