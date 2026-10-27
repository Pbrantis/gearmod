import type { IpcOutput } from '@agentboard/contracts'
import { detectEol, normalizeEol, type Eol } from './position'
import type { EditorViewState } from './CodeEditor'
import type { EditorView } from '@codemirror/view'

/** `content` e `saved` ficam com `\n` (é o que o editor entende); `disk` é o texto exato do arquivo, base do `expected` ao salvar, e `eol` o fim de linha a devolver. */
export type Document = IpcOutput<'workspace:read'> & { saved: string; disk: string; eol: Eol; preview: boolean; error: string; diffView?: boolean; locked?: boolean; versions?: IpcOutput<'workspace:versions'>
  /** Mudou no disco com edição pendente (versão nova do disco), foi apagado, aviso passageiro de recarga e comparação aberta (texto "antes" e título). */
  transient?: boolean; conflict?: { content: string; disk: string; eol: Eol }; deleted?: boolean; notice?: string; compare?: { before: string; title: string; split: boolean } }
export const fromDisk = (file: IpcOutput<'workspace:read'>): Pick<Document, keyof IpcOutput<'workspace:read'> | 'saved' | 'disk' | 'eol'> => ({ ...file, content: normalizeEol(file.content), saved: normalizeEol(file.content), disk: file.content, eol: detectEol(file.content) })
const viewStatesKey = 'agentboard.fileViewStates'
let viewStates: Record<string, EditorViewState> | undefined
/** Cursor e rolagem por arquivo (os 100 mais recentes), para reabrir no mesmo ponto. Lê o formato salvo sem quebrar se vier incompleto. */
export const readViewState = (path: string): EditorViewState | undefined => { if (!viewStates) { try { viewStates = JSON.parse(localStorage.getItem(viewStatesKey) ?? '{}') as Record<string, EditorViewState> } catch { viewStates = {} } } const saved = viewStates[path]; return saved && Number.isFinite(saved.anchor) && Number.isFinite(saved.head) ? { anchor: saved.anchor, head: saved.head, scrollTop: Number(saved.scrollTop) || 0 } : undefined }
export const writeViewState = (path: string, state: EditorViewState): void => { readViewState(path); const next = { ...viewStates }; delete next[path]; next[path] = state; viewStates = Object.fromEntries(Object.entries(next).slice(-100)); try { localStorage.setItem(viewStatesKey, JSON.stringify(viewStates)) } catch { /* só vale nesta sessão */ } }
export const cursorInfo = (state: EditorView['state']): { line: number; column: number; selected: number; ranges: number } => { const main = state.selection.main, line = state.doc.lineAt(main.head); return { line: line.number, column: main.head - line.from + 1, selected: state.selection.ranges.reduce((sum, range) => sum + range.to - range.from, 0), ranges: state.selection.ranges.length } }
export const nameOf = (path: string): string => path.split(/[\\/]/).at(-1) ?? path
export const isMarkdown = (path: string): boolean => /\.(md|mdx|markdown)$/i.test(path)
export const isHtml = (path: string): boolean => /\.html?$/i.test(path)
export const slashed = (value: string): string => value.replace(/\\/g, '/').toLowerCase()
